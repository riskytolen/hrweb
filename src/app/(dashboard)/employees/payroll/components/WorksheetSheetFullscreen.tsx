"use client";

import React, { useEffect, useRef } from "react";
import {
  X,
  CreditCard,
  Download,
  FileCheck,
  Trash2,
  Loader2,
  Save,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS, formatInputCurrency, type PayrollRow } from "../constants";

type WsBreakdownAbsen = { telat: number; alpha: number; lainnya: number; items: { tanggal: string; status: string; denda: number; durasi_telat: number | null }[] } | null;
type WsBreakdownLembur = { total: number; items: { tanggal: string; jam_mulai: string; jam_selesai: string; durasi_menit: number; rate_per_jam: number; total_lembur: number; alasan: string | null }[] } | null;

interface WorksheetSheetFullscreenProps {
  filtered: PayrollRow[];
  wsData: Record<number, Record<string, number>>;
  wsChangedCells: Map<number, Set<string>>;
  wsAbsenBreakdown: Record<number, WsBreakdownAbsen>;
  wsLemburBreakdown: Record<number, WsBreakdownLembur>;
  wsSaving: boolean;
  period: { start: string; end: string; label: string };
  prevPeriod: () => void;
  nextPeriod: () => void;
  handleWsChange: (id: number, field: string, rawValue: string) => void;
  handleWsKeteranganChange: (id: number, fieldKey: string, value: string) => void;
  wsKeterangan: Record<number, Record<string, string>>;
  handleWsSaveRow: (id: number) => Promise<void>;
  isCellChanged: (id: number, field: string) => boolean;
  wsComputeTotals: (id: number) => { totalPendapatan: number; totalPotongan: number; netto: number };
  exportSlipPDF: (row: PayrollRow) => void;
  setDeleteConfirm: (v: { id: number; nama: string } | null) => void;
  setBuatSlipConfirm: ((v: { ids: number[]; mode: "single" | "bulk" } | null) => void) | undefined;
  canEdit: boolean;
  mode: "Worksheet" | "Draft" | "Final";
  onClose: () => void;
}

const READONLY_KEYS = new Set(["gaji_pokok", "pendapatan_titik", "lembur", "potongan_absen"]);
const FROZEN_COLS = new Set(["_no", "_nik", "_nama"]);
const FROZEN_LEFT_PX: Record<string, number> = {
  _no: 0,
  _nik: 48,
  _nama: 158,
};
const FIXED_COLUMN_WIDTHS: Record<string, number> = {
  _no: 48,
  _nik: 110,
  _nama: 240,
};

function getColumnWidth(col: { key: string; width: string }): number {
  if (FIXED_COLUMN_WIDTHS[col.key]) return FIXED_COLUMN_WIDTHS[col.key];
  if (col.width.includes("w-32")) return 128;
  if (col.width.includes("w-28")) return 112;
  if (col.width.includes("w-24")) return 96;
  if (col.width.includes("w-20")) return 80;
  return 96;
}

