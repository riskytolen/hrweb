import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Signed URL bukti e-POD untuk aplikasi mobile.
//
// Bucket `tms-epod-evidence` privat tanpa policy baca untuk authenticated,
// sehingga mobile tidak bisa mengunduh langsung. Function ini memvalidasi
// bahwa pemanggil terpasang pada FO, lalu mengembalikan signed URL
// berumur pendek untuk evidence aktif tiap titik (foto + tanda tangan).

const URL_TTL_SECONDS = 600;

interface EvidenceRow {
  submission_id: string;
  bucket_id: string;
  object_path: string;
  sort_order: number | null;
  evidence_type: string | null;
}

interface EvidenceItem {
  submission_id: string;
  path: string;
  url: string;
  sort_order: number;
  evidence_type: string;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = await req.json();
    const assignmentId =
      typeof body.assignment_id === "string" ? body.assignment_id.trim() : "";
    const employeeId =
      typeof body.employee_id === "string" ? body.employee_id.trim() : "";

    if (!assignmentId || !employeeId) {
      return json(400, { error: "assignment_id dan employee_id wajib diisi" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const requestedClientId =
      typeof body.client_id === "string" ? body.client_id.trim() : "";

    const { data: assignment, error: assignmentError } = await supabase
      .from("tms_epod_assignments")
      .select("id, assigned_employee_id, client_id, client:tms_clients(code, slug, name)")
      .eq("id", assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return json(404, { error: "FO e-POD tidak ditemukan" });
    }
    if (assignment.assigned_employee_id !== employeeId) {
      return json(403, { error: "Anda tidak terpasang pada FO ini" });
    }
    // Tenant check: bila pemanggil menyertakan client, harus cocok dengan
    // client assignment. Response selalu membawa client agar aplikasi bisa
    // menampilkan badge dan memvalidasi sisi client.
    const assignmentClient = assignment as {
      id: string;
      assigned_employee_id: string | null;
      client_id: string | null;
      client: { code: string; slug: string; name: string } | null;
    };
    if (requestedClientId && assignmentClient.client_id !== requestedClientId) {
      return json(403, { error: "FO ini milik client lain" });
    }
    const clientInfo = assignmentClient.client
      ? {
          id: assignmentClient.client_id,
          code: assignmentClient.client.code,
          slug: assignmentClient.client.slug,
          name: assignmentClient.client.name,
        }
      : { id: assignmentClient.client_id, code: null, slug: null, name: null };

    const { data: stops, error: stopsError } = await supabase
      .from("tms_epod_stops")
      .select("id")
      .eq("assignment_id", assignmentId);
    if (stopsError) {
      return json(500, { error: "Gagal memuat titik", detail: stopsError.message });
    }
    const stopIds = (stops ?? []).map((s: { id: string }) => s.id);
    if (stopIds.length === 0) {
      return json(200, { evidence: {}, client: clientInfo, expires_in: URL_TTL_SECONDS });
    }

    const { data: submissions, error: submissionsError } = await supabase
      .from("tms_epod_submissions")
      .select("id")
      .eq("is_current", true)
      .in("stop_id", stopIds);
    if (submissionsError) {
      return json(500, { error: "Gagal memuat bukti", detail: submissionsError.message });
    }
    const submissionIds = (submissions ?? []).map((s: { id: string }) => s.id);
    if (submissionIds.length === 0) {
      return json(200, { evidence: {}, client: clientInfo, expires_in: URL_TTL_SECONDS });
    }

    const { data: rows, error: evidenceError } = await supabase
      .from("tms_epod_evidence")
      .select("submission_id, bucket_id, object_path, sort_order, evidence_type, client_id")
      .in("submission_id", submissionIds)
      .order("sort_order", { ascending: true });
    if (evidenceError) {
      return json(500, { error: "Gagal memuat foto", detail: evidenceError.message });
    }
    // Bukti milik client lain (inkonsistensi data) tidak ikut ditandatangani.
    const scopedRows = ((rows ?? []) as (EvidenceRow & { client_id: string | null })[]).filter(
      (row) =>
        assignmentClient.client_id == null ||
        row.client_id == null ||
        row.client_id === assignmentClient.client_id,
    );

    const bySubmission = new Map<string, EvidenceRow[]>();
    for (const row of scopedRows as EvidenceRow[]) {
      const list = bySubmission.get(row.submission_id) ?? [];
      list.push(row);
      bySubmission.set(row.submission_id, list);
    }

    const result: Record<string, EvidenceItem[]> = {};
    for (const [submissionId, items] of bySubmission) {
      const byBucket = new Map<string, EvidenceRow[]>();
      for (const item of items) {
        const list = byBucket.get(item.bucket_id) ?? [];
        list.push(item);
        byBucket.set(item.bucket_id, list);
      }
      const signed: EvidenceItem[] = [];
      for (const [bucket, bucketItems] of byBucket) {
        const paths = bucketItems.map((item) => item.object_path);
        const { data: urls, error: signError } = await supabase.storage
          .from(bucket)
          .createSignedUrls(paths, URL_TTL_SECONDS);
        if (signError || !urls) continue;
        for (let i = 0; i < bucketItems.length && i < urls.length; i++) {
          const signedUrl = (urls[i] as { signedUrl?: string }).signedUrl;
          if (!signedUrl) continue;
          signed.push({
            submission_id: submissionId,
            path: bucketItems[i].object_path,
            url: signedUrl,
            sort_order: bucketItems[i].sort_order ?? 0,
            evidence_type: bucketItems[i].evidence_type ?? "PHOTO",
          });
        }
      }
      signed.sort((a, b) => a.sort_order - b.sort_order);
      result[submissionId] = signed;
    }

    return json(200, { evidence: result, client: clientInfo, expires_in: URL_TTL_SECONDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: "Internal server error", detail: message });
  }
});
