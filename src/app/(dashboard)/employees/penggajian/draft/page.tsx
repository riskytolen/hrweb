"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Calculator, Loader2, Zap, FileCheck, FileDown } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/components/AuthProvider";
import { logAudit } from "@/lib/audit";
import type { DbPayroll, DbPegawai } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { formatRupiah } from "@/lib/payroll-v2/formatter";
import {
  getPeriodRange,
  getCurrentPeriodKey,
  shiftPeriod,
  formatPeriodLabel,
} from "@/lib/payroll-v2/period";
import type { PayrollRow as RowData, PayrollStatus } from "@/lib/payroll-v2/types";

import PayrollStepper from "../components/PayrollStepper";
import PeriodSwitcher from "../components/PeriodSwitcher";
import PayrollTable from "../components/PayrollTable";
import BatchActionBar from "../components/BatchActionBar";
import PayrollDetailPanel from "../components/PayrollDetailPanel";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBadge from "../components/StatusBadge";

interface PegawaiLite {
  id: string;
  nama: string;
  divisi: string;
  jabatan: string;
  status_karyawan: string;
  tanggal_masuk: string;
  tanggal_keluar: string | null;
  gaji_pokok: number;
}

interface AbsenBreakdownItem {
  tanggal: string;
  status: "Terlambat" | "Alpha" | "Hadir" | "Cuti" | "Sakit" | "Izin" | "Libur";
  menitTelat: number;
  nominal: number;
}

