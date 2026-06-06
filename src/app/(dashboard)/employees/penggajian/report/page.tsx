"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { BarChart3, FileSpreadsheet, FileText, Download, Users, Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";

import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  getPeriodRange,
  getCurrentPeriodKey,
  shiftPeriod,
  formatPeriodLabel,
  formatPeriodRange,
} from "@/lib/payroll-v2/period";
import { formatRupiah } from "@/lib/payroll-v2/formatter";
import type { PayrollRow as RowData, PayrollStatus } from "@/lib/payroll-v2/types";

import PayrollStepper from "../components/PayrollStepper";
import PeriodSwitcher from "../components/PeriodSwitcher";
import PayrollTable from "../components/PayrollTable";
import PayrollDetailPanel from "../components/PayrollDetailPanel";
import EmptyState from "../components/EmptyState";

function ReportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [periodKey, setPeriodKey] = useState(
    searchParams.get("period") || getCurrentPeriodKey(),
  );
  const period = useMemo(() => getPeriodRange(periodKey), [periodKey]);

  const [rows, setRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<RowData | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: pr } = await supabase
        .from("payrolls")
        .select("id, employee_id, periode, gaji_pokok, pendapatan_titik, lembur, total_pendapatan, potongan_absen, total_potongan, netto, status, version, reviewed_at, locked_at, updated_at, pegawai:pegawai!payrolls_employee_id_fkey(nama, divisi)")
        .eq("periode", periodKey)
        .eq("status", "FINAL")
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
    } catch (e) {
      // ignore
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

  // ─── Summary cards ───
  const summary = useMemo(() => {
    const acc = { totalGapok: 0, totalTitik: 0, totalLembur: 0, totalPotAbsen: 0, totalNetto: 0 };
    for (const r of rows) {
      acc.totalGapok += r.gajiPokok;
      acc.totalTitik += r.pendapatanTitik;
      acc.totalLembur += r.lembur;
      acc.totalPotAbsen += r.potonganAbsen;
      acc.totalNetto += r.netto;
    }
    return acc;
  }, [rows]);

  const exportExcel = () => {
    if (rows.length === 0) return;
    const header = ["Nama", "Divisi", "Gaji Pokok", "Pendapatan Titik", "Lembur", "Total Pendapatan", "Potongan Absen", "Total Potongan", "Netto"];
    const csv = [header.join(","), ...rows.map((r) => [
      `"${r.employeeName}"`,
      `"${r.divisi}"`,
      r.gajiPokok,
      r.pendapatanTitik,
      r.lembur,
      r.totalPendapatan,
      r.potonganAbsen,
      r.totalPotongan,
      r.netto,
    ].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `slip-gaji-${periodKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPDF = () => window.print();

  const isProratedMap = useMemo(() => new Map<number, boolean>(), []);
  const prorataInfoMap = useMemo(() => new Map<number, { hariEfektif: number; hariTotal: number }>(), []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Laporan Penggajian"
        description={`Rekap & export slip final · ${formatPeriodRange(periodKey)}`}
        icon={BarChart3}
        actions={
          <>
            <PeriodSwitcher
              label={formatPeriodRange(periodKey)}
              onPrev={() => setPeriodKey((k) => shiftPeriod(k, -1))}
              onNext={() => setPeriodKey((k) => shiftPeriod(k, 1))}
            />
            <Button variant="outline" icon={FileSpreadsheet} size="sm" onClick={exportExcel} disabled={rows.length === 0}>
              Export Excel
            </Button>
            <Button variant="outline" icon={FileText} size="sm" onClick={printPDF} disabled={rows.length === 0}>
              Cetak PDF
            </Button>
          </>
        }
      />

      <PayrollStepper
        current="report"
        counts={{ report: rows.length }}
        onChange={(s) => {
          if (s === "draft") router.push(`/employees/penggajian/draft?period=${periodKey}`);
          if (s === "review") router.push(`/employees/penggajian/review?period=${periodKey}`);
        }}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <SummaryCard icon={Users} label="Total Pegawai" value={String(rows.length)} color="primary" />
        <SummaryCard icon={Wallet} label="Total Gaji Pokok" value={formatRupiah(summary.totalGapok)} color="primary" />
        <SummaryCard icon={TrendingUp} label="Total Lembur" value={formatRupiah(summary.totalLembur)} color="success" />
        <SummaryCard icon={TrendingDown} label="Total Pot. Absen" value={formatRupiah(summary.totalPotAbsen)} color="danger" />
        <SummaryCard icon={BarChart3} label="Total Netto" value={formatRupiah(summary.totalNetto)} color="primary" bold />
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-5">
            <SkeletonTable rows={6} cols={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="Belum ada slip yang difinalkan"
            description="Finalkan slip dari tab Review untuk melihat laporan di sini."
          />
        ) : (
          <PayrollTable
            rows={rows}
            selectedIds={new Set()}
            onSelectAll={() => {}}
            onSelectToggle={() => {}}
            onDetail={setDetailRow}
            isProratedMap={isProratedMap}
            prorataInfoMap={prorataInfoMap}
            emptyTitle=""
            showEditAction={false}
          />
        )}
      </div>

      <PayrollDetailPanel
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        row={detailRow}
        absenDetail={[]}
        lemburDetail={[]}
      />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
  bold,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: "primary" | "success" | "danger";
  bold?: boolean;
}) {
  const colorMap = {
    primary: "bg-primary-light text-primary",
    success: "bg-success-light text-success",
    danger: "bg-danger-light text-danger",
  };
  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", colorMap[color])}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      </div>
      <p className={cn("text-base font-bold text-foreground tabular-nums truncate", bold && "text-primary text-lg")}>
        {value}
      </p>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="p-6"><SkeletonTable rows={6} cols={8} /></div>}>
      <ReportPageInner />
    </Suspense>
  );
}
