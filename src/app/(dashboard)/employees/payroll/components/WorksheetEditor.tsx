"use client";

import React from "react";
import {
  CreditCard,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Zap,
  TrendingDown,
  Save,
  Loader2,
  FileCheck,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { cn, formatCurrency } from "@/lib/utils";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS, formatInputCurrency, type PayrollRow, type AbsenBreakdownItem, type LemburBreakdownItem } from "../constants";

type WsBreakdownAbsen = { telat: number; alpha: number; lainnya: number; items: AbsenBreakdownItem[] } | null;
type WsBreakdownLembur = { total: number; items: LemburBreakdownItem[] } | null;

interface WorksheetEditorProps {
  payrolls: PayrollRow[];
  filtered: PayrollRow[];

  wsData: Record<number, Record<string, number>>;
  wsChangedCells: Map<number, Set<string>>;
  wsAbsenBreakdown: Record<number, WsBreakdownAbsen>;
  wsAbsenLoading: Record<number, boolean>;
  wsLemburBreakdown: Record<number, WsBreakdownLembur>;
  wsLemburLoading: Record<number, boolean>;
  wsSaving: boolean;
  wsExpandedId: number | null;
  wsRowsChanged: number;
  wsTotalChanged: number;

  search: string;
  setSearch: (v: string) => void;
  period: { start: string; end: string; label: string };
  prevPeriod: () => void;
  nextPeriod: () => void;

  handleWsChange: (id: number, field: string, rawValue: string) => void;
  handleWsKeteranganChange: (id: number, fieldKey: string, value: string) => void;
  wsKeterangan: Record<number, Record<string, string>>;
  handleWsSaveRow: (id: number) => Promise<void>;
  handleWsAutoSave: (id: number, immediate: boolean) => void;
  initWsData: (rows: PayrollRow[]) => void;
  isCellChanged: (id: number, field: string) => boolean;
  wsComputeTotals: (id: number) => { totalPendapatan: number; totalPotongan: number; netto: number };
  setWsExpandedId: (id: number | null) => void;

  setDeleteConfirm: (v: { id: number; nama: string } | null) => void;
  setBuatSlipConfirm: (v: { ids: number[]; mode: "single" | "bulk" } | null) => void;
  onOpenBatchFill: () => void;
  canEdit: boolean;
  /** Izin isi manual sel Worksheet (payroll.input boleh, tanpa ubah status/hapus). */
  canEditWorksheet?: boolean;
}

