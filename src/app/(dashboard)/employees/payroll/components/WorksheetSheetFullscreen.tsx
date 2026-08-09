"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
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
  GripVertical,
  CheckCircle2,
  Copy,
  Check,
  AlertTriangle,
  Users,
  Plus,
  MousePointerClick,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS, formatInputCurrency, type PayrollRow } from "../constants";
import type { DbPayrollGroup } from "@/lib/supabase";

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
  orderSaving: boolean;
  orderSavedTick: number;
  handleReorderRow: (movedId: string, targetId: string, placement: "before" | "after") => void;
  groups: DbPayrollGroup[];
  employeeGroups: Map<string, number>;
  handleMoveToGroup: (movedId: string, groupId: number | null) => void;
  handleCreateGroup: (nama: string, warna: string, memberIds: string[]) => Promise<boolean>;
  handleDeleteGroup: (groupId: number) => void;
  handleReorderGroups: (fromId: number, toId: number) => void;
  groupSaving: boolean;
  groupSavedTick: number;
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
  orderSaving,
  orderSavedTick,
  handleReorderRow,
  groups,
  employeeGroups,
  handleMoveToGroup,
  handleCreateGroup,
  handleDeleteGroup,
  handleReorderGroups,
  groupSaving,
  groupSavedTick,
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
  const searchedRows = useMemo(() => {
    if (!searchQuery.trim()) return filtered;
    const q = searchQuery.toLowerCase();
    return filtered.filter((r) =>
      `${r.pegawaiNama ?? ""} ${r.employee_id ?? ""} ${r.pegawaiJabatan ?? ""}`
        .toLowerCase().includes(q)
    );
  }, [filtered, searchQuery]);

  // ─── Kelompok pegawai ───
  const [groupFilter, setGroupFilter] = useState<"all" | "ungrouped" | number>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const selAnchor = useRef<string | null>(null);
  /** Row yang diklik terakhir (highlight biru). */
  const [activeRowId, setActiveRowId] = useState<number | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupNama, setGroupNama] = useState("");
  const [groupWarna, setGroupWarna] = useState("#3b82f6");
  const [groupSavedFlash, setGroupSavedFlash] = useState(false);
  /** Band header yang sedang di-drag (reorder prioritas kelompok). */
  const [dragGroupId, setDragGroupId] = useState<number | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);

  const canGroupEdit = canEdit && !groupSaving;

  useEffect(() => {
    if (groupSavedTick === 0) return;
    setGroupSavedFlash(true);
    const t = setTimeout(() => setGroupSavedFlash(false), 2000);
    return () => clearTimeout(t);
  }, [groupSavedTick]);

  const groupOf = (empId: string): number | null => employeeGroups.get(empId) ?? null;
  const groupById = (gid: number | null) => gid === null ? null : groups.find((g) => g.id === gid) ?? null;

  /** Baris tampil setelah filter kelompok di-clip: "all" | "ungrouped" | groupId. */
  const displayedRows = useMemo(() => {
    if (groupFilter === "all") return searchedRows;
    if (groupFilter === "ungrouped") return searchedRows.filter((r) => !employeeGroups.has(r.employee_id));
    return searchedRows.filter((r) => employeeGroups.get(r.employee_id) === groupFilter);
  }, [searchedRows, groupFilter, employeeGroups]);

  /** Kelompok yang muncul di render (urut sesuai tampilan), plus band "Belum Dikelompokkan" jika ada anggota. */
  const visibleGroupOrder = useMemo(() => {
    const ids = new Set<number>();
    let hasUngrouped = false;
    searchedRows.forEach((r) => {
      const gid = employeeGroups.get(r.employee_id);
      if (gid === undefined) hasUngrouped = true;
      else ids.add(gid);
    });
    const ordered = groups.filter((g) => ids.has(g.id));
    return { orderedGroupIds: ordered.map((g) => g.id), hasUngrouped };
  }, [searchedRows, employeeGroups, groups]);

  const groupCount = useCallback((gid: number | null) => {
    if (gid === null) return searchedRows.filter((r) => !employeeGroups.has(r.employee_id)).length;
    return searchedRows.filter((r) => employeeGroups.get(r.employee_id) === gid).length;
  }, [searchedRows, employeeGroups]);

  const totalPerGroup = useCallback((gid: number | null) => {
    let sum = 0;
    searchedRows.filter((r) => (gid === null ? !employeeGroups.has(r.employee_id) : employeeGroups.get(r.employee_id) === gid))
      .forEach((r) => { sum += wsComputeTotals(r.id).netto; });
    return sum;
  }, [searchedRows, employeeGroups, wsComputeTotals]);

  // ─── Pilih baris (mode kelompok) ───
  const toggleSelect = (empId: string, shift: boolean, idx: number) => {
    setSelIds((prev) => {
      const next = new Set(prev);
      if (shift && selAnchor.current) {
        const anchorIdx = displayedRows.findIndex((r) => r.employee_id === selAnchor.current);
        if (anchorIdx >= 0) {
          const [lo, hi] = anchorIdx < idx ? [anchorIdx, idx] : [idx, anchorIdx];
          for (let i = lo; i <= hi; i++) next.add(displayedRows[i].employee_id);
        }
      } else if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      selAnchor.current = shift ? selAnchor.current : empId;
      return next;
    });
  };

  const clearSelection = () => { setSelIds(new Set()); selAnchor.current = null; };

  // ─── Urutan baris (drag / keyboard) ───
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<"before" | "after">("before");
  const [orderSavedFlash, setOrderSavedFlash] = useState(false);
  const canReorder = canEdit && !orderSaving && !groupSaving;
  const dragActive = dragIdx !== null;
  const canDragNow = canEdit && !orderSaving && !groupSaving && !searchQuery.trim() && !selectMode;

  useEffect(() => {
    if (orderSavedTick === 0) return;
    setOrderSavedFlash(true);
    const t = setTimeout(() => setOrderSavedFlash(false), 2000);
    return () => clearTimeout(t);
  }, [orderSavedTick]);

  const resetDrag = () => { setDragIdx(null); setDragOverIdx(null); setDragOverPosition("before"); setDragGroupId(null); setDragOverGroupId(null); };

  /** Group band diklik = drop target: pindahkan pegawai KE kelompok ini, atau reorder prioritas bila drop band lain. */
  const handleBandDragOver = (e: React.DragEvent, gid: number | null) => {
    if (!dragActive && dragGroupId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupId(gid);
  };

  const handleBandDrop = (e: React.DragEvent, gid: number | null, ignore = false) => {
    e.preventDefault();
    if (!ignore) {
      // Drop band kelompok lain di atas band ini = reorder prioritas kelompok.
      if (dragGroupId !== null && gid !== null && dragGroupId !== gid) {
        handleReorderGroups(dragGroupId, gid);
        resetDrag();
        return;
      }
      // Drop pegawai ke band = pindahkan masuk kelompok (atau keluar jika band "Tanpa Kelompok").
      if (dragIdx !== null && dragIdx < displayedRows.length) {
        const moved = displayedRows[dragIdx];
        if (moved) handleMoveToGroup(moved.employee_id, gid);
      }
    }
    resetDrag();
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    if (searchQuery.trim() || !canReorder) return;
    setDragIdx(idx);
    const ghost = document.createElement("div");
    ghost.style.opacity = "0";
    ghost.style.position = "absolute";
    ghost.style.top = "-9999px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleRowDragOver = (e: React.DragEvent, idx: number) => {
    if (!dragActive) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    setDragOverPosition(e.clientY < rect.top + rect.height / 2 ? "before" : "after");
    setDragOverIdx(idx);
  };

  const handleRowDrop = (e: React.DragEvent, row: PayrollRow, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { resetDrag(); return; }
    const moved = displayedRows[dragIdx];
    if (!moved || moved.employee_id === row.employee_id) { resetDrag(); return; }
    handleReorderRow(moved.employee_id, row.employee_id, dragOverPosition === "after" ? "after" : "before");
    resetDrag();
  };

  /** Keyboard: panah atas/bawah pada handle grip. */
  const handleGripKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, row: PayrollRow, idx: number) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (!canReorder || searchQuery.trim()) return;
    if (e.key === "ArrowDown") {
      const next = displayedRows[idx + 1];
      if (next) handleReorderRow(row.employee_id, next.employee_id, "after");
    } else {
      const prev = displayedRows[idx - 1];
      if (prev) handleReorderRow(row.employee_id, prev.employee_id, "before");
    }
  };

  // ─── Copy per kolom / per baris (TSV agar paste ke Excel/Spreadsheet) ───
  const [copyFlash, setCopyFlash] = useState<{ kind: "col" | "row"; key: string } | null>(null);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!copyFlash) return;
    const t = setTimeout(() => setCopyFlash(null), 1500);
    return () => clearTimeout(t);
  }, [copyFlash]);

  useEffect(() => {
    if (!copyError) return;
    const t = setTimeout(() => setCopyError(false), 2500);
    return () => clearTimeout(t);
  }, [copyError]);

  const copyToClipboard = async (text: string, kind: "col" | "row", key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        setCopyError(true);
        return;
      }
    }
    setCopyFlash({ kind, key });
  };

  const isCopied = (kind: "col" | "row", key: string) => copyFlash?.kind === kind && copyFlash.key === key;

  /** Nilai mentah (tanpa format Rp/ribuan) agar dikenali Excel sebagai angka. */
  const getRawCellText = (row: PayrollRow, col: SheetCol, idx: number): string => {
    const peg = row.pegawai as { bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null; status?: string } | undefined;
    switch (col.key) {
      case "_no": return String(idx + 1);
      case "_nik": return row.employee_id;
      case "_nama": return row.pegawaiNama || "";
      case "_jabatan": return row.pegawaiJabatan || "-";
      case "_status": return peg?.status || "-";
      case "_total_pend": return String(wsComputeTotals(row.id).totalPendapatan);
      case "_total_pot": return String(wsComputeTotals(row.id).totalPotongan);
      case "_netto": return String(wsComputeTotals(row.id).netto);
      case "_bank": return peg?.bank || "-";
      case "_no_rek": return peg?.no_rekening || "-";
      case "_an": return peg?.nama_rekening || "-";
      case "_aksi": return "";
      default:
        if (isKeteranganCol(col.key)) return wsKeterangan[row.id]?.[col.key] || "";
        const vals = wsData[row.id];
        return vals ? String(vals[col.key] || 0) : "0";
    }
  };

  const copyColumn = (col: SheetCol) => {
    const lines = [col.label, ...displayedRows.map((r, i) => getRawCellText(r, col, i))];
    copyToClipboard(lines.join("\n"), "col", col.key);
  };

  const copyRow = (row: PayrollRow, idx: number) => {
    const cols = SHEET_COLS.filter((c) => c.key !== "_aksi");
    const header = [...cols.map((c) => c.label), "KELOMPOK"].join("\t");
    const values = [...cols.map((c) => getRawCellText(row, c, idx)), groupById(groupOf(row.employee_id))?.nama ?? ""].join("\t");
    copyToClipboard(`${header}\n${values}`, "row", String(row.id));
  };

  /** Item render: band kelompok & baris pegawai (band disisipkan saat ganti kelompok). */
  const renderItems = useMemo(() => {
    type Item = { kind: "band"; gid: number | null } | { kind: "row"; row: PayrollRow; idx: number };
    const items: Item[] = [];
    if (groupFilter === "all") {
      let cur: number | null = null;
      let first = true;
      displayedRows.forEach((row, idx) => {
        const gid = employeeGroups.get(row.employee_id) ?? null;
        if (first || gid !== cur) {
          items.push({ kind: "band", gid });
          cur = gid;
          first = false;
        }
        items.push({ kind: "row", row, idx });
      });
    } else {
      const gid = groupFilter === "ungrouped" ? null : groupFilter;
      if (displayedRows.length > 0) items.push({ kind: "band", gid });
      displayedRows.forEach((row, idx) => items.push({ kind: "row", row, idx }));
    }
    return items;
  }, [displayedRows, groupFilter, employeeGroups]);

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
    info: "bg-[#1f2937] text-white",
    pendapatan: "bg-[#047857] text-white",
    potongan: "bg-[#be123c] text-white",
    netto: "bg-[#1d4ed8] text-white",
    rekening: "bg-[#475569] text-white",
  };
  const COLUMN_HEADER_COLORS: Record<string, string> = {
    info: "bg-[#e2e8f0] text-[#334155]",
    pendapatan: "bg-[#d1fae5] text-[#065f46]",
    potongan: "bg-[#ffe4e6] text-[#9f1239]",
    netto: "bg-[#dbeafe] text-[#1e40af]",
    rekening: "bg-[#e2e8f0] text-[#334155]",
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
    { label: "NO", key: "_no", group: "info", width: "w-[48px]", editable: false },
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
  const nettoCol = SHEET_COLS.find((c) => c.key === "_netto");

  /** Tombol copy pada header kolom. */
  const HeaderCopyButton = ({ col }: { col: SheetCol }) => {
    const copied = isCopied("col", col.key);
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); copyColumn(col); }}
        title={copied ? "Kolom tersalin!" : `Salin kolom ${col.label} (TSV)`}
        className={cn(
          "inline-flex items-center justify-center rounded-sm p-0.5 align-middle transition-colors",
          copied ? "text-emerald-400 bg-emerald-100/30" : "text-current/60 opacity-70 hover:opacity-100 hover:text-current hover:bg-white/20",
        )}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    );
  };

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
  const headerGridBorder = "border-r border-b border-slate-400/60";
  const footerGridBorder = "border-r border-t border-dotted border-slate-500/80";
  const frozenDivider = (key: string) => key === "_status" && "border-r-2 border-solid border-r-slate-600";

  const dragIndicator = (idx: number) => {
    if (dragIdx === null || dragOverIdx !== idx) return "";
    return dragOverPosition === "before"
      ? "shadow-[inset_0_2px_0_0_rgba(37,99,235,0.75)] bg-blue-50/60"
      : "shadow-[inset_0_-2px_0_0_rgba(37,99,235,0.75)] bg-blue-50/60";
  };

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
            {(orderSaving || orderSavedFlash) && (
              <div className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-colors",
                orderSaving ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
              )}>
                {orderSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {orderSaving ? "Menyimpan urutan..." : "Urutan tersimpan"}
              </div>
            )}
            {(groupSaving || groupSavedFlash) && (
              <div className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-colors",
                groupSaving ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
              )}>
                {groupSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {groupSaving ? "Menyimpan kelompok..." : "Kelompok tersimpan"}
              </div>
            )}
            {copyError && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold bg-rose-50 text-rose-700">
                <AlertTriangle className="w-3 h-3" />
                Gagal menyalin ke clipboard
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                onClick={() => { setSelectMode((v) => !v); clearSelection(); }}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors",
                  selectMode ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30" : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
                title={selectMode ? "Keluar dari mode pilih baris" : "Pilih beberapa baris untuk membuat kelompok"}
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                {selectMode ? "Selesai Pilih" : "Pilih Baris"}
              </button>
            )}
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

      {/* ── Chip filter kelompok ── */}
      <div className="flex items-center gap-1.5 px-5 py-1.5 border-b border-border bg-card flex-shrink-0 overflow-x-auto payroll-group-chips">
        <button
          onClick={() => setGroupFilter("all")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors border",
            groupFilter === "all" ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300",
          )}
        >
          <Users className="w-3 h-3" /> Semua <span className="opacity-70">({searchedRows.length})</span>
        </button>
        {groups.map((g) => {
          const cnt = groupCount(g.id);
          if (cnt === 0) return null;
          return (
            <button
              key={g.id}
              onClick={() => setGroupFilter(g.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors border",
                groupFilter === g.id ? "text-white border-transparent" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300",
              )}
              style={groupFilter === g.id ? { backgroundColor: g.warna } : undefined}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.warna }} />
              {g.nama} <span className="opacity-70">({cnt})</span>
            </button>
          );
        })}
        {visibleGroupOrder.hasUngrouped && (
          <button
            onClick={() => setGroupFilter("ungrouped")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors border",
              groupFilter === "ungrouped" ? "bg-slate-400 text-white border-slate-400" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300",
            )}
          >
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            Tanpa Kelompok <span className="opacity-70">({groupCount(null)})</span>
          </button>
        )}
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
            <tr className="border-b border-slate-400/60">
              {/* Info group */}
              {leadingInfoCols.map((c) => (
                <th key={c.key} rowSpan={2} style={getColumnStyle(c)} title={c.label} className={cn(
                  c.width,
                  "px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-center leading-tight break-words overflow-hidden align-middle",
                  GROUP_HEADER_COLORS.info,
                  headerGridBorder,
                  FROZEN_COLS.has(c.key) && "sticky z-[70]",
                  frozenDivider(c.key),
                )}>
                  {c.label}
                  <HeaderCopyButton col={c} />
                </th>
              ))}
              {/* Pendapatan group */}
              <th colSpan={pendapatanCols.length} className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[#047857] text-white border-r border-b border-slate-400/60 text-center leading-tight">
                PENDAPATAN
              </th>
              {/* Potongan group */}
              <th colSpan={potonganCols.length} className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[#be123c] text-white border-r border-b border-slate-400/60 text-center leading-tight">
                PENGELUARAN/POTONGAN
              </th>
              {/* Netto group */}
              {nettoCol && (
                <th rowSpan={2} style={getColumnStyle(nettoCol)} className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-center leading-tight break-words overflow-hidden bg-[#1d4ed8] text-white border-r border-b border-slate-400/60 align-middle">
                  <HeaderCopyButton col={nettoCol} />
                  NETTO INCOME
                </th>
              )}
              {/* Rekening group */}
              <th colSpan={3} className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[#475569] text-white border-r border-b border-slate-400/60 text-center leading-tight">
                REKENING
              </th>
              {aksiCol && (
                <th rowSpan={2} style={getColumnStyle(aksiCol)} className={cn("px-1 py-1 text-[9px] font-bold uppercase tracking-wider text-center align-middle bg-[#334155] text-white border-l border-solid border-l-slate-400/60 leading-tight", headerGridBorder)}>
                  Aksi
                </th>
              )}
            </tr>
            {/* Row 2: Individual columns */}
            <tr className="border-b border-slate-400/60">
              {SHEET_COLS.filter((c) => !FROZEN_COLS.has(c.key) && c.key !== "_netto" && c.key !== "_aksi").map((c) => {
                const groupBg = COLUMN_HEADER_COLORS[c.group] ?? "bg-[#e2e8f0] text-[#334155]";
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
                    <HeaderCopyButton col={c} />
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* ── Body ── */}
          <tbody>
            {renderItems.length === 0 ? (
              <tr><td colSpan={SHEET_COLS.length} className="bg-white text-center py-24 text-sm text-slate-500">
                <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                {searchQuery ? "Tidak ada pegawai yang cocok dengan pencarian" : "Belum ada data untuk periode ini"}
              </td></tr>
            ) : renderItems.map((item) => {
              // Band kelompok = pemisah antar kelompok, sekaligus drop-zone masuk/keluar kelompok + drag prioritas.
              if (item.kind === "band") {
                const g = groupById(item.gid);
                const cnt = groupCount(item.gid);
                const net = totalPerGroup(item.gid);
                const isBandOver = dragOverGroupId === item.gid && (dragActive || dragGroupId !== null);
                return (
                  <tr
                    key={`band-${item.gid ?? "ungrouped"}`}
                    onDragOver={(e) => handleBandDragOver(e, item.gid)}
                    onDrop={(e) => handleBandDrop(e, item.gid)}
                    onDragEnd={resetDrag}
                    className={cn(
                      "border-b border-dotted border-slate-400/80 transition-colors",
                      isBandOver ? "ring-2 ring-blue-500/70 ring-inset" : "",
                    )}
                  >
                    <td colSpan={SHEET_COLS.length} className="px-2 py-1.5 leading-tight" style={{ backgroundColor: g ? `${g.warna}1A` : "rgba(100,116,139,0.14)" }}>
                      <div className="flex items-center gap-2">
                        {g && canGroupEdit ? (
                          <button
                            type="button"
                            draggable={canGroupEdit}
                            onDragStart={(e) => {
                              if (!canGroupEdit) return;
                              setDragGroupId(g.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={resetDrag}
                            title="Seret untuk mengubah prioritas kelompok"
                            className="p-0.5 rounded-sm text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="w-3.5" />
                        )}
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g ? g.warna : "#94a3b8" }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
                          {groupFilter === "all" ? `${g ? g.nama : "Belum Dikelompokkan"}` : (g ? g.nama : "Belum Dikelompokkan")}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
                          {cnt} pegawai · Netto {formatCurrency(net)}
                        </span>
                        {groupFilter === "all" && item.gid !== null && (
                          <span className="text-[9px] text-slate-400 italic ml-1 hidden 2xl:inline">
                            {item.gid === null ? "" : "Drag pegawai ke sini untuk masuk kelompok ini"}
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                          {g && canGroupEdit && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Hapus kelompok "${g.nama}"? Seluruh anggotanya akan kembali ke "Belum Dikelompokkan".`)) {
                                  handleDeleteGroup(g.id);
                                  setGroupFilter("all");
                                }
                              }}
                              title={`Hapus kelompok ${g.nama}`}
                              className="p-0.5 rounded-sm text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              }
              const row = item.row;
              const idx = item.idx;
              const vals = wsData[row.id] || {};
              const computed = wsComputeTotals(row.id);
              const isChanged = wsChangedCells.has(row.id);
              const peg = row.pegawai as { bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null } | undefined;
              const g = groupById(groupOf(row.employee_id));
              const isSelected = selIds.has(row.employee_id);
              const isActive = activeRowId === row.id;
              const rowBg = isChanged ? "bg-amber-50" : isActive ? "bg-blue-100" : idx % 2 === 0 ? "bg-white" : "bg-[#fafafa]";
              const frozenBg = isChanged ? "bg-amber-50" : isActive ? "bg-blue-100" : idx % 2 === 0 ? "bg-white" : "bg-[#fafafa]";
              return (
                <tr
                  key={row.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, input, a")) return;
                    setActiveRowId(row.id);
                    if (selectMode) toggleSelect(row.employee_id, e.shiftKey, idx);
                  }}
                  onDragOver={(e) => handleRowDragOver(e, idx)}
                  onDrop={(e) => handleRowDrop(e, row, idx)}
                  onDragEnd={resetDrag}
                  className={cn(
                    "border-b border-dotted border-slate-500/80 text-slate-950 transition-colors cursor-pointer",
                    rowBg,
                    dragActive && dragIdx === idx && "opacity-50",
                    dragIndicator(idx),
                    isActive && "shadow-[inset_0_0_0_1.5px_rgba(37,99,235,0.45)]",
                    isSelected && "!bg-blue-50/80",
                  )}
                >
                  {SHEET_COLS.map((c) => {
                      if (c.key === "_aksi") {
                      const rowCopied = isCopied("row", String(row.id));
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-0.5 py-0.5", gridBorder)}>
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              onClick={() => copyRow(row, idx)}
                              className={cn(
                                "p-0.5 rounded-sm transition-colors",
                                rowCopied ? "text-emerald-600 bg-emerald-50" : "text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                              )}
                              title={rowCopied ? "Baris tersalin!" : "Salin baris (TSV)"}
                            >
                              {rowCopied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                            </button>
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
                      return (
                        <td
                          key={c.key}
                          style={getColumnStyle(c)}
                          className={cn(c.width, "px-1 py-0.5 text-[10px] text-slate-600 text-center sticky z-30 leading-tight", frozenBg, gridBorder)}
                        >
                          <div className="flex items-center justify-center gap-0.5">
                            {selectMode && canEdit ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleSelect(row.employee_id, e.shiftKey, idx); }}
                                className={cn(
                                  "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                  isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white hover:border-blue-400",
                                )}
                                title={isSelected ? "Batalkan pilihan" : "Pilih baris"}
                              >
                                {isSelected && <Check className="w-3 h-3" />}
                              </button>
                            ) : canEdit ? (
                              <button
                                type="button"
                                draggable={canDragNow}
                                onDragStart={(e) => handleDragStart(e, idx)}
                                onDragEnd={resetDrag}
                                onKeyDown={(e) => handleGripKeyDown(e, row, idx)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={!canReorder}
                                title={
                                  selectMode
                                    ? "Keluar dari mode pilih baris untuk mengubah urutan"
                                    : searchQuery.trim()
                                      ? "Hapus pencarian untuk mengubah urutan"
                                      : orderSaving || groupSaving
                                        ? "Menyimpan..."
                                        : "Ubah urutan (seret atau gunakan panah atas/bawah)"
                                }
                                className={cn(
                                  "rounded-sm p-0.5 transition-colors outline-none",
                                  canDragNow
                                    ? "text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-grab active:cursor-grabbing focus:ring-1 focus:ring-blue-400"
                                    : "text-slate-300 cursor-not-allowed",
                                )}
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </button>
                            ) : null}
                            <span className="tabular-nums leading-tight">{idx + 1}</span>
                          </div>
                        </td>
                      );
                    }
                    if (c.key === "_nama") {
                      return (
                        <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-0.5 sticky z-30", frozenBg, gridBorder, frozenDivider(c.key))}>
                          <div className="flex items-center gap-1 min-w-0">
                            {g && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: g.warna }} title={g.nama} />}
                            <p className="text-[11px] font-semibold text-slate-950 truncate leading-tight flex-1 min-w-0">{row.pegawaiNama}</p>
                          </div>
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
            <tfoot className="[&_td]:[position:sticky] [&_td]:bottom-0 [&_td]:z-50">
              <tr className="border-t border-dotted border-slate-500/80 bg-slate-800 text-white shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.25)]">
                {SHEET_COLS.map((c) => {
                  if (c.key === "_no") return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky bottom-0 z-50 bg-slate-800", footerGridBorder)} />;
                  if (c.key === "_nama") return (
                    <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky bottom-0 z-50 bg-slate-800", footerGridBorder, frozenDivider(c.key))}>
                      <p className="text-[10px] font-bold text-white uppercase tracking-wider leading-tight">Grand Total</p>
                    </td>
                  );
                  if (c.key === "_nik") return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky bottom-0 z-50 bg-slate-800", footerGridBorder)} />;
                  if (c.key === "_jabatan" || c.key === "_status") {
                    return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky bottom-0 z-50 bg-slate-800", footerGridBorder, frozenDivider(c.key))} />;
                  }
                  if (c.key === "_bank" || c.key === "_no_rek" || c.key === "_an" || c.key === "_aksi") {
                    return <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 sticky bottom-0 z-50 bg-slate-800", footerGridBorder)} />;
                  }
                  if (c.key === "_total_pend") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[11px] font-extrabold text-emerald-300 tabular-nums bg-slate-800 leading-tight sticky bottom-0 z-50", footerGridBorder)}>
                        {getGrandTotal(c)}
                      </td>
                    );
                  }
                  if (c.key === "_total_pot") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[11px] font-extrabold text-rose-300 tabular-nums bg-slate-800 leading-tight sticky bottom-0 z-50", footerGridBorder)}>
                        {getGrandTotal(c)}
                      </td>
                    );
                  }
                  if (c.key === "_netto") {
                    return (
                      <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[12px] font-extrabold text-blue-300 tabular-nums bg-slate-800 leading-tight sticky bottom-0 z-50", footerGridBorder)}>
                        {getGrandNetto()}
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} style={getColumnStyle(c)} className={cn(c.width, "px-1 py-1 text-right text-[11px] font-bold text-white tabular-nums bg-slate-800 leading-tight sticky bottom-0 z-50", footerGridBorder)}>
                      {getGrandTotal(c)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Floating action bar: seleksi baris ── */}
      {selectMode && selIds.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 text-white shadow-2xl shadow-slate-900/40 border border-slate-700">
          <span className="text-[11px] font-bold tabular-nums mr-1">{selIds.size} terpilih</span>
          {canEdit && (
            <button
              onClick={() => { setShowCreateGroup(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Buat Kelompok
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm(`Hapus ${selIds.size} baris terpilih dari kelompoknya?`)) {
                selIds.forEach((empId) => handleMoveToGroup(empId, null));
                clearSelection();
              }
            }}
            disabled={!canEdit || groupSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-700 hover:bg-slate-600 transition-colors disabled:opacity-40"
            title="Keluarkan pegawai terpilih dari kelompoknya (menjadi Tanpa Kelompok)"
          >
            <Trash2 className="w-3.5 h-3.5" /> Hapus dari Kelompok
          </button>
          <button
            onClick={clearSelection}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Bersihkan
          </button>
        </div>
      )}

      {/* ── Modal: Buat Kelompok ── */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowCreateGroup(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" /> Buat Kelompok Baru
              </h3>
              <button onClick={() => setShowCreateGroup(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1.5">Nama Kelompok</label>
                <input
                  type="text"
                  value={groupNama}
                  onChange={(e) => setGroupNama(e.target.value)}
                  placeholder="cth: DRIVER SENIOR"
                  autoFocus
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 placeholder:text-slate-400"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1.5">Warna Kelompok</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#64748b"].map((warna) => (
                    <button
                      key={warna}
                      onClick={() => setGroupWarna(warna)}
                      className={cn(
                        "w-7 h-7 rounded-full transition-transform",
                        groupWarna === warna ? "ring-2 ring-offset-2 ring-slate-900 scale-110" : "hover:scale-105",
                      )}
                      style={{ backgroundColor: warna }}
                      title={warna}
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                <p className="text-[10px] font-semibold text-slate-500 mb-1">
                  {selIds.size} pegawai akan masuk kelompok ini:
                </p>
                <p className="text-[11px] text-slate-700 font-medium truncate">
                  {displayedRows.filter((r) => selIds.has(r.employee_id)).slice(0, 4).map((r) => r.pegawaiNama).join(", ")}
                  {selIds.size > 4 ? ` +${selIds.size - 4} lainnya` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreateGroup(false)}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    const memberIds = displayedRows.filter((r) => selIds.has(r.employee_id)).map((r) => r.employee_id);
                    void handleCreateGroup(groupNama, groupWarna, memberIds).then((ok) => {
                      if (ok) {
                        setShowCreateGroup(false);
                        setGroupNama("");
                        clearSelection();
                      }
                    });
                  }}
                  disabled={!groupNama.trim() || groupSaving || selIds.size === 0}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {groupSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Buat Kelompok
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