function DraftPageInner() {
  const { user, getPermissionLevel, isSuperAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canInput = isSuperAdmin || getPermissionLevel("payroll") !== "none";

  const [periodKey, setPeriodKey] = useState(
    searchParams.get("period") || getCurrentPeriodKey(),
  );
  const period = useMemo(() => getPeriodRange(periodKey), [periodKey]);

  const [rows, setRows] = useState<RowData[]>([]);
  const [pegawaiList, setPegawaiList] = useState<PegawaiLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [reviewConfirm, setReviewConfirm] = useState<{ ids: number[]; count: number } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<{ ids: number[] } | null>(null);

  const [detailRow, setDetailRow] = useState<RowData | null>(null);
  const [absenBreakdown, setAbsenBreakdown] = useState<Record<number, { items: AbsenBreakdownItem[]; telat: number; alpha: number } | null>>({});
  const [lemburBreakdown, setLemburBreakdown] = useState<Record<number, { items: any[]; total: number } | null>>({});
  const [prorataInfo, setProrataInfo] = useState<Record<number, { hariEfektif: number; hariTotal: number; isProrated: boolean }>>({});

  const [toast, setToast] = useState<{ show: boolean; type: "success" | "error" | "info"; title: string; message?: string }>({ show: false, type: "success", title: "" });

  const showToast = (type: "success" | "error" | "info", title: string, message?: string) => {
    setToast({ show: true, type, title, message });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3500);
  };

  // ─── Fetch data ───
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();

      // Pegawai (untuk hitung worksheet)
      const { data: peg } = await supabase
        .from("pegawai")
        .select("id, nama, divisi, jabatan, status_karyawan, tanggal_masuk, tanggal_keluar, gaji_pokok")
        .order("nama", { ascending: true });
      setPegawaiList((peg ?? []) as PegawaiLite[]);

      // Payroll rows untuk periode ini
      const { data: pr } = await supabase
        .from("payrolls")
        .select("id, employee_id, periode, gaji_pokok, pendapatan_titik, lembur, total_pendapatan, potongan_absen, total_potongan, netto, status, version, reviewed_at, locked_at, updated_at, pegawai:pegawai!payrolls_employee_id_fkey(nama, divisi)")
        .eq("periode", periodKey)
        .order("created_at", { ascending: true });

      const mapped: RowData[] = (pr ?? []).map((r: any) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.pegawai?.nama ?? "(Tanpa nama)",
        divisi: r.pegawai?.divisi ?? "—",
        periode: r.periode,
        gajiPokok: r.gaji_pokok,
        pendapatanTitik: r.pendapatan_titik,
        lembur: r.lembur,
        totalPendapatan: r.total_pendapatan,
        potonganAbsen: r.potongan_absen,
        totalPotongan: r.total_potongan,
        netto: r.netto,
        status: r.status as PayrollStatus,
        isProrated: false,
        version: r.version ?? 1,
        reviewedAt: r.reviewed_at,
        lockedAt: r.locked_at,
        updatedAt: r.updated_at,
      }));
      setRows(mapped);
    } catch (e: any) {
      showToast("error", "Gagal memuat data", e?.message);
    } finally {
      setLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Sync period ke URL
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("period", periodKey);
    window.history.replaceState({}, "", url.toString());
  }, [periodKey]);

  // ─── Hitung worksheet (DRAFT) ───
  const handleCompute = async () => {
    if (!canInput) {
      showToast("error", "Tidak diizinkan", "Anda tidak punya akses input payroll");
      return;
    }
    setComputing(true);
    try {
      const supabase = createClient();
      // Hapus existing DRAFT untuk periode ini
      await supabase
        .from("payrolls")
        .delete()
        .eq("periode", periodKey)
        .eq("status", "DRAFT");

      const eligiblePegawai = pegawaiList.filter(
        (p) => p.status_karyawan === "Aktif" || p.status_karyawan === "Training" || p.status_karyawan === "Tidak Aktif",
      );

      if (eligiblePegawai.length === 0) {
        showToast("info", "Tidak ada pegawai", "Tidak ada pegawai eligible untuk periode ini");
        setComputing(false);
        return;
      }

      // Ambil attendance & overtime untuk semua eligible sekaligus
      const empIds = eligiblePegawai.map((p) => p.id);
      const [attRes, otRes] = await Promise.all([
        supabase
          .from("attendance_records")
          .select("employee_id, tanggal, status, menit_telat")
          .in("employee_id", empIds)
          .gte("tanggal", period.mulai)
          .lte("tanggal", period.selesai),
        supabase
          .from("overtime_requests")
          .select("id, employee_id, tanggal_mulai, tanggal_selesai, jam_mulai, jam_selesai, total_jam, tarif_per_jam, total_bayar, status")
          .in("employee_id", empIds)
          .eq("status", "Disetujui")
          .gte("tanggal_mulai", period.mulai)
          .lte("tanggal_mulai", period.selesai),
      ]);

      const attByEmp = new Map<string, any[]>();
      for (const a of attRes.data ?? []) {
        if (!attByEmp.has(a.employee_id)) attByEmp.set(a.employee_id, []);
        attByEmp.get(a.employee_id)!.push(a);
      }
      const otByEmp = new Map<string, any[]>();
      for (const o of otRes.data ?? []) {
        if (!otByEmp.has(o.employee_id)) otByEmp.set(o.employee_id, []);
        otByEmp.get(o.employee_id)!.push(o);
      }

      const inserts: any[] = [];
      const newProrata: typeof prorataInfo = {};

      for (const p of eligiblePegawai) {
        const attendance = (attByEmp.get(p.id) ?? []).map((a) => ({
          tanggal: a.tanggal,
          status: a.status,
          menitTelat: a.menit_telat ?? 0,
        }));
        const overtime = (otByEmp.get(p.id) ?? []).map((o) => ({
          id: o.id,
          tanggalMulai: o.tanggal_mulai,
          tanggalSelesai: o.tanggal_selesai,
          jamMulai: o.jam_mulai,
          jamSelesai: o.jam_selesai,
          totalJam: o.total_jam,
          tarifPerJam: o.tarif_per_jam,
          totalBayar: o.total_bayar,
          status: o.status,
        }));

        // Compute via pure functions
        const { calculatePayroll } = await import("@/lib/payroll-v2/calculator");
        const result = calculatePayroll({
          employee: {
            id: p.id,
            nama: p.nama,
            divisi: p.divisi ?? "",
            jabatan: p.jabatan ?? "",
            statusKaryawan: p.status_karyawan as any,
            tanggalMasuk: p.tanggal_masuk,
            tanggalKeluar: p.tanggal_keluar,
            gajiPokok: p.gaji_pokok,
          },
          period,
          attendance,
          overtime,
        });

        // Skip jika Tidak Aktif + 0 catatan
        if (!result) continue;

        // Store prorata info
        newProrata[empIds.indexOf(p.id)] = {
          hariEfektif: result.prorataHari,
          hariTotal: result.prorataTotal,
          isProrated: result.isProrated,
        };

        inserts.push({
          employee_id: p.id,
          periode: periodKey,
          periode_mulai: period.mulai,
          periode_selesai: period.selesai,
          gaji_pokok: result.gajiPokokProrata,
          pendapatan_titik: result.pendapatanTitik,
          extra_job: 0,
          uang_makan: 0,
          insentif: 0,
          tunjangan_jabatan: 0,
          transport: 0,
          tunjangan_lain: 0,
          tambahan_lain: 0,
          lembur: result.lembur,
          total_pendapatan: result.totalPendapatan,
          koperasi: 0,
          pinjaman_perusahaan: 0,
          potongan_absen: result.potonganAbsen,
          potongan_lain: 0,
          jht: 0,
          bpjs_kesehatan: 0,
          total_potongan: result.totalPotongan,
          netto: result.netto,
          status: "DRAFT",
          version: 1,
        });
      }

      if (inserts.length === 0) {
        showToast("info", "Tidak ada slip", "Tidak ada pegawai eligible dengan catatan absen");
        setComputing(false);
        return;
      }

      const { error } = await supabase.from("payrolls").insert(inserts);
      if (error) throw error;

      // Log audit
      await logAudit({
        supabase,
        action: "generate",
        entityType: "payrolls",
        entityLabel: `Worksheet ${formatPeriodLabel(periodKey)}`,
        newData: { periode: periodKey, jumlah: inserts.length, status: "DRAFT" },
      });

      showToast("success", "Worksheet Diperbarui", `${inserts.length} baris DRAFT dibuat untuk ${formatPeriodLabel(periodKey)}.`);
      setProrataInfo(newProrata);
      setSelectedIds(new Set());
      await fetchAll();
    } catch (e: any) {
      showToast("error", "Gagal menghitung", e?.message);
    } finally {
      setComputing(false);
    }
  };

  // ─── Review (DRAFT → REVIEWED) ───
  const handleReview = async (ids: number[]) => {
    try {
      const supabase = createClient();
      const { data: { user: u } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("payrolls")
        .update({
          status: "REVIEWED",
          reviewed_at: new Date().toISOString(),
          reviewed_by: u?.id ?? null,
        })
        .in("id", ids);
      if (error) throw error;

      await logAudit({
        supabase,
        action: "status_change",
        entityType: "payrolls",
        entityLabel: `Review ${ids.length} slip`,
        newData: { ids, from: "DRAFT", to: "REVIEWED" },
      });

      showToast("success", "Slip Di-review", `${ids.length} slip dipindahkan ke tab Review.`);
      setReviewConfirm(null);
      setSelectedIds(new Set());
      await fetchAll();
    } catch (e: any) {
      showToast("error", "Gagal review", e?.message);
    }
  };

  // ─── Bulk delete ───
  const handleBulkDelete = async (ids: number[]) => {
    try {
      const supabase = createClient();
      const { error } = await supabase.from("payrolls").delete().in("id", ids);
      if (error) throw error;
      showToast("success", "Slip Dihapus", `${ids.length} slip telah dihapus.`);
      setBulkDeleteConfirm(null);
      setSelectedIds(new Set());
      await fetchAll();
    } catch (e: any) {
      showToast("error", "Gagal hapus", e?.message);
    }
  };

  // ─── Detail breakdown fetcher ───
  const openDetail = useCallback(async (row: RowData) => {
    setDetailRow(row);
    const empId = row.employeeId;
    if (absenBreakdown[row.id] && lemburBreakdown[row.id]) return;

    const supabase = createClient();
    if (!absenBreakdown[row.id]) {
      const { data: att } = await supabase
        .from("attendance_records")
        .select("tanggal, status, menit_telat")
        .eq("employee_id", empId)
        .in("status", ["Terlambat", "Alpha"])
        .gte("tanggal", period.mulai)
        .lte("tanggal", period.selesai)
        .order("tanggal", { ascending: true });
      const items: AbsenBreakdownItem[] = (att ?? []).map((a: any) => {
        const telat = a.menit_telat ?? 0;
        const unit = Math.max(1, Math.ceil(telat / 15));
        const nominal = a.status === "Alpha" ? 50_000 : unit * 3000;
        return { tanggal: a.tanggal, status: a.status as "Terlambat" | "Alpha", menitTelat: telat, nominal };
      });
      const telatSum = items.filter((i) => i.status === "Terlambat").reduce((s, i) => s + i.nominal, 0);
      const alphaSum = items.filter((i) => i.status === "Alpha").reduce((s, i) => s + i.nominal, 0);
      setAbsenBreakdown((p) => ({ ...p, [row.id]: { items, telat: telatSum, alpha: alphaSum } }));
    }
    if (!lemburBreakdown[row.id]) {
      const { data: ot } = await supabase
        .from("overtime_requests")
        .select("tanggal_mulai, total_jam, tarif_per_jam, total_bayar")
        .eq("employee_id", empId)
        .eq("status", "Disetujui")
        .gte("tanggal_mulai", period.mulai)
        .lte("tanggal_mulai", period.selesai)
        .order("tanggal_mulai", { ascending: true });
      const items = (ot ?? []).map((o: any) => ({
        tanggal: o.tanggal_mulai,
        jam: o.total_jam,
        tarif: o.tarif_per_jam,
        total: o.total_bayar,
      }));
      const total = items.reduce((s: number, i: any) => s + i.total, 0);
      setLemburBreakdown((p) => ({ ...p, [row.id]: { items, total } }));
    }
  }, [absenBreakdown, lemburBreakdown, period]);

  // ─── Derived ───
  const isProratedMap = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const r of rows) m.set(r.id, r.isProrated);
    return m;
  }, [rows]);
  const prorataInfoMap = useMemo(() => {
    const m = new Map<number, { hariEfektif: number; hariTotal: number }>();
    for (const [k, v] of Object.entries(prorataInfo)) {
      const rowId = Number(k);
      const row = rows.find((r) => rows.indexOf(r) === Number(k));
      if (row) m.set(row.id, { hariEfektif: v.hariEfektif, hariTotal: v.hariTotal });
    }
    return m;
  }, [prorataInfo, rows]);

  const draftCount = rows.filter((r) => r.status === "DRAFT").length;
  const draftRows = rows.filter((r) => r.status === "DRAFT");

  // ─── Render ───
  return (
    <div className="space-y-4">
      <PageHeader
        title="Penggajian"
        description={`Hitung & review slip gaji · ${formatPeriodLabel(periodKey)}`}
        icon={Calculator}
        actions={
          <>
            <PeriodSwitcher
              label={formatPeriodLabel(periodKey)}
              onPrev={() => setPeriodKey((k) => shiftPeriod(k, -1))}
              onNext={() => setPeriodKey((k) => shiftPeriod(k, 1))}
            />
            <Button
              variant="outline"
              icon={computing ? Loader2 : Zap}
              size="sm"
              onClick={handleCompute}
              disabled={computing || loading}
            >
              {computing ? "Menghitung..." : "Hitung Ulang"}
            </Button>
          </>
        }
      />

      <PayrollStepper current="draft" counts={{ draft: draftCount }} />

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-5">
            <SkeletonTable rows={6} cols={8} />
          </div>
        ) : (
          <>
            <PayrollTable
              rows={draftRows}
              selectedIds={selectedIds}
              onSelectAll={(checked) => {
                if (checked) setSelectedIds(new Set(draftRows.map((r) => r.id)));
                else setSelectedIds(new Set());
              }}
              onSelectToggle={(id) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onDetail={openDetail}
              isProratedMap={isProratedMap}
              prorataInfoMap={prorataInfoMap}
              emptyTitle="Belum ada worksheet"
              emptyDescription="Klik 'Hitung Ulang' untuk membuat draft slip gaji dari data absen & lembur."
              emptyAction={{ label: "Hitung Ulang", onClick: handleCompute }}
              showEditAction={false}
            />
            <BatchActionBar
              count={selectedIds.size}
              onClear={() => setSelectedIds(new Set())}
              actions={[
                {
                  type: "review",
                  onClick: () =>
                    setReviewConfirm({ ids: Array.from(selectedIds), count: selectedIds.size }),
                },
                {
                  type: "hapus",
                  onClick: () => setBulkDeleteConfirm({ ids: Array.from(selectedIds) }),
                },
              ]}
            />
          </>
        )}
      </div>

      {/* Detail panel */}
      <PayrollDetailPanel
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        row={detailRow}
        absenDetail={detailRow ? absenBreakdown[detailRow.id]?.items ?? [] : []}
        lemburDetail={detailRow ? lemburBreakdown[detailRow.id]?.items ?? [] : []}
        prorataInfo={detailRow ? prorataInfo[rows.findIndex((r) => r.id === detailRow.id)] : undefined}
      />

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={!!reviewConfirm}
        title={`Review ${reviewConfirm?.count ?? 0} Slip?`}
        description={
          <>
            <strong>{reviewConfirm?.count}</strong> slip akan dipindahkan ke tab <strong>Review</strong>.
            Anda masih bisa membatalkan atau mengedit sebelum difinalkan.
          </>
        }
        confirmLabel="Ya, Review"
        onConfirm={() => reviewConfirm && handleReview(reviewConfirm.ids)}
        onCancel={() => setReviewConfirm(null)}
      />

      <ConfirmDialog
        open={!!bulkDeleteConfirm}
        title={`Hapus ${bulkDeleteConfirm?.ids.length ?? 0} Slip?`}
        description={
          <>
            Tindakan ini tidak dapat dibatalkan. <strong>{bulkDeleteConfirm?.ids.length}</strong> slip draft akan dihapus permanen.
          </>
        }
        variant="danger"
        confirmLabel="Ya, Hapus"
        onConfirm={() => bulkDeleteConfirm && handleBulkDelete(bulkDeleteConfirm.ids)}
        onCancel={() => setBulkDeleteConfirm(null)}
      />

      {/* Toast */}
      {toast.show && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
          <div
            className={cn(
              "px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold min-w-[280px]",
              toast.type === "success" && "bg-success-light border-success/30 text-success",
              toast.type === "error" && "bg-danger-light border-danger/30 text-danger",
              toast.type === "info" && "bg-info-light border-info/30 text-info",
            )}
          >
            <p>{toast.title}</p>
            {toast.message && <p className="text-xs font-normal opacity-80 mt-0.5">{toast.message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DraftPage() {
  return (
    <Suspense fallback={<div className="p-6"><SkeletonTable rows={6} cols={8} /></div>}>
      <DraftPageInner />
    </Suspense>
  );
}
