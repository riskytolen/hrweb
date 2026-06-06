"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FileCheck, Loader2, ShieldCheck, X, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/components/AuthProvider";
import { logAudit } from "@/lib/audit";
import type { DbPayroll } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  getPeriodRange,
  getCurrentPeriodKey,
  shiftPeriod,
  formatPeriodLabel,
} from "@/lib/payroll-v2/period";
import { formatRupiah } from "@/lib/payroll-v2/formatter";
import type { PayrollRow as RowData, PayrollStatus } from "@/lib/payroll-v2/types";

import PayrollStepper from "../components/PayrollStepper";
import PeriodSwitcher from "../components/PeriodSwitcher";
import PayrollTable from "../components/PayrollTable";
import BatchActionBar from "../components/BatchActionBar";
import PayrollDetailPanel from "../components/PayrollDetailPanel";
import ConfirmDialog from "../components/ConfirmDialog";

function ReviewPageInner() {
  const { user, getPermissionLevel, isSuperAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canFinal = isSuperAdmin || ["full", "approve"].includes(getPermissionLevel("payroll"));

  const [periodKey, setPeriodKey] = useState(
    searchParams.get("period") || getCurrentPeriodKey(),
  );
  const period = useMemo(() => getPeriodRange(periodKey), [periodKey]);

  const [rows, setRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [finalConfirm, setFinalConfirm] = useState<{ ids: number[]; count: number } | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<{ ids: number[]; count: number } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<{ ids: number[] } | null>(null);
  const [detailRow, setDetailRow] = useState<RowData | null>(null);
  const [absenBreakdown, setAbsenBreakdown] = useState<Record<number, { items: any[]; telat: number; alpha: number } | null>>({});
  const [lemburBreakdown, setLemburBreakdown] = useState<Record<number, { items: any[]; total: number } | null>>({});

  const [toast, setToast] = useState<{ show: boolean; type: "success" | "error" | "info"; title: string; message?: string }>({ show: false, type: "success", title: "" });

  const showToast = (type: "success" | "error" | "info", title: string, message?: string) => {
    setToast({ show: true, type, title, message });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3500);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: pr } = await supabase
        .from("payrolls")
        .select("id, employee_id, periode, gaji_pokok, pendapatan_titik, lembur, total_pendapatan, potongan_absen, total_potongan, netto, status, version, reviewed_at, locked_at, updated_at, pegawai:pegawai!payrolls_employee_id_fkey(nama, divisi)")
        .eq("periode", periodKey)
        .in("status", ["REVIEWED", "FINAL"])
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("period", periodKey);
    window.history.replaceState({}, "", url.toString());
  }, [periodKey]);

  // Finalkan: REVIEWED → FINAL
  const handleFinal = async (ids: number[]) => {
    if (!canFinal) {
      showToast("error", "Tidak diizinkan");
      return;
    }
    try {
      const supabase = createClient();
      const { data: { user: u } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("payrolls")
        .update({
          status: "FINAL",
          locked_at: new Date().toISOString(),
          locked_by: u?.id ?? null,
        })
        .in("id", ids);
      if (error) throw error;
      await logAudit({
        supabase,
        action: "finalisasi",
        entityType: "payrolls",
        entityLabel: `Finalkan ${ids.length} slip`,
        newData: { ids, from: "REVIEWED", to: "FINAL" },
      });
      showToast("success", "Slip Difinalkan", `${ids.length} slip dikunci dan masuk laporan.`);
      setFinalConfirm(null);
      setSelectedIds(new Set());
      await fetchAll();
    } catch (e: any) {
      showToast("error", "Gagal finalkan", e?.message);
    }
  };

  // Batalkan: REVIEWED → DRAFT
  const handleCancel = async (ids: number[]) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("payrolls")
        .update({
          status: "DRAFT",
          reviewed_at: null,
          reviewed_by: null,
        })
        .in("id", ids);
      if (error) throw error;
      await logAudit({
        supabase,
        action: "status_change",
        entityType: "payrolls",
        entityLabel: `Batalkan review ${ids.length} slip`,
        newData: { ids, from: "REVIEWED", to: "DRAFT" },
      });
      showToast("success", "Review Dibatalkan", `${ids.length} slip dikembalikan ke tab Hitung.`);
      setCancelConfirm(null);
      setSelectedIds(new Set());
      await fetchAll();
    } catch (e: any) {
      showToast("error", "Gagal batal", e?.message);
    }
  };

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

  const openDetail = useCallback(async (row: RowData) => {
    setDetailRow(row);
    if (absenBreakdown[row.id] && lemburBreakdown[row.id]) return;
    const supabase = createClient();
    if (!absenBreakdown[row.id]) {
      const { data: att } = await supabase
        .from("attendance_records")
        .select("tanggal, status, menit_telat")
        .eq("employee_id", row.employeeId)
        .in("status", ["Terlambat", "Alpha"])
        .gte("tanggal", period.mulai)
        .lte("tanggal", period.selesai)
        .order("tanggal", { ascending: true });
      const items = (att ?? []).map((a: any) => {
        const telat = a.menit_telat ?? 0;
        const unit = Math.max(1, Math.ceil(telat / 15));
        const denda = a.status === "Alpha" ? 50_000 : unit * 3000;
        return { tanggal: a.tanggal, status: a.status, menitTelat: telat, nominal: denda };
      });
      const telatSum = items.filter((i: any) => i.status === "Terlambat").reduce((s, i: any) => s + i.nominal, 0);
      const alphaSum = items.filter((i: any) => i.status === "Alpha").reduce((s, i: any) => s + i.nominal, 0);
      setAbsenBreakdown((p) => ({ ...p, [row.id]: { items, telat: telatSum, alpha: alphaSum } }));
    }
    if (!lemburBreakdown[row.id]) {
      const { data: ot } = await supabase
        .from("overtime_requests")
        .select("tanggal_mulai, total_jam, tarif_per_jam, total_bayar")
        .eq("employee_id", row.employeeId)
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

  const reviewCount = rows.filter((r) => r.status === "REVIEWED").length;
  const finalCount = rows.filter((r) => r.status === "FINAL").length;
  const reviewRows = rows.filter((r) => r.status === "REVIEWED");

  const isProratedMap = useMemo(() => new Map<number, boolean>(), []);
  const prorataInfoMap = useMemo(() => new Map<number, { hariEfektif: number; hariTotal: number }>(), []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Review Slip"
        description={`Periksa & finalkan · ${formatPeriodLabel(periodKey)}`}
        icon={FileCheck}
        actions={
          <PeriodSwitcher
            label={formatPeriodLabel(periodKey)}
            onPrev={() => setPeriodKey((k) => shiftPeriod(k, -1))}
            onNext={() => setPeriodKey((k) => shiftPeriod(k, 1))}
          />
        }
      />

      <PayrollStepper current="review" counts={{ review: reviewCount, report: finalCount }} onChange={(s) => {
        if (s === "draft") router.push(`/employees/penggajian/draft?period=${periodKey}`);
        if (s === "report") router.push(`/employees/penggajian/report?period=${periodKey}`);
      }} />

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-5">
            <SkeletonTable rows={6} cols={8} />
          </div>
        ) : (
          <>
            <PayrollTable
              rows={reviewRows}
              selectedIds={selectedIds}
              onSelectAll={(checked) => {
                if (checked) setSelectedIds(new Set(reviewRows.map((r) => r.id)));
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
              emptyTitle="Tidak ada slip yang di-review"
              emptyDescription="Pilih slip di tab Hitung, lalu klik 'Review' untuk memindahkan ke sini."
              showEditAction={false}
            />
            <BatchActionBar
              count={selectedIds.size}
              onClear={() => setSelectedIds(new Set())}
              actions={[
                { type: "finalkan", onClick: () => setFinalConfirm({ ids: Array.from(selectedIds), count: selectedIds.size }) },
                { type: "batalkan", onClick: () => setCancelConfirm({ ids: Array.from(selectedIds), count: selectedIds.size }) },
                { type: "hapus", onClick: () => setBulkDeleteConfirm({ ids: Array.from(selectedIds) }) },
              ]}
            />
          </>
        )}
      </div>

      <PayrollDetailPanel
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        row={detailRow}
        absenDetail={detailRow ? absenBreakdown[detailRow.id]?.items ?? [] : []}
        lemburDetail={detailRow ? lemburBreakdown[detailRow.id]?.items ?? [] : []}
      />

      <ConfirmDialog
        open={!!finalConfirm}
        title={`Finalkan ${finalConfirm?.count ?? 0} Slip?`}
        description={
          <>
            <strong>{finalConfirm?.count}</strong> slip akan <strong>dikunci</strong> dan masuk ke laporan. Setelah difinalkan, slip tidak dapat diedit lagi.
          </>
        }
        variant="success"
        confirmLabel="Ya, Finalkan"
        onConfirm={() => finalConfirm && handleFinal(finalConfirm.ids)}
        onCancel={() => setFinalConfirm(null)}
      />

      <ConfirmDialog
        open={!!cancelConfirm}
        title={`Batalkan Review ${cancelConfirm?.count ?? 0} Slip?`}
        description={
          <>
            <strong>{cancelConfirm?.count}</strong> slip akan dikembalikan ke tab <strong>Hitung</strong> (status DRAFT) dan bisa diedit kembali.
          </>
        }
        confirmLabel="Ya, Batalkan"
        onConfirm={() => cancelConfirm && handleCancel(cancelConfirm.ids)}
        onCancel={() => setCancelConfirm(null)}
      />

      <ConfirmDialog
        open={!!bulkDeleteConfirm}
        title={`Hapus ${bulkDeleteConfirm?.ids.length ?? 0} Slip?`}
        description={
          <>
            Tindakan ini tidak dapat dibatalkan. <strong>{bulkDeleteConfirm?.ids.length}</strong> slip akan dihapus permanen.
          </>
        }
        variant="danger"
        confirmLabel="Ya, Hapus"
        onConfirm={() => bulkDeleteConfirm && handleBulkDelete(bulkDeleteConfirm.ids)}
        onCancel={() => setBulkDeleteConfirm(null)}
      />

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

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-6"><SkeletonTable rows={6} cols={8} /></div>}>
      <ReviewPageInner />
    </Suspense>
  );
}