export default function WorksheetSheetFullscreen({
  filtered,
  wsData,
  wsChangedCells,
  wsAbsenBreakdown,
  wsLemburBreakdown,
  wsSaving,
  period,
  prevPeriod,
  nextPeriod,
  handleWsChange,
  handleWsKeteranganChange,
  wsKeterangan,
  handleWsSaveRow,
  isCellChanged,
  wsComputeTotals,
  exportSlipPDF,
  setDeleteConfirm,
  setBuatSlipConfirm,
  canEdit,
  mode,
  onClose,
}: WorksheetSheetFullscreenProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const isReadOnly = mode === "Final";

  const modeLabel =
    mode === "Worksheet" ? "Worksheet" :
    mode === "Draft" ? "Draft" :
    "Final";
  const modeSubLabel =
    mode === "Final" ? " — read-only, terkunci" : "";

  // Lock body scroll + Esc handler
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handler);
    };
  }, [onClose]);

  // Column definition: label, key, group, width, editable
  type SheetCol = { label: string; key: string; group: "info" | "pendapatan" | "potongan" | "netto" | "rekening"; width: string; editable: boolean };
  const SHEET_COLS: SheetCol[] = [
    { label: "No", key: "_no", group: "info", width: "w-[48px]", editable: false },
    { label: "ID", key: "_nik", group: "info", width: "w-[110px]", editable: false },
    { label: "Nama", key: "_nama", group: "info", width: "w-[240px]", editable: false },
    { label: "Jabatan", key: "_jabatan", group: "info", width: "w-32", editable: false },
    { label: "Status", key: "_status", group: "info", width: "w-20", editable: false },
    ...PENDAPATAN_FIELDS.filter((f) => f.key !== "total_pendapatan").flatMap((f) => {
      const cols: SheetCol[] = [{
        label: f.label,
        key: f.key,
        group: "pendapatan" as const,
        width: f.key === "gaji_pokok" || f.key === "pendapatan_titik" ? "w-28" : f.key === "lembur" ? "w-28" : "w-24",
        editable: !f.readonly && !READONLY_KEYS.has(f.key),
      }];
      if (f.keteranganKey) cols.push({
        label: `Ket. ${f.label}`,
        key: f.keteranganKey,
        group: "pendapatan" as const,
        width: "w-40",
        editable: true,
      });
      return cols;
    }),
    { label: "Total Pend", key: "_total_pend", group: "pendapatan", width: "w-28", editable: false },
    ...POTONGAN_FIELDS.filter((f) => f.key !== "total_potongan").flatMap((f) => {
      const cols: SheetCol[] = [{
        label: f.label,
        key: f.key,
        group: "potongan" as const,
        width: "w-24",
        editable: !f.readonly && !READONLY_KEYS.has(f.key),
      }];
      if (f.keteranganKey) cols.push({
        label: `Ket. ${f.label}`,
        key: f.keteranganKey,
        group: "potongan" as const,
        width: "w-40",
        editable: true,
      });
      return cols;
    }),
    { label: "Total Pot", key: "_total_pot", group: "potongan", width: "w-28", editable: false },
    { label: "Netto", key: "_netto", group: "netto", width: "w-28", editable: false },
    { label: "Bank", key: "_bank", group: "rekening", width: "w-20", editable: false },
    { label: "No.Rek", key: "_no_rek", group: "rekening", width: "w-32", editable: false },
    { label: "A/N", key: "_an", group: "rekening", width: "w-32", editable: false },
    { label: "Aksi", key: "_aksi", group: "info", width: "w-24", editable: false },
  ];

  const pendapatanCols = SHEET_COLS.filter((c) => c.group === "pendapatan");
  const potonganCols = SHEET_COLS.filter((c) => c.group === "potongan");
  const leadingInfoCols = SHEET_COLS.filter((c) => ["_no", "_nik", "_nama", "_jabatan", "_status"].includes(c.key));
  const aksiCol = SHEET_COLS.find((c) => c.key === "_aksi");

  const getColumnStyle = (col: SheetCol): React.CSSProperties => {
    const width = getColumnWidth(col);
    const left = FROZEN_LEFT_PX[col.key];
    return {
      width,
      minWidth: width,
      maxWidth: width,
      ...(left !== undefined ? { left } : {}),
    };
  };

  const isKeteranganCol = (key: string) => key.endsWith("_keterangan");
  const gridBorder = "border-r border-b border-slate-200/80 dark:border-slate-800/80";
  const headerGridBorder = "border-r border-b border-slate-200 dark:border-slate-800";
  const footerGridBorder = "border-r border-t border-slate-200 dark:border-slate-800";
  const frozenDivider = (key: string) => key === "_nama" && "border-r border-r-slate-300/80 dark:border-r-slate-700/80";

  const getCellValue = (row: PayrollRow, col: SheetCol): string => {
    if (col.key === "_no") return "";
    if (col.key === "_nik") return row.employee_id;
    if (col.key === "_nama") return row.pegawaiNama || "";
    if (col.key === "_jabatan") return row.pegawaiJabatan || "-";
    if (col.key === "_status") return (row.pegawai as { status?: string } | undefined)?.status || "-";
    if (col.key === "_total_pend") return formatCurrency(wsComputeTotals(row.id).totalPendapatan);
    if (col.key === "_total_pot") return formatCurrency(wsComputeTotals(row.id).totalPotongan);
    if (col.key === "_netto") return formatCurrency(wsComputeTotals(row.id).netto);
    if (col.key === "_bank") return (row.pegawai as { bank?: string | null })?.bank || "-";
    if (col.key === "_no_rek") return (row.pegawai as { no_rekening?: string | null })?.no_rekening || "-";
    if (col.key === "_an") return (row.pegawai as { nama_rekening?: string | null })?.nama_rekening || "-";
    if (col.key === "_aksi") return "";
    const vals = wsData[row.id];
    return vals ? formatCurrency(vals[col.key] || 0) : "0";
  };

  const getCellNumeric = (row: PayrollRow, col: SheetCol): number => {
    const vals = wsData[row.id];
    return vals ? vals[col.key] || 0 : 0;
  };

  const getGrandTotal = (col: SheetCol): string => {
    if (col.group === "info" || col.group === "rekening" || col.group === "netto") return "";
    if (col.key === "_total_pend") return formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPendapatan, 0));
    if (col.key === "_total_pot") return formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPotongan, 0));
    if (isKeteranganCol(col.key)) return "";
    return formatCurrency(filtered.reduce((s, r) => s + getCellNumeric(r, col), 0));
  };

  const getGrandNetto = () => formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0));

  const cellInput = (row: PayrollRow, col: SheetCol) => {
    const vals = wsData[row.id];
    if (!vals) return null;
    return (
      <input
        type="text"
        value={vals[col.key] ? formatInputCurrency(vals[col.key]) : ""}
        onChange={(e) => handleWsChange(row.id, col.key, e.target.value)}
        placeholder="0"
        onClick={(e) => e.stopPropagation()}
        readOnly={!col.editable || isReadOnly}
        className={cn(
          "w-full text-right text-[10px] tabular-nums px-1 py-0.5 rounded-sm border outline-none text-foreground placeholder:text-muted-foreground/30 transition-all leading-tight",
          (!col.editable || isReadOnly) && "!bg-transparent text-muted-foreground cursor-default border-transparent",
          col.editable && !isReadOnly && !isCellChanged(row.id, col.key) && "border-transparent hover:border-border/60 focus:border-primary focus:ring-1 focus:ring-primary/20 bg-transparent",
          col.editable && !isReadOnly && isCellChanged(row.id, col.key) && "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20",
        )}
      />
    );
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20 flex-shrink-0">
            <CreditCard className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">{modeLabel} — Mode Spreadsheet{modeSubLabel}</h2>
            <p className="text-[10px] text-muted-foreground">{filtered.length} pegawai</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-xl p-0.5">
            <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground"><ChevronLeft className="w-3.5 h-3.5" /></button>
            <span className="text-[11px] font-bold text-foreground px-2.5 min-w-[200px] text-center whitespace-nowrap">{period.label}</span>
            <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground"><ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex items-center gap-1 border-l border-border pl-2 ml-2">
            <button
              onClick={() => tableRef.current?.scrollBy({ left: -600, behavior: "smooth" })}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Geser ke kiri"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => tableRef.current?.scrollBy({ left: 600, behavior: "smooth" })}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Geser ke kanan"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Keluar Fullscreen
          </button>
        </div>
      </div>

      {/* ── Table wrapper ── */}
      <div ref={tableRef} className="flex-1 overflow-auto bg-card [scrollbar-gutter:stable]">
        <table className="w-max min-w-full border-separate border-spacing-0">
          <colgroup>
            {SHEET_COLS.map((c) => {
              const width = getColumnWidth(c);
              return <col key={c.key} style={{ width, minWidth: width, maxWidth: width }} />;
            })}
          </colgroup>
          {/* ── Group header row ── */}
          <thead className="sticky top-0 z-50 shadow-[0_3px_10px_-6px_rgba(15,23,42,0.8)]">
            {/* Row 1: Group labels */}
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {/* Info group */}
              {leadingInfoCols.map((c) => (
                <th key={c.key} style={getColumnStyle(c)} className={cn(
                  c.width,
                   "h-6 px-1 py-0 text-[9px] font-semibold uppercase tracking-wider bg-slate-100 dark:bg-slate-900 leading-tight",
                   headerGridBorder,
                  FROZEN_COLS.has(c.key) && "sticky z-[70]",
                  frozenDivider(c.key),
                )}>
                  {c.label === "Aksi" ? "" : ""}
                </th>
              ))}
              {/* Pendapatan group */}
              <th colSpan={pendapatanCols.length} className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white bg-emerald-600 border-r border-b border-white/25 dark:border-slate-800/70 text-center leading-tight">
                Pendapatan
              </th>
              {/* Potongan group */}
              <th colSpan={potonganCols.length} className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white bg-rose-600 border-r border-b border-white/25 dark:border-slate-800/70 text-center leading-tight">
                Potongan
              </th>
              {/* Netto group */}
              <th className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white bg-primary border-r border-b border-white/25 dark:border-slate-800/70 text-center leading-tight">
                Netto
              </th>
              {/* Rekening group */}
              <th colSpan={3} className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white bg-blue-600 border-r border-b border-white/25 dark:border-slate-800/70 text-center leading-tight">
                Rekening
              </th>
              {aksiCol && (
                <th style={getColumnStyle(aksiCol)} className={cn("h-6 px-1 py-0 text-[9px] font-semibold uppercase tracking-wider bg-slate-100 dark:bg-slate-900 border-l border-l-slate-200 dark:border-l-slate-800 leading-tight", headerGridBorder)}>
                  Aksi
                </th>
              )}
            </tr>
            {/* Row 2: Individual columns */}
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {SHEET_COLS.map((c) => {
                const groupBg = c.group === "pendapatan"
                  ? "bg-emerald-50 dark:bg-emerald-950"
                  : c.group === "potongan"
                  ? "bg-rose-50 dark:bg-rose-950"
                  : c.group === "netto"
                  ? "bg-blue-50 dark:bg-blue-950"
                  : c.group === "rekening"
                  ? "bg-sky-50 dark:bg-sky-950"
                  : "bg-slate-100 dark:bg-slate-900";
                return (
                  <th
                    key={c.key}
                    style={getColumnStyle(c)}
                    className={cn(
                      c.width,
                      "h-7 px-1 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-center leading-tight",
                      headerGridBorder,
                      groupBg,
                      (c.group === "info" || c.group === "rekening") && "font-normal text-[9px]",
                      FROZEN_COLS.has(c.key) && "sticky z-[70]",
                      frozenDivider(c.key),
                    )}
                  >
                    {c.label}
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* ── Body ── */}
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={SHEET_COLS.length} className="text-center py-24 text-sm text-muted-foreground">
                <CreditCard className="w-10 h-10 text-muted-foreground/15 mx-auto mb-2" />
                Belum ada data untuk periode ini
              </td></tr>
            ) : filtered.map((row, idx) => {
              const vals = wsData[row.id] || {};
              const computed = wsComputeTotals(row.id);
              const isChanged = wsChangedCells.has(row.id);
              const peg = row.pegawai as { bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null } | undefined;
              const rowBg = isChanged ? "bg-amber-50/70 dark:bg-amber-950/40" : idx % 2 === 0 ? "bg-card" : "bg-muted/30";
              const frozenBg = isChanged ? "bg-amber-50 dark:bg-amber-950" : idx % 2 === 0 ? "bg-card" : "bg-muted";
              return (
                <tr key={row.id} className={cn("border-b border-slate-200/80 dark:border-slate-800/80 transition-colors", rowBg)}>
                  {SHEET_COLS.map((c) => {
                      if (c.key === "_aksi") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                          <div className="flex items-center justify-center gap-0.5">
                            {!isReadOnly && canEdit && setBuatSlipConfirm && mode === "Worksheet" && (
                              <button
                                onClick={() => setBuatSlipConfirm({ ids: [row.id], mode: "single" })}
                                className="p-0.5 rounded-sm hover:bg-primary-light text-muted-foreground hover:text-primary"
                                title="Buat Slip"
                              >
                                <FileCheck className="w-2.5 h-2.5" />
                              </button>
                            )}
                            <button
                              onClick={() => exportSlipPDF(row)}
                              className="p-0.5 rounded-sm hover:bg-primary-light text-muted-foreground hover:text-primary"
                              title="PDF"
                            >
                              <Download className="w-2.5 h-2.5" />
                            </button>
                            {!isReadOnly && canEdit && (
                              <button
                                onClick={() => setDeleteConfirm?.({ id: row.id, nama: row.pegawaiNama || row.employee_id })}
                                className="p-0.5 rounded-sm hover:bg-danger/10 text-muted-foreground hover:text-danger"
                                title="Hapus"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            )}
                            {!isReadOnly && canEdit && isChanged && (
                              <button
                                onClick={() => handleWsSaveRow(row.id)}
                                disabled={wsSaving}
                                className={cn(
                                  "p-0.5 rounded-sm transition-colors",
                                  wsSaving ? "text-muted-foreground/50" : "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                                )}
                                title="Simpan"
                              >
                                {wsSaving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    }
                    if (c.key === "_no") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[9px] text-muted-foreground text-center sticky z-30 leading-tight", frozenBg, gridBorder)}>{idx + 1}</td>;
                    }
                    if (c.key === "_nama") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 sticky z-30", frozenBg, gridBorder, frozenDivider(c.key))}>
                          <p className="text-[10px] font-semibold text-foreground truncate leading-tight">{row.pegawaiNama}</p>
                        </td>
                      );
                    }
                    if (c.key === "_nik") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[9px] font-mono text-muted-foreground sticky z-30 leading-tight", frozenBg, gridBorder)}>{row.employee_id}</td>;
                    }
                    if (c.key === "_jabatan") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[9px] text-muted-foreground truncate leading-tight", gridBorder)}>{row.pegawaiJabatan}</td>;
                    }
                    if (c.key === "_status") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5", gridBorder)}>
                          <span className={cn(
                            "inline-block text-[9px] font-semibold px-1 py-0 rounded-sm leading-tight",
                            (row.pegawai as { status?: string } | undefined)?.status === "Aktif"
                              ? "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10"
                              : "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10"
                          )}>
                            {(row.pegawai as { status?: string } | undefined)?.status || "-"}
                          </span>
                        </td>
                      );
                    }
                    if (c.group === "pendapatan" && c.key !== "_total_pend") {
                      if (isKeteranganCol(c.key)) {
                        return (
                          <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                            <input
                              type="text"
                              value={wsKeterangan[row.id]?.[c.key] || ""}
                              onChange={(e) => handleWsKeteranganChange(row.id, c.key, e.target.value)}
                              placeholder="Ket."
                              onClick={(e) => e.stopPropagation()}
                              readOnly={!c.editable || isReadOnly}
                              className={cn(
                                "w-full text-[9px] tabular-nums px-1 py-0.5 rounded-sm border outline-none text-muted-foreground placeholder:text-muted-foreground/30 transition-all leading-tight",
                                (!c.editable || isReadOnly) && "!bg-transparent text-muted-foreground cursor-default border-transparent",
                                c.editable && !isReadOnly && !isCellChanged(row.id, c.key) && "border-transparent hover:border-border/60 focus:border-primary focus:ring-1 focus:ring-primary/20 bg-transparent",
                                c.editable && !isReadOnly && isCellChanged(row.id, c.key) && "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20",
                              )}
                            />
                          </td>
                        );
                      }
                      const isNum = typeof getCellNumeric(row, c) === "number";
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                          {c.editable ? cellInput(row, c) : (
                            <span className={cn(
                              "block text-right text-[10px] tabular-nums px-1 py-0.5 leading-tight",
                              "text-emerald-700 dark:text-emerald-400 font-medium"
                            )}>
                              {isNum ? formatCurrency(getCellNumeric(row, c)) : getCellValue(row, c)}
                            </span>
                          )}
                        </td>
                      );
                    }
                    if (c.key === "_total_pend") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-right text-[10px] font-bold text-emerald-800 dark:text-emerald-300 tabular-nums bg-emerald-50 dark:bg-emerald-950 leading-tight", gridBorder)}>
                          {getCellValue(row, c)}
                        </td>
                      );
                    }
                    if (c.group === "potongan" && c.key !== "_total_pot") {
                      if (isKeteranganCol(c.key)) {
                        return (
                          <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                            <input
                              type="text"
                              value={wsKeterangan[row.id]?.[c.key] || ""}
                              onChange={(e) => handleWsKeteranganChange(row.id, c.key, e.target.value)}
                              placeholder="Ket."
                              onClick={(e) => e.stopPropagation()}
                              readOnly={!c.editable || isReadOnly}
                              className={cn(
                                "w-full text-[9px] tabular-nums px-1 py-0.5 rounded-sm border outline-none text-muted-foreground placeholder:text-muted-foreground/30 transition-all leading-tight",
                                (!c.editable || isReadOnly) && "!bg-transparent text-muted-foreground cursor-default border-transparent",
                                c.editable && !isReadOnly && !isCellChanged(row.id, c.key) && "border-transparent hover:border-border/60 focus:border-primary focus:ring-1 focus:ring-primary/20 bg-transparent",
                                c.editable && !isReadOnly && isCellChanged(row.id, c.key) && "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20",
                              )}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                          {c.editable ? cellInput(row, c) : (
                            <span className={cn(
                              "block text-right text-[10px] tabular-nums px-1 py-0.5 leading-tight",
                              "text-rose-600 dark:text-rose-400 font-medium"
                            )}>
                              {formatCurrency(getCellNumeric(row, c))}
                            </span>
                          )}
                        </td>
                      );
                    }
                    if (c.key === "_total_pot") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-right text-[10px] font-bold text-rose-700 dark:text-rose-300 tabular-nums bg-rose-50 dark:bg-rose-950 leading-tight", gridBorder)}>
                          {getCellValue(row, c)}
                        </td>
                      );
                    }
                    if (c.key === "_netto") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-right text-[11px] font-extrabold tabular-nums bg-blue-50 dark:bg-blue-950 leading-tight", computed.netto >= 0 ? "text-primary" : "text-danger", gridBorder)}>
                          {getCellValue(row, c)}
                        </td>
                      );
                    }
                    if (c.key === "_bank") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[9px] text-muted-foreground leading-tight", gridBorder)}>{peg?.bank || "-"}</td>;
                    }
                    if (c.key === "_no_rek") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[9px] font-mono text-foreground leading-tight", gridBorder)}>{peg?.no_rekening || "-"}</td>;
                    }
                    if (c.key === "_an") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[9px] text-muted-foreground truncate leading-tight", gridBorder)}>{peg?.nama_rekening || "-"}</td>;
                    }
                    return null;
                  })}
                </tr>
              );
            })}
          </tbody>

          {/* ── Footer: Grand Total ── */}
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t border-slate-200 dark:border-slate-800 bg-card shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.06)]">
                {SHEET_COLS.map((c) => {
                  if (c.key === "_no") return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky z-40 bg-card", footerGridBorder)} />;
                  if (c.key === "_nama") return (
                    <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky z-40 bg-card", footerGridBorder, frozenDivider(c.key))}>
                      <p className="text-[9px] font-bold text-foreground uppercase tracking-wider leading-tight">Grand Total</p>
                    </td>
                  );
                  if (c.key === "_nik") return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky z-40 bg-card", footerGridBorder)} />;
                  if (c.key === "_jabatan" || c.key === "_status" || c.key === "_bank" || c.key === "_no_rek" || c.key === "_an" || c.key === "_aksi") {
                    return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1", footerGridBorder)} />;
                  }
                  if (c.key === "_total_pend") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[10px] font-extrabold text-emerald-800 dark:text-emerald-300 tabular-nums bg-emerald-50 dark:bg-emerald-950 leading-tight", footerGridBorder)}>
                        {getGrandTotal(c)}
                      </td>
                    );
                  }
                  if (c.key === "_total_pot") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[10px] font-extrabold text-rose-700 dark:text-rose-300 tabular-nums bg-rose-50 dark:bg-rose-950 leading-tight", footerGridBorder)}>
                        {getGrandTotal(c)}
                      </td>
                    );
                  }
                  if (c.key === "_netto") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[11px] font-extrabold text-primary tabular-nums bg-blue-50 dark:bg-blue-950 leading-tight", footerGridBorder)}>
                        {getGrandNetto()}
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[10px] font-bold text-foreground tabular-nums leading-tight", footerGridBorder)}>
                      {getGrandTotal(c)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