export default function WorksheetEditor({
  payrolls,
  filtered,
  wsData,
  wsChangedCells,
  wsAbsenBreakdown,
  wsAbsenLoading,
  wsLemburBreakdown,
  wsLemburLoading,
  wsSaving,
  wsExpandedId,
  wsRowsChanged,
  wsTotalChanged,
  search,
  setSearch,
  period,
  prevPeriod,
  nextPeriod,
  handleWsChange,
  handleWsKeteranganChange,
  wsKeterangan,
  handleWsSaveRow,
  handleWsAutoSave,
  initWsData,
  isCellChanged,
  wsComputeTotals,
  setWsExpandedId,
  setDeleteConfirm,
  setBuatSlipConfirm,
  onOpenBatchFill,
  canEdit,
  canEditWorksheet,
}: WorksheetEditorProps) {
  const canWsEdit = canEditWorksheet ?? canEdit;
  const cellRefs = React.useRef<Map<string, HTMLInputElement>>(new Map());
  const edPendingFocus = React.useRef<{ rowId: number; colKey: string } | null>(null);
  /** Row yang diklik terakhir (highlight biru). */
  const [edActiveRowId, setEdActiveRowId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!edPendingFocus.current) return;
    const t = setTimeout(() => {
      const target = edPendingFocus.current;
      edPendingFocus.current = null;
      if (!target) return;
      const el = cellRefs.current.get(`${target.rowId}|${target.colKey}`);
      if (el && !el.readOnly) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
        el.focus();
        el.select();
      }
    }, 60);
    return () => clearTimeout(t);
  }, [wsExpandedId]);

  /** Enter: pindah ke field yang sama di baris berikutnya (baris itu di-ekspansi dulu). */
  const focusNextRowField = (rowId: number, colKey: string) => {
    const idx = filtered.findIndex((r) => r.id === rowId);
    if (idx < 0 || idx >= filtered.length - 1) return;
    const next = filtered[idx + 1];
    const el = cellRefs.current.get(`${next.id}|${colKey}`);
    if (el && !el.readOnly) {
      edPendingFocus.current = { rowId: next.id, colKey };
      setWsExpandedId(next.id);
    }
  };

  const registerCellRef = (rowId: number, colKey: string) => (el: HTMLInputElement | null) => {
    const key = `${rowId}|${colKey}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  };
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20 flex-shrink-0">
            <CreditCard className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">Worksheet Penggajian</h2>
            <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
              <span><strong className="text-foreground">{filtered.length}</strong> pegawai</span>
              <span className="w-px h-3 bg-border" />
              <span>Netto: <strong className="text-primary">{formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0))}</strong></span>
              {wsRowsChanged > 0 && (
                <>
                  <span className="w-px h-3 bg-border" />
                  <span className="flex items-center gap-1 text-warning">
                    <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                    <strong>{wsRowsChanged}</strong> baris &middot; <strong>{wsTotalChanged}</strong> cell diubah
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-muted rounded-xl p-0.5">
            <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-3.5 h-3.5" /></button>
            <span className="text-[11px] font-bold text-foreground px-2.5 min-w-[200px] text-center whitespace-nowrap">{period.label}</span>
            <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex items-center gap-1.5 bg-muted rounded-xl px-2.5 py-1.5 w-44">
            <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input type="text" placeholder="Cari pegawai..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-[11px] outline-none w-full placeholder:text-muted-foreground/50 text-foreground" />
          </div>

          {canWsEdit && <button onClick={onOpenBatchFill}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">
            <Zap className="w-3 h-3" />Batch Fill
          </button>}
          {canWsEdit && wsRowsChanged > 0 && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => initWsData(payrolls)} disabled={wsSaving}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                Reset Semua
              </button>
            </div>
          )}
          {canEdit && (
            <Button
              variant="primary"
              icon={FileCheck}
              size="sm"
              onClick={() => setBuatSlipConfirm({ ids: filtered.map((r) => r.id), mode: "bulk" })}
              disabled={filtered.length === 0}
            >
              Buat Slip ({filtered.length})
            </Button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[900px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b-2 border-border bg-muted/80">
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-10">#</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Pegawai</th>
              <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-[130px]">Gaji Pokok</th>
              <th className="text-right text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-4 py-3 w-[130px]">Pend. Titik <span className="block text-[7px] font-normal normal-case opacity-60">otomatis</span></th>
              <th className="text-right text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider px-4 py-3 w-[140px] bg-emerald-50/50 dark:bg-emerald-500/[0.04]">Total Pendapatan</th>
              <th className="text-right text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider px-4 py-3 w-[140px] bg-rose-50/50 dark:bg-rose-500/[0.04]">Total Potongan</th>
              <th className="text-right text-[10px] font-bold text-primary uppercase tracking-wider px-4 py-3 w-[150px] bg-primary/[0.04]">Netto</th>
              <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-3 w-[80px]">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-24 text-sm text-muted-foreground">
                <CreditCard className="w-10 h-10 text-muted-foreground/15 mx-auto mb-2" />
                Belum ada slip gaji untuk periode ini
              </td></tr>
            ) : filtered.map((row, idx) => {
              const vals = wsData[row.id] || {};
              const computed = wsComputeTotals(row.id);
              const isChanged = wsChangedCells.has(row.id);
              const changedCellCount = wsChangedCells.get(row.id)?.size || 0;
              const isEven = idx % 2 === 0;
              const isActiveRow = edActiveRowId === row.id;
              return (
                <React.Fragment key={row.id}>
                  {/* Main row */}
                  <tr
                    className={cn(
                      "border-b transition-colors cursor-pointer",
                      isChanged ? "bg-amber-50/60 dark:bg-amber-500/[0.04] border-amber-200/50 dark:border-amber-500/10" : isActiveRow ? "bg-blue-50 dark:bg-blue-500/[0.08] border-blue-200/60 dark:border-blue-500/15" : isEven ? "bg-card border-border/40" : "bg-muted/20 border-border/40",
                      wsExpandedId === row.id ? "border-b-0" : "hover:bg-primary/[0.03]",
                      isActiveRow && "shadow-[inset_3px_0_0_0_rgba(37,99,235,0.55)]",
                    )}
                    onClick={() => {
                      setEdActiveRowId(row.id);
                      setWsExpandedId(wsExpandedId === row.id ? null : row.id);
                    }}
                  >
                    <td className="px-4 py-3 text-[10px] text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{row.pegawaiNama}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{row.pegawaiJabatan}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-foreground tabular-nums">
                      <div>{formatCurrency(vals.gaji_pokok || 0)}</div>
                      {row.gapok_is_prorata && row.gapok_rincian && (
                        <div className="text-[9px] font-normal text-amber-600 dark:text-amber-400 mt-0.5" title={`Dasar ${formatCurrency(row.gapok_bulanan || 0)} • Aktif ${row.gapok_hari_aktif}/${row.gapok_total_hari} hari`}>{row.gapok_rincian}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(vals.pendapatan_titik || 0)}</td>
                    <td className="px-4 py-3 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums bg-emerald-50/30 dark:bg-emerald-500/[0.02]">{formatCurrency(computed.totalPendapatan)}</td>
                    <td className="px-4 py-3 text-right text-xs font-bold text-rose-700 dark:text-rose-400 tabular-nums bg-rose-50/30 dark:bg-rose-500/[0.02]">{formatCurrency(computed.totalPotongan)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-foreground tabular-nums bg-primary/[0.02]">{formatCurrency(computed.netto)}</td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        {canEdit && (
                          <button onClick={() => setBuatSlipConfirm({ ids: [row.id], mode: "single" })} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary transition-colors" title="Buat Slip (Worksheet \u2192 Draft)">
                            <FileCheck className="w-3 h-3" />
                          </button>
                        )}
                        {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, nama: row.pegawaiNama || row.employee_id })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger transition-colors" title="Hapus">
                          <Trash2 className="w-3 h-3" />
                        </button>}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {wsExpandedId === row.id && (
                    <tr className={cn("border-b border-border", isChanged ? "bg-amber-50/30 dark:bg-amber-500/[0.02]" : "bg-muted/10")}>
                      <td />
                      <td colSpan={7} className="px-4 py-4">
                        <div className="grid grid-cols-2 gap-6 max-w-4xl">
                          {/* Pendapatan */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                                <TrendingDown className="w-3 h-3 text-emerald-600 dark:text-emerald-400 rotate-180" />
                              </div>
                              <h4 className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Pendapatan</h4>
                            </div>
                            <div className="space-y-1.5">
                              {PENDAPATAN_FIELDS.map((f) => {
                                const isLembur = f.key === "lembur";
                                const wsLembur = isLembur ? wsLemburBreakdown[row.id] : null;
                                const wsLemburLoad = isLembur ? !!wsLemburLoading[row.id] : false;
                                return (
                                  <div key={f.key} className={cn(isLembur || f.keteranganKey ? "space-y-1.5" : "flex items-center gap-2")}>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] text-muted-foreground w-32 flex-shrink-0 truncate">{f.label}</span>
                                      {f.readonly ? (
                                        <span className="flex-1 text-right text-[11px] font-medium text-emerald-600/70 dark:text-emerald-400/70 tabular-nums">{formatCurrency(vals[f.key] || 0)}</span>
                                      ) : (
                                        <div className="flex-1 relative">
                                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">Rp</span>
                                          <input
                                            type="text"
                                            value={vals[f.key] ? formatInputCurrency(vals[f.key]) : ""}
                                            onChange={(e) => handleWsChange(row.id, f.key, e.target.value)}
                                            placeholder="0"
                                            onClick={(e) => e.stopPropagation()}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                if (canWsEdit) {
                                                  handleWsAutoSave(row.id, true);
                                                  focusNextRowField(row.id, f.key);
                                                }
                                              }
                                            }}
                                            onBlur={() => {
                                              if (canWsEdit) handleWsAutoSave(row.id, false);
                                            }}
                                            readOnly={!canWsEdit}
                                            ref={registerCellRef(row.id, f.key)}
                                            className={cn(
                                              "w-full text-right text-[11px] tabular-nums pl-7 pr-2 py-1.5 rounded-lg border outline-none text-foreground placeholder:text-muted-foreground/30 transition-all",
                                              !canWsEdit && "!bg-muted/50 text-muted-foreground cursor-not-allowed",
                                              isCellChanged(row.id, f.key)
                                                ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20"
                                                : "border-border/60 bg-card hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
                                            )}
                                          />
                                        </div>
                                      )}
                                    </div>
                                    {f.keteranganKey && (
                                      <div className="pl-[136px]">
                                        <input
                                          type="text"
                                          value={wsKeterangan[row.id]?.[f.keteranganKey] || ""}
                                          onChange={(e) => handleWsKeteranganChange(row.id, f.keteranganKey!, e.target.value)}
                                          placeholder="Keterangan..."
                                          onClick={(e) => e.stopPropagation()}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              if (canWsEdit) {
                                                handleWsAutoSave(row.id, true);
                                                focusNextRowField(row.id, f.keteranganKey!);
                                              }
                                            }
                                          }}
                                          onBlur={() => {
                                            if (canWsEdit) handleWsAutoSave(row.id, false);
                                          }}
                                          readOnly={!canWsEdit}
                                          ref={registerCellRef(row.id, f.keteranganKey!)}
                                          className={cn(
                                            "w-full text-[10px] px-2 py-1 rounded-lg border outline-none text-muted-foreground placeholder:text-muted-foreground/30 transition-all",
                                            !canWsEdit && "!bg-muted/50 text-muted-foreground cursor-not-allowed",
                                            isCellChanged(row.id, f.keteranganKey)
                                              ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20"
                                              : "border-border/60 bg-card hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
                                          )}
                                        />
                                      </div>
                                    )}
                                    {isLembur && (
                                      <div>
                                        {wsLemburLoad ? (
                                          <div className="text-[10px] text-muted-foreground text-right animate-pulse">Memuat detail...</div>
                                        ) : wsLembur && wsLembur.items.length > 0 ? (
                                          <div className="rounded-lg border border-emerald-200/60 dark:border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/[0.03] overflow-hidden">
                                            <div className="px-2.5 py-1.5 bg-emerald-100/40 dark:bg-emerald-500/10 border-b border-emerald-200/60 dark:border-emerald-500/20 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px]">
                                              <span className="text-muted-foreground">Total: <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(wsLembur.total)}</strong></span>
                                              <span className="ml-auto text-[10px] font-semibold text-muted-foreground">{wsLembur.items.length} pengajuan</span>
                                            </div>
                                            <div className="max-h-28 overflow-y-auto divide-y divide-emerald-200/40 dark:divide-emerald-500/10">
                                              {wsLembur.items.map((it, idx) => {
                                                const dateLabel = new Date(it.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
                                                const jamMulai = it.jam_mulai?.slice(0, 5) || "";
                                                const jamSelesai = it.jam_selesai?.slice(0, 5) || "";
                                                const durasiJam = it.durasi_menit ? (it.durasi_menit / 60).toFixed(1).replace(/\.0$/, "") : "0";
                                                return (
                                                  <div
                                                    key={idx}
                                                    className={cn(
                                                      "grid grid-cols-[50px_minmax(0,1fr)_auto_auto] items-center gap-2 px-2.5 py-1 text-[10px]",
                                                      idx % 2 === 0 ? "bg-transparent" : "bg-emerald-50/40 dark:bg-emerald-500/[0.04]"
                                                    )}
                                                  >
                                                    <span className="tabular-nums text-muted-foreground font-medium">{dateLabel}</span>
                                                    <span className="font-semibold text-foreground truncate">
                                                      {jamMulai && jamSelesai ? `${jamMulai}–${jamSelesai} (${durasiJam}j)` : `${durasiJam}j`}
                                                    </span>
                                                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">@ {formatCurrency(it.rate_per_jam || 0)}/j</span>
                                                    <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">{formatCurrency(it.total_lembur || 0)}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ) : wsLembur ? (
                                          <div className="text-[10px] text-muted-foreground text-right italic">Tidak ada lembur disetujui di periode ini</div>
                                        ) : null}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              <div className="flex items-center gap-2 pt-2 mt-1 border-t border-emerald-200/50 dark:border-emerald-500/10">
                                <span className="text-[11px] font-bold text-foreground w-32">Total</span>
                                <span className="flex-1 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(computed.totalPendapatan)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Potongan */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-5 h-5 rounded-md bg-rose-100 dark:bg-rose-500/10 flex items-center justify-center">
                                <TrendingDown className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                              </div>
                              <h4 className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">Potongan</h4>
                            </div>
                            <div className="space-y-1.5">
                              {POTONGAN_FIELDS.map((f) => {
                                const isPotAbsen = f.key === "potongan_absen";
                                const wsBreakdown = isPotAbsen ? wsAbsenBreakdown[row.id] : null;
                                const wsBreakdownLoading = isPotAbsen ? !!wsAbsenLoading[row.id] : false;
                                return (
                                  <div key={f.key} className={cn(isPotAbsen || f.keteranganKey ? "space-y-1.5" : "flex items-center gap-2")}>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] text-muted-foreground w-32 flex-shrink-0 truncate">{f.label}</span>
                                      {f.readonly ? (
                                        <span className="flex-1 text-right text-[11px] font-medium text-rose-600/70 dark:text-rose-400/70 tabular-nums">{formatCurrency(vals[f.key] || 0)}</span>
                                      ) : (
                                        <div className="flex-1 relative">
                                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">Rp</span>
                                          <input
                                            type="text"
                                            value={vals[f.key] ? formatInputCurrency(vals[f.key]) : ""}
                                            onChange={(e) => handleWsChange(row.id, f.key, e.target.value)}
                                            placeholder="0"
                                            onClick={(e) => e.stopPropagation()}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                if (canWsEdit) {
                                                  handleWsAutoSave(row.id, true);
                                                  focusNextRowField(row.id, f.key);
                                                }
                                              }
                                            }}
                                            onBlur={() => {
                                              if (canWsEdit) handleWsAutoSave(row.id, false);
                                            }}
                                            readOnly={!canWsEdit}
                                            ref={registerCellRef(row.id, f.key)}
                                            className={cn(
                                              "w-full text-right text-[11px] tabular-nums pl-7 pr-2 py-1.5 rounded-lg border outline-none text-foreground placeholder:text-muted-foreground/30 transition-all",
                                              !canWsEdit && "!bg-muted/50 text-muted-foreground cursor-not-allowed",
                                              isCellChanged(row.id, f.key)
                                                ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20"
                                                : "border-border/60 bg-card hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
                                            )}
                                          />
                                        </div>
                                      )}
                                    </div>
                                    {f.keteranganKey && (
                                      <div className="pl-[136px]">
                                        <input
                                          type="text"
                                          value={wsKeterangan[row.id]?.[f.keteranganKey] || ""}
                                          onChange={(e) => handleWsKeteranganChange(row.id, f.keteranganKey!, e.target.value)}
                                          placeholder="Keterangan..."
                                          onClick={(e) => e.stopPropagation()}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              if (canWsEdit) {
                                                handleWsAutoSave(row.id, true);
                                                focusNextRowField(row.id, f.keteranganKey!);
                                              }
                                            }
                                          }}
                                          onBlur={() => {
                                            if (canWsEdit) handleWsAutoSave(row.id, false);
                                          }}
                                          readOnly={!canWsEdit}
                                          ref={registerCellRef(row.id, f.keteranganKey!)}
                                          className={cn(
                                            "w-full text-[10px] px-2 py-1 rounded-lg border outline-none text-muted-foreground placeholder:text-muted-foreground/30 transition-all",
                                            !canWsEdit && "!bg-muted/50 text-muted-foreground cursor-not-allowed",
                                            isCellChanged(row.id, f.keteranganKey)
                                              ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20"
                                              : "border-border/60 bg-card hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
                                          )}
                                        />
                                      </div>
                                    )}
                                    {isPotAbsen && (
                                      <div>
                                        {wsBreakdownLoading ? (
                                          <div className="text-[10px] text-muted-foreground text-right animate-pulse">Memuat detail...</div>
                                        ) : wsBreakdown && wsBreakdown.items.length > 0 ? (
                                          <div className="rounded-lg border border-rose-200/60 dark:border-rose-500/20 bg-rose-50/30 dark:bg-rose-500/[0.03] overflow-hidden">
                                            <div className="px-2.5 py-1.5 bg-rose-100/40 dark:bg-rose-500/10 border-b border-rose-200/60 dark:border-rose-500/20 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px]">
                                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-muted-foreground">
                                                <span>Telat: <strong className="text-foreground tabular-nums">{formatCurrency(wsBreakdown.telat)}</strong></span>
                                                {wsBreakdown.alpha > 0 && <span>Alpha: <strong className="text-foreground tabular-nums">{formatCurrency(wsBreakdown.alpha)}</strong></span>}
                                                {wsBreakdown.lainnya > 0 && <span>Lainnya: <strong className="text-foreground tabular-nums">{formatCurrency(wsBreakdown.lainnya)}</strong></span>}
                                              </div>
                                              <span className="ml-auto text-[10px] font-semibold text-muted-foreground">{wsBreakdown.items.length} kejadian</span>
                                            </div>
                                            <div className="max-h-28 overflow-y-auto divide-y divide-rose-200/40 dark:divide-rose-500/10">
                                              {wsBreakdown.items.map((it, idx) => {
                                                const isAlpha = it.status === "Alpha";
                                                const isTelat = it.status === "Telat" || it.status === "Terlambat";
                                                const dateLabel = new Date(it.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
                                                const statusLabel = isAlpha
                                                  ? "Alpha"
                                                  : isTelat
                                                    ? (it.durasi_telat ? `Telat (${it.durasi_telat}m)` : "Telat")
                                                    : it.status;
                                                return (
                                                  <div
                                                    key={idx}
                                                    className={cn(
                                                      "grid grid-cols-[50px_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1 text-[10px]",
                                                      idx % 2 === 0 ? "bg-transparent" : "bg-rose-50/40 dark:bg-rose-500/[0.04]"
                                                    )}
                                                  >
                                                    <span className="tabular-nums text-muted-foreground font-medium">{dateLabel}</span>
                                                    <span className={cn(
                                                      "font-semibold truncate",
                                                      isAlpha ? "text-rose-600 dark:text-rose-400" : isTelat ? "text-amber-600 dark:text-amber-400" : "text-foreground"
                                                    )}>
                                                      {statusLabel}
                                                    </span>
                                                    <span className="font-bold text-foreground tabular-nums whitespace-nowrap">{formatCurrency(it.denda)}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ) : wsBreakdown ? (
                                          <div className="text-[10px] text-muted-foreground text-right italic">Tidak ada denda di periode ini</div>
                                        ) : null}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              <div className="flex items-center gap-2 pt-2 mt-1 border-t border-rose-200/50 dark:border-rose-500/10">
                                <span className="text-[11px] font-bold text-foreground w-32">Total</span>
                                <span className="flex-1 text-right text-xs font-bold text-rose-700 dark:text-rose-400 tabular-nums">{formatCurrency(computed.totalPotongan)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Netto bar */}
                        <div className="mt-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/10 max-w-4xl">
                          <span className="text-xs font-bold text-foreground">Gaji Bersih (Netto)</span>
                          <span className={cn("text-lg font-bold tabular-nums", computed.netto >= 0 ? "text-primary" : "text-danger")}>{formatCurrency(computed.netto)}</span>
                        </div>
                        {canWsEdit && (
                          <div className="mt-3 flex items-center justify-between gap-3 max-w-4xl rounded-xl border border-border bg-card px-4 py-3">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-foreground">Simpan perubahan pegawai ini</p>
                              <p className={cn("text-[10px] mt-0.5", isChanged ? "text-warning" : "text-muted-foreground")}>
                                {isChanged ? `${changedCellCount} cell belum disimpan untuk ${row.pegawaiNama}` : "Belum ada perubahan pada pegawai ini."}
                              </p>
                            </div>
                            <Button
                              icon={wsSaving ? Loader2 : Save}
                              size="sm"
                              onClick={() => handleWsSaveRow(row.id)}
                              disabled={wsSaving || !isChanged}
                            >
                              {wsSaving ? "Menyimpan..." : "Simpan Pegawai"}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {/* Footer */}
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t-2 border-border bg-card shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
                <td className="px-4 py-3" />
                <td className="px-4 py-3">
                  <p className="text-[10px] font-bold text-foreground uppercase tracking-wider">Grand Total</p>
                  <p className="text-[9px] text-muted-foreground">{filtered.length} pegawai</p>
                </td>
                <td className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground tabular-nums">
                  {formatCurrency(filtered.reduce((s, r) => s + ((wsData[r.id] || {}).gaji_pokok || 0), 0))}
                </td>
                <td className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground tabular-nums">
                  {formatCurrency(filtered.reduce((s, r) => s + ((wsData[r.id] || {}).pendapatan_titik || 0), 0))}
                </td>
                <td className="px-4 py-3 text-right text-xs font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums bg-emerald-50/50 dark:bg-emerald-500/[0.04]">
                  {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPendapatan, 0))}
                </td>
                <td className="px-4 py-3 text-right text-xs font-extrabold text-rose-700 dark:text-rose-400 tabular-nums bg-rose-50/50 dark:bg-rose-500/[0.04]">
                  {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPotongan, 0))}
                </td>
                <td className="px-4 py-3 text-right text-sm font-extrabold text-primary tabular-nums bg-primary/[0.04]">
                  {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
