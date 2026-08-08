"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
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
  Search,
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
  handleWsAutoSave: (id: number, immediate: boolean) => void;
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
const FROZEN_COLS = new Set(["_no", "_nik", "_nama", "_jabatan", "_status"]);
const NAME_COLUMN_MIN_WIDTH = 180;
const NAME_COLUMN_CHAR_WIDTH = 8;
const NAME_COLUMN_PADDING = 24;
const FIXED_COLUMN_WIDTHS: Record<string, number> = {
  _no: 48,
  _nik: 110,
  _jabatan: 128,
  _status: 80,
};

function getColumnWidth(col: { key: string; width: string }): number {
  if (FIXED_COLUMN_WIDTHS[col.key]) return FIXED_COLUMN_WIDTHS[col.key];
  if (col.width.includes("w-48")) return 192;
  if (col.width.includes("w-40")) return 160;
  if (col.width.includes("w-36")) return 144;
  if (col.width.includes("w-32")) return 128;
  if (col.width.includes("w-28")) return 112;
  if (col.width.includes("w-24")) return 96;
  if (col.width.includes("w-20")) return 80;
  return 112;
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
  handleWsAutoSave,
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

  // ─── Search ───
  const [searchQuery, setSearchQuery] = useState("");
  const displayedRows = useMemo(() => {
    if (!searchQuery.trim()) return filtered;
    const q = searchQuery.toLowerCase();
    return filtered.filter((r) =>
      `${r.pegawaiNama ?? ""} ${r.employee_id ?? ""} ${r.pegawaiJabatan ?? ""}`
        .toLowerCase().includes(q)
    );
  }, [filtered, searchQuery]);

  const nameColumnWidth = useMemo(() => {
    const longestNameLength = filtered.reduce(
      (longest, row) => Math.max(longest, Array.from(row.pegawaiNama?.trim() || "").length),
      "NAMA".length,
    );
    return Math.max(
      NAME_COLUMN_MIN_WIDTH,
      longestNameLength * NAME_COLUMN_CHAR_WIDTH + NAME_COLUMN_PADDING,
    );
  }, [filtered]);

  const frozenLeftPx = useMemo(() => {
    const noWidth = FIXED_COLUMN_WIDTHS._no;
    const nikWidth = FIXED_COLUMN_WIDTHS._nik;
    const jabatanWidth = FIXED_COLUMN_WIDTHS._jabatan;
    return {
      _no: 0,
      _nik: noWidth,
      _nama: noWidth + nikWidth,
      _jabatan: noWidth + nikWidth + nameColumnWidth,
      _status: noWidth + nikWidth + nameColumnWidth + jabatanWidth,
    };
  }, [nameColumnWidth]);

  // ─── Group header colors ───
  const GROUP_HEADER_COLORS: Record<string, string> = {
    info: "bg-[#a6a6a6]",
    pendapatan: "bg-[#c6efce]",
    potongan: "bg-[#ffc7ce]",
    netto: "bg-[#b4c6e7]",
    rekening: "bg-[#d9d9d9]",
  };

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
  const sheetLabels: Record<string, string> = {
    gaji_pokok: "GAPOK",
    pendapatan_titik: "GAPOK+TITIK",
    lembur: "LEMBUR",
    extra_job: "EXTRA JOB",
    uang_makan: "UANG MAKAN",
    insentif: "INSENTIF",
    tunjangan_jabatan: "TJH JABATAN",
    transport: "TRANSPORT",
    tunjangan_lain: "TUNJANGAN LAIN",
    tambahan_lain: "TAMBAHAN LAIN",
    koperasi: "KOPERASI",
    pinjaman_perusahaan: "PINJAMAN PERUSAHAAN",
    potongan_absen: "POTONGAN ABSEN",
    potongan_lain: "POTONGAN LAIN",
    jht: "JHT",
    bpjs_kesehatan: "BPJS KES",
  };
  const SHEET_COLS: SheetCol[] = [
    { label: "DRIVER", key: "_no", group: "info", width: "w-[48px]", editable: false },
    { label: "ID", key: "_nik", group: "info", width: "w-[110px]", editable: false },
    { label: "NAMA", key: "_nama", group: "info", width: "w-auto", editable: false },
    { label: "STATUS", key: "_jabatan", group: "info", width: "w-32", editable: false },
    { label: "AKTIF", key: "_status", group: "info", width: "w-20", editable: false },
    ...PENDAPATAN_FIELDS.filter((f) => f.key !== "total_pendapatan").flatMap((f) => {
      const cols: SheetCol[] = [{
        label: sheetLabels[f.key] ?? f.label.toUpperCase(),
        key: f.key,
        group: "pendapatan" as const,
        width: f.key === "gaji_pokok" || f.key === "pendapatan_titik" ? "w-28" : f.key === "lembur" ? "w-28" : "w-24",
        editable: !f.readonly && !READONLY_KEYS.has(f.key),
      }];
      if (f.keteranganKey) cols.push({
        label: "KET",
        key: f.keteranganKey,
        group: "pendapatan" as const,
        width: "w-40",
        editable: true,
      });
      return cols;
    }),
    { label: "TOTAL", key: "_total_pend", group: "pendapatan", width: "w-28", editable: false },
    ...POTONGAN_FIELDS.filter((f) => f.key !== "total_potongan").flatMap((f) => {
      const cols: SheetCol[] = [{
        label: sheetLabels[f.key] ?? f.label.toUpperCase(),
        key: f.key,
        group: "potongan" as const,
        width: "w-24",
        editable: !f.readonly && !READONLY_KEYS.has(f.key),
      }];
      if (f.keteranganKey) cols.push({
        label: "KET",
        key: f.keteranganKey,
        group: "potongan" as const,
        width: "w-40",
        editable: true,
      });
      return cols;
    }),
    { label: "TOTAL", key: "_total_pot", group: "potongan", width: "w-28", editable: false },
    { label: "NETTO INCOME", key: "_netto", group: "netto", width: "w-28", editable: false },
    { label: "NO REKENING", key: "_no_rek", group: "rekening", width: "w-32", editable: false },
    { label: "NAMA REKENING", key: "_an", group: "rekening", width: "w-32", editable: false },
    { label: "BANK", key: "_bank", group: "rekening", width: "w-20", editable: false },
    { label: "AKSI", key: "_aksi", group: "info", width: "w-24", editable: false },
  ];

  const pendapatanCols = SHEET_COLS.filter((c) => c.group === "pendapatan");
  const potonganCols = SHEET_COLS.filter((c) => c.group === "potongan");
  const leadingInfoCols = SHEET_COLS.filter((c) => ["_no", "_nik", "_nama", "_jabatan", "_status"].includes(c.key));
  const aksiCol = SHEET_COLS.find((c) => c.key === "_aksi");

  const getResolvedColumnWidth = (col: SheetCol): number =>
    col.key === "_nama" ? nameColumnWidth : getColumnWidth(col);

  const getColumnStyle = (col: SheetCol): React.CSSProperties => {
    const width = getResolvedColumnWidth(col);
    const left = frozenLeftPx[col.key as keyof typeof frozenLeftPx];
    return {
      width,
      minWidth: width,
      maxWidth: width,
      ...(left !== undefined ? { left } : {}),
    };
  };

  const isKeteranganCol = (key: string) => key.endsWith("_keterangan");
  const gridBorder = "border-r border-b border-dotted border-slate-500/80";
  const headerGridBorder = "border-r border-b border-dotted border-slate-500/80";
  const footerGridBorder = "border-r border-t border-dotted border-slate-500/80";
  const frozenDivider = (key: string) => key === "_status" && "border-r-2 border-dotted border-r-slate-600";

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
    if (col.key === "_total_pend") return formatCurrency(displayedRows.reduce((s, r) => s + wsComputeTotals(r.id).totalPendapatan, 0));
    if (col.key === "_total_pot") return formatCurrency(displayedRows.reduce((s, r) => s + wsComputeTotals(r.id).totalPotongan, 0));
    if (isKeteranganCol(col.key)) return "";
    return formatCurrency(displayedRows.reduce((s, r) => s + getCellNumeric(r, col), 0));
  };

  const getGrandNetto = () => formatCurrency(displayedRows.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0));

  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const registerCellRef = (rowId: number, colKey: string) => (el: HTMLInputElement | null) => {
    const key = `${rowId}|${colKey}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  };

  /** Enter: pindah ke sel dengan kolom yang sama di baris berikutnya (seperti spreadsheet). */
  const focusNextRowCell = (rowId: number, colKey: string) => {
    const idx = displayedRows.findIndex((r) => r.id === rowId);
    if (idx < 0 || idx >= displayedRows.length - 1) return;
    const nextId = displayedRows[idx + 1].id;
    const el = cellRefs.current.get(`${nextId}|${colKey}`);
    if (el && !el.readOnly) {
      el.scrollIntoView({ block: "nearest", behavior: "auto" });
      el.focus();
      el.select();
    }
  };

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
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!isReadOnly && col.editable) {
              handleWsAutoSave(row.id, true);
              focusNextRowCell(row.id, col.key);
            }
          }
        }}
        onBlur={() => {
          if (!isReadOnly && col.editable) handleWsAutoSave(row.id, false);
        }}
        readOnly={!col.editable || isReadOnly}
        ref={registerCellRef(row.id, col.key)}
        className={cn(
          "w-full text-right text-[11px] tabular-nums px-1 py-0.5 rounded-sm border outline-none text-slate-950 placeholder:text-slate-400 transition-all leading-tight",
          (!col.editable || isReadOnly) && "!bg-transparent text-slate-700 cursor-default border-transparent",
          col.editable && !isReadOnly && !isCellChanged(row.id, col.key) && "border-transparent hover:border-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-200 bg-transparent",
          col.editable && !isReadOnly && isCellChanged(row.id, col.key) && "border-amber-500 bg-amber-50 ring-1 ring-amber-200",
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
            <p className="text-[10px] text-muted-foreground">
              {searchQuery ? `${displayedRows.length} / ${filtered.length} pegawai` : `${filtered.length} pegawai`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-xl p-0.5">
            <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground"><ChevronLeft className="w-3.5 h-3.5" /></button>
            <span className="text-[11px] font-bold text-foreground px-2.5 min-w-[200px] text-center whitespace-nowrap">{period.label}</span>
            <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground"><ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex items-center bg-muted rounded-xl px-2.5 py-1.5 w-44">
            <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              placeholder="Cari pegawai..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-[11px] outline-none w-full placeholder:text-muted-foreground/50 text-foreground ml-1.5"
            />
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
      <div ref={tableRef} className="payroll-sheet-scrollbar flex-1 overflow-auto bg-white [scrollbar-gutter:stable]">
        <table className="w-max min-w-full border-separate border-spacing-0 bg-white text-slate-950">
          <colgroup>
            {SHEET_COLS.map((c) => {
              const width = getResolvedColumnWidth(c);
              return <col key={c.key} style={{ width, minWidth: width, maxWidth: width }} />;
            })}
          </colgroup>
          {/* ── Group header row ── */}
          <thead className="sticky top-0 z-50 shadow-[0_3px_10px_-6px_rgba(15,23,42,0.8)]">
            {/* Row 1: Group labels */}
            <tr className="border-b border-dotted border-slate-500/80">
              {/* Info group */}
              {leadingInfoCols.map((c) => (
                <th key={c.key} style={getColumnStyle(c)} className={cn(
                  c.width,
                   "h-6 px-1 py-0 text-[9px] font-bold uppercase tracking-wider bg-[#a6a6a6] text-black leading-tight",
                   headerGridBorder,
                  FROZEN_COLS.has(c.key) && "sticky z-[70]",
                  frozenDivider(c.key),
                )}>
                  {c.label === "Aksi" ? "" : ""}
                </th>
              ))}
              {/* Pendapatan group */}
              <th colSpan={pendapatanCols.length} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black bg-[#c6efce] border-r border-b border-dotted border-slate-500/80 text-center leading-tight">
                PENDAPATAN
              </th>
              {/* Potongan group */}
              <th colSpan={potonganCols.length} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black bg-[#ffc7ce] border-r border-b border-dotted border-slate-500/80 text-center leading-tight">
                PENGELUARAN/POTONGAN
              </th>
              {/* Netto group */}
              <th className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black bg-[#b4c6e7] border-r border-b border-dotted border-slate-500/80 text-center leading-tight">
                NETTO INCOME
              </th>
              {/* Rekening group */}
              <th colSpan={3} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black bg-[#d9d9d9] border-r border-b border-dotted border-slate-500/80 text-center leading-tight">
                REKENING
              </th>
              {aksiCol && (
                <th style={getColumnStyle(aksiCol)} className={cn("h-6 px-1 py-0 text-[9px] font-bold uppercase tracking-wider bg-[#a6a6a6] text-black border-l border-dotted border-l-slate-500/80 leading-tight", headerGridBorder)}>
                  Aksi
                </th>
              )}
            </tr>
            {/* Row 2: Individual columns */}
            <tr className="border-b border-dotted border-slate-500/80">
              {SHEET_COLS.map((c) => {
                const groupBg = `${GROUP_HEADER_COLORS[c.group] ?? "bg-[#d9d9d9]"} text-black`;
                return (
                  <th
                    key={c.key}
                    style={getColumnStyle(c)}
                    title={c.label}
                    className={cn(
                      c.width,
                      "px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-center leading-tight break-words overflow-hidden",
                      headerGridBorder,
                      groupBg,
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
            {displayedRows.length === 0 ? (
              <tr><td colSpan={SHEET_COLS.length} className="bg-white text-center py-24 text-sm text-slate-500">
                <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                {searchQuery ? "Tidak ada pegawai yang cocok dengan pencarian" : "Belum ada data untuk periode ini"}
              </td></tr>
            ) : displayedRows.map((row, idx) => {
              const vals = wsData[row.id] || {};
              const computed = wsComputeTotals(row.id);
              const isChanged = wsChangedCells.has(row.id);
              const peg = row.pegawai as { bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null } | undefined;
              const rowBg = isChanged ? "bg-amber-50" : idx % 2 === 0 ? "bg-white" : "bg-[#fafafa]";
              const frozenBg = isChanged ? "bg-amber-50" : idx % 2 === 0 ? "bg-white" : "bg-[#fafafa]";
              return (
                <tr key={row.id} className={cn("border-b border-dotted border-slate-500/80 text-slate-950 transition-colors", rowBg)}>
                  {SHEET_COLS.map((c) => {
                      if (c.key === "_aksi") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                          <div className="flex items-center justify-center gap-0.5">
                            {!isReadOnly && canEdit && setBuatSlipConfirm && mode === "Worksheet" && (
                              <button
                                onClick={() => setBuatSlipConfirm({ ids: [row.id], mode: "single" })}
                                className="p-0.5 rounded-sm text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                                title="Buat Slip"
                              >
                                <FileCheck className="w-2.5 h-2.5" />
                              </button>
                            )}
                            <button
                              onClick={() => exportSlipPDF(row)}
                              className="p-0.5 rounded-sm text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                              title="PDF"
                            >
                              <Download className="w-2.5 h-2.5" />
                            </button>
                            {!isReadOnly && canEdit && (
                              <button
                                onClick={() => setDeleteConfirm?.({ id: row.id, nama: row.pegawaiNama || row.employee_id })}
                                className="p-0.5 rounded-sm text-slate-500 hover:bg-rose-50 hover:text-rose-700"
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
                                  wsSaving ? "text-slate-300" : "text-amber-700 hover:bg-amber-50"
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
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[10px] text-slate-600 text-center sticky z-30 leading-tight", frozenBg, gridBorder)}>{idx + 1}</td>;
                    }
                    if (c.key === "_nama") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 sticky z-30", frozenBg, gridBorder, frozenDivider(c.key))}>
                          <p className="text-[11px] font-semibold text-slate-950 truncate leading-tight">{row.pegawaiNama}</p>
                        </td>
                      );
                    }
                    if (c.key === "_nik") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[10px] font-mono text-slate-600 sticky z-30 leading-tight", frozenBg, gridBorder)}>{row.employee_id}</td>;
                    }
                    if (c.key === "_jabatan") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[10px] text-slate-700 truncate leading-tight sticky z-30", frozenBg, gridBorder)}>{row.pegawaiJabatan}</td>;
                    }
                    if (c.key === "_status") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 sticky z-30", frozenBg, gridBorder, frozenDivider(c.key))}>
                          <span className={cn(
                            "inline-block text-[10px] font-semibold px-1 py-0 rounded-sm leading-tight",
                            (row.pegawai as { status?: string } | undefined)?.status === "Aktif"
                              ? "text-emerald-700 bg-emerald-100"
                              : "text-amber-700 bg-amber-100"
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
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (!isReadOnly && c.editable) {
                                    handleWsAutoSave(row.id, true);
                                    focusNextRowCell(row.id, c.key);
                                  }
                                }
                              }}
                              onBlur={() => {
                                if (!isReadOnly && c.editable) handleWsAutoSave(row.id, false);
                              }}
                              readOnly={!c.editable || isReadOnly}
                              ref={registerCellRef(row.id, c.key)}
                              className={cn(
                                "w-full text-[10px] tabular-nums px-1 py-0.5 rounded-sm border outline-none text-slate-700 placeholder:text-slate-400 transition-all leading-tight",
                                (!c.editable || isReadOnly) && "!bg-transparent text-slate-600 cursor-default border-transparent",
                                c.editable && !isReadOnly && !isCellChanged(row.id, c.key) && "border-transparent hover:border-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-200 bg-transparent",
                                c.editable && !isReadOnly && isCellChanged(row.id, c.key) && "border-amber-500 bg-amber-50 ring-1 ring-amber-200",
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
                              "block text-right text-[11px] tabular-nums px-1 py-0.5 leading-tight",
                              "text-slate-950 font-medium"
                            )}>
                              {isNum ? formatCurrency(getCellNumeric(row, c)) : getCellValue(row, c)}
                            </span>
                          )}
                        </td>
                      );
                    }
                    if (c.key === "_total_pend") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-right text-[11px] font-bold text-slate-950 tabular-nums bg-[#e6e6e6] leading-tight", gridBorder)}>
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
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (!isReadOnly && c.editable) {
                                    handleWsAutoSave(row.id, true);
                                    focusNextRowCell(row.id, c.key);
                                  }
                                }
                              }}
                              onBlur={() => {
                                if (!isReadOnly && c.editable) handleWsAutoSave(row.id, false);
                              }}
                              readOnly={!c.editable || isReadOnly}
                              ref={registerCellRef(row.id, c.key)}
                              className={cn(
                                "w-full text-[10px] tabular-nums px-1 py-0.5 rounded-sm border outline-none text-slate-700 placeholder:text-slate-400 transition-all leading-tight",
                                (!c.editable || isReadOnly) && "!bg-transparent text-slate-600 cursor-default border-transparent",
                                c.editable && !isReadOnly && !isCellChanged(row.id, c.key) && "border-transparent hover:border-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-200 bg-transparent",
                                c.editable && !isReadOnly && isCellChanged(row.id, c.key) && "border-amber-500 bg-amber-50 ring-1 ring-amber-200",
                              )}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                          {c.editable ? cellInput(row, c) : (
                              <span className={cn(
                                "block text-right text-[11px] tabular-nums px-1 py-0.5 leading-tight",
                                "text-slate-950 font-medium"
                              )}>
                                {formatCurrency(getCellNumeric(row, c))}
                              </span>
                          )}
                        </td>
                      );
                    }
                    if (c.key === "_total_pot") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-right text-[11px] font-bold text-slate-950 tabular-nums bg-[#e6e6e6] leading-tight", gridBorder)}>
                          {getCellValue(row, c)}
                        </td>
                      );
                    }
                    if (c.key === "_netto") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-right text-[12px] font-extrabold text-slate-950 tabular-nums bg-[#e6e6e6] leading-tight", gridBorder)}>
                          {getCellValue(row, c)}
                        </td>
                      );
                    }
                    if (c.key === "_bank") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[10px] text-slate-700 leading-tight", gridBorder)}>{peg?.bank || "-"}</td>;
                    }
                    if (c.key === "_no_rek") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[10px] font-mono text-slate-950 leading-tight", gridBorder)}>{peg?.no_rekening || "-"}</td>;
                    }
                    if (c.key === "_an") {
                      return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 text-[10px] text-slate-700 truncate leading-tight", gridBorder)}>{peg?.nama_rekening || "-"}</td>;
                    }
                    return null;
                  })}
                </tr>
              );
            })}
          </tbody>

          {/* ── Footer: Grand Total ── */}
          {displayedRows.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t border-dotted border-slate-500/80 bg-white text-slate-950 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.06)]">
                {SHEET_COLS.map((c) => {
                  if (c.key === "_no") return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky z-40 bg-white", footerGridBorder)} />;
                  if (c.key === "_nama") return (
                    <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky z-40 bg-white", footerGridBorder, frozenDivider(c.key))}>
                      <p className="text-[10px] font-bold text-slate-950 uppercase tracking-wider leading-tight">Grand Total</p>
                    </td>
                  );
                  if (c.key === "_nik") return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky z-40 bg-white", footerGridBorder)} />;
                  if (c.key === "_jabatan" || c.key === "_status") {
                    return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky z-40 bg-white", footerGridBorder, frozenDivider(c.key))} />;
                  }
                  if (c.key === "_bank" || c.key === "_no_rek" || c.key === "_an" || c.key === "_aksi") {
                    return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1", footerGridBorder)} />;
                  }
                  if (c.key === "_total_pend") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[11px] font-extrabold text-emerald-800 tabular-nums bg-emerald-50 leading-tight", footerGridBorder)}>
                        {getGrandTotal(c)}
                      </td>
                    );
                  }
                  if (c.key === "_total_pot") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[11px] font-extrabold text-rose-700 tabular-nums bg-rose-50 leading-tight", footerGridBorder)}>
                        {getGrandTotal(c)}
                      </td>
                    );
                  }
                  if (c.key === "_netto") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[12px] font-extrabold text-blue-800 tabular-nums bg-blue-50 leading-tight", footerGridBorder)}>
                        {getGrandNetto()}
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[11px] font-bold text-slate-950 tabular-nums bg-white leading-tight", footerGridBorder)}>
                      {getGrandTotal(c)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <style jsx>{`
        :global(.payroll-sheet-scrollbar) {
          scrollbar-width: auto;
          scrollbar-color: #94a3b8 #e2e8f0;
        }

        :global(.payroll-sheet-scrollbar::-webkit-scrollbar) {
          width: 10px;
          height: 14px;
        }

        :global(.payroll-sheet-scrollbar::-webkit-scrollbar-track) {
          background: #e2e8f0;
          border-radius: 9999px;
        }

        :global(.payroll-sheet-scrollbar::-webkit-scrollbar-thumb) {
          background: #94a3b8;
          border: 2px solid #e2e8f0;
          border-radius: 9999px;
        }

        :global(.payroll-sheet-scrollbar::-webkit-scrollbar-thumb:hover) {
          background: #64748b;
        }
      `}</style>
    </div>
  );
}
