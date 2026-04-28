"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CreditCard,
  Search,
  X,
  CircleCheckBig,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Users,
  FileText,
  Download,
  Trash2,
  Zap,
  DollarSign,
  TrendingDown,
  CheckCircle2,
  Clock,
  Save,
  History,
  Loader2,
  Pencil,
  Check,
  Banknote,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase, type DbPayroll, type DbPegawai } from "@/lib/supabase";

// ─── Types ───
type EmployeeLite = { id: string; nama: string; status: string; jabatan?: { nama: string } | null; bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null; gaji_pokok?: number };
type PayrollRow = DbPayroll & { pegawaiNama?: string; pegawaiJabatan?: string };

const PAGE_SIZE = 15;
const CUT_OFF_DAY = 7;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

// ─── Period helpers (same as income page) ───
function getPeriodRange(periodKey: string): { start: string; end: string; label: string } {
  const [year, month] = periodKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, CUT_OFF_DAY);
  const endDate = new Date(year, month, CUT_OFF_DAY + 1);
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  const label = `${CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} \u2013 ${CUT_OFF_DAY + 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  return { start, end, label };
}

function getCurrentPeriodKey(): string {
  const now = new Date();
  if (now.getDate() < CUT_OFF_DAY) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriodLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

// ─── Currency input helper ───
function parseCurrencyInput(val: string): number {
  return parseInt(val.replace(/\D/g, "")) || 0;
}

function formatInputCurrency(val: number): string {
  if (val === 0) return "";
  return new Intl.NumberFormat("id-ID").format(val);
}

// ─── Pendapatan & Potongan field definitions ───
const PENDAPATAN_FIELDS: { key: string; label: string; readonly?: boolean }[] = [
  { key: "gaji_pokok", label: "Gaji Pokok" },
  { key: "pendapatan_titik", label: "Pendapatan Titik", readonly: true },
  { key: "extra_job", label: "Extra Job" },
  { key: "uang_makan", label: "Uang Makan" },
  { key: "insentif", label: "Insentif" },
  { key: "tunjangan_jabatan", label: "Tunjangan Jabatan" },
  { key: "transport", label: "Transport" },
  { key: "tunjangan_lain", label: "Tunjangan Lain" },
  { key: "tambahan_lain", label: "Tambahan Lain" },
];

const POTONGAN_FIELDS: { key: string; label: string; readonly?: boolean }[] = [
  { key: "koperasi", label: "Koperasi" },
  { key: "pinjaman_perusahaan", label: "Pinjaman Perusahaan" },
  { key: "potongan_absen", label: "Potongan Absen", readonly: true },
  { key: "potongan_lain", label: "Potongan Lain" },
  { key: "jht", label: "JHT" },
  { key: "bpjs_kesehatan", label: "BPJS Kesehatan" },
];

export default function PayrollPage() {
  // ─── Tab state ───
  const [activeTab, setActiveTab] = useState<"slip" | "gapok">("slip");

  // ─── Core state ───
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);
  const period = getPeriodRange(periodKey);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRow[]>([]);

  // ─── Generate modal ───
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState(getCurrentPeriodKey);
  const [generating, setGenerating] = useState(false);

  // ─── Detail slide-over ───
  const [showDetail, setShowDetail] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollRow | null>(null);
  const [editForm, setEditForm] = useState<Record<string, number>>({});
  const [editCatatan, setEditCatatan] = useState("");
  const [saving, setSaving] = useState(false);

  // ─── History ───
  const [history, setHistory] = useState<DbPayroll[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ─── Gapok tab state ───
  const [gapokSearch, setGapokSearch] = useState("");
  const [gapokPage, setGapokPage] = useState(1);
  const [gapokEditId, setGapokEditId] = useState<string | null>(null);
  const [gapokEditValue, setGapokEditValue] = useState("");
  const [gapokSaving, setGapokSaving] = useState(false);

  // ─── Worksheet state ───
  const [showWorksheet, setShowWorksheet] = useState(false);
  const [wsData, setWsData] = useState<Record<number, Record<string, number>>>({});
  const [wsChanged, setWsChanged] = useState<Set<number>>(new Set());
  const [wsSaving, setWsSaving] = useState(false);

  // ─── Delete confirm ───
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nama: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Toast ───
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  // ─── Lock body scroll ───
  useEffect(() => {
    if (showGenerate || showDetail || showWorksheet) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showGenerate, showDetail, showWorksheet]);

  // ─── Fetch employees ───
  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from("pegawai")
      .select("id, nama, status, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening, gaji_pokok")
      .in("status", ["Aktif", "Training"])
      .order("nama");
    if (error) { showToast("error", "Gagal Memuat Pegawai", error.message); return; }
    if (data) setEmployees(data.map((d: Record<string, unknown>) => ({
      id: d.id as string,
      nama: d.nama as string,
      status: d.status as string,
      jabatan: d.jabatan as { nama: string } | null,
      bank: d.bank as string | null,
      no_rekening: d.no_rekening as string | null,
      nama_rekening: d.nama_rekening as string | null,
      gaji_pokok: (d.gaji_pokok as number) || 0,
    })));
  };

  // ─── Fetch payrolls ───
  const fetchPayrolls = useCallback(async () => {
    const { data, error } = await supabase
      .from("payrolls")
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening)")
      .eq("periode", periodKey)
      .order("id", { ascending: true });
    if (error) { showToast("error", "Gagal Memuat Payroll", error.message); return; }
    if (data) {
      const mapped: PayrollRow[] = data.map((d: Record<string, unknown>) => {
        const peg = d.pegawai as Record<string, unknown> | null;
        return {
          ...d,
          pegawaiNama: (peg?.nama as string) || (d.employee_id as string) || "?",
          pegawaiJabatan: (peg?.jabatan as Record<string, unknown>)?.nama as string || "-",
        } as PayrollRow;
      });
      setPayrolls(mapped);
    }
  }, [periodKey, showToast]);

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchPayrolls()]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPayrolls().then(() => setLoading(false));
  }, [periodKey, fetchPayrolls]);

  // ─── Generate slip gaji ───
  const handleGenerate = async () => {
    setGenerating(true);
    const genPeriod = getPeriodRange(generatePeriod);

    try {
      // 1. Fetch active employees
      const { data: activeEmps, error: empErr } = await supabase
        .from("pegawai")
        .select("id, nama, gaji_pokok")
        .in("status", ["Aktif", "Training"])
        .order("nama");
      if (empErr || !activeEmps) {
        showToast("error", "Gagal Memuat Pegawai", empErr?.message);
        setGenerating(false);
        return;
      }

      // 2. Check existing payrolls for this period
      const { data: existing } = await supabase
        .from("payrolls")
        .select("employee_id")
        .eq("periode", generatePeriod);
      const existingSet = new Set((existing || []).map((e: { employee_id: string }) => e.employee_id));

      // 3. Filter employees that don't have a slip yet
      const newEmps = activeEmps.filter((e: { id: string }) => !existingSet.has(e.id));
      if (newEmps.length === 0) {
        showToast("error", "Tidak Ada Slip Baru", "Semua pegawai aktif sudah memiliki slip gaji untuk periode ini.");
        setGenerating(false);
        return;
      }

      // 4. Fetch delivery points totals for each employee in period
      const { data: dpData } = await supabase
        .from("delivery_points")
        .select("employee_id, total")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", newEmps.map((e: { id: string }) => e.id));

      const dpTotals = new Map<string, number>();
      (dpData || []).forEach((d: { employee_id: string; total: number }) => {
        dpTotals.set(d.employee_id, (dpTotals.get(d.employee_id) || 0) + d.total);
      });

      // 5. Fetch attendance denda totals for each employee in period
      const { data: attData } = await supabase
        .from("attendance_records")
        .select("employee_id, denda")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", newEmps.map((e: { id: string }) => e.id));

      const dendaTotals = new Map<string, number>();
      (attData || []).forEach((d: { employee_id: string; denda: number }) => {
        dendaTotals.set(d.employee_id, (dendaTotals.get(d.employee_id) || 0) + d.denda);
      });

      // 6. Build gaji_pokok lookup
      const gapokMap = new Map<string, number>();
      (activeEmps || []).forEach((e: { id: string; gaji_pokok?: number }) => {
        gapokMap.set(e.id, e.gaji_pokok || 0);
      });

      // 7. Build insert rows (exclude generated columns)
      const inserts = newEmps.map((e: { id: string }) => ({
        employee_id: e.id,
        periode: generatePeriod,
        periode_mulai: genPeriod.start,
        periode_selesai: genPeriod.end,
        gaji_pokok: gapokMap.get(e.id) || 0,
        pendapatan_titik: dpTotals.get(e.id) || 0,
        extra_job: 0,
        uang_makan: 0,
        insentif: 0,
        tunjangan_jabatan: 0,
        transport: 0,
        tunjangan_lain: 0,
        tambahan_lain: 0,
        koperasi: 0,
        pinjaman_perusahaan: 0,
        potongan_absen: dendaTotals.get(e.id) || 0,
        potongan_lain: 0,
        jht: 0,
        bpjs_kesehatan: 0,
        status: "Draft",
        catatan: null,
      }));

      // 8. Insert
      const { error: insertErr } = await supabase.from("payrolls").insert(inserts);
      if (insertErr) {
        showToast("error", "Gagal Generate", insertErr.message);
        setGenerating(false);
        return;
      }

      showToast("success", "Generate Berhasil", `${inserts.length} slip gaji berhasil dibuat untuk periode ${formatPeriodLabel(generatePeriod)}.`);
      setShowGenerate(false);

      // Refresh if same period
      if (generatePeriod === periodKey) {
        await fetchPayrolls();
      } else {
        setPeriodKey(generatePeriod);
      }
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal generate slip gaji.");
    } finally {
      setGenerating(false);
    }
  };

  // ─── Open detail panel ───
  const openDetail = (row: PayrollRow) => {
    setSelectedPayroll(row);
    // Initialize edit form with current values
    const form: Record<string, number> = {};
    PENDAPATAN_FIELDS.forEach((f) => { form[f.key] = (row as unknown as Record<string, number>)[f.key] || 0; });
    POTONGAN_FIELDS.forEach((f) => { form[f.key] = (row as unknown as Record<string, number>)[f.key] || 0; });
    setEditForm(form);
    setEditCatatan(row.catatan || "");
    setShowDetail(true);
    fetchHistory(row.employee_id);
  };

  // ─── Fetch history ───
  const fetchHistory = async (employeeId: string) => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from("payrolls")
      .select("*")
      .eq("employee_id", employeeId)
      .order("periode", { ascending: false })
      .limit(6);
    setHistory(data || []);
    setLoadingHistory(false);
  };

  // ─── Computed totals for edit form ───
  const computedTotalPendapatan = PENDAPATAN_FIELDS.reduce((sum, f) => sum + (editForm[f.key] || 0), 0);
  const computedTotalPotongan = POTONGAN_FIELDS.reduce((sum, f) => sum + (editForm[f.key] || 0), 0);
  const computedNetto = computedTotalPendapatan - computedTotalPotongan;

  // ─── Save edit ───
  const handleSave = async () => {
    if (!selectedPayroll) return;
    setSaving(true);

    // Only send individual component fields, NOT generated columns
    const updatePayload: Record<string, unknown> = { catatan: editCatatan || null };
    PENDAPATAN_FIELDS.forEach((f) => {
      if (!f.readonly) updatePayload[f.key] = editForm[f.key] || 0;
    });
    POTONGAN_FIELDS.forEach((f) => {
      if (!f.readonly) updatePayload[f.key] = editForm[f.key] || 0;
    });

    const { data, error } = await supabase
      .from("payrolls")
      .update(updatePayload)
      .eq("id", selectedPayroll.id)
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening)")
      .single();

    if (error) {
      showToast("error", "Gagal Menyimpan", error.message);
      setSaving(false);
      return;
    }

    if (data) {
      const peg = data.pegawai as Record<string, unknown> | null;
      const updated: PayrollRow = {
        ...data,
        pegawaiNama: (peg?.nama as string) || data.employee_id || "?",
        pegawaiJabatan: (peg?.jabatan as Record<string, unknown>)?.nama as string || "-",
      } as PayrollRow;
      setPayrolls((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelectedPayroll(updated);
    }

    showToast("success", "Slip Disimpan", "Perubahan berhasil disimpan.");
    setSaving(false);
  };

  // ─── Toggle status ───
  const handleToggleStatus = async () => {
    if (!selectedPayroll) return;
    setSaving(true);
    const newStatus = selectedPayroll.status === "Draft" ? "Final" : "Draft";

    const { data, error } = await supabase
      .from("payrolls")
      .update({ status: newStatus })
      .eq("id", selectedPayroll.id)
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening)")
      .single();

    if (error) {
      showToast("error", "Gagal Mengubah Status", error.message);
      setSaving(false);
      return;
    }

    if (data) {
      const peg = data.pegawai as Record<string, unknown> | null;
      const updated: PayrollRow = {
        ...data,
        pegawaiNama: (peg?.nama as string) || data.employee_id || "?",
        pegawaiJabatan: (peg?.jabatan as Record<string, unknown>)?.nama as string || "-",
      } as PayrollRow;
      setPayrolls((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelectedPayroll(updated);
    }

    showToast("success", "Status Diubah", `Slip gaji diubah menjadi ${newStatus}.`);
    setSaving(false);
  };

  // ─── Delete slip ───
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { error } = await supabase.from("payrolls").delete().eq("id", deleteConfirm.id);
    if (error) {
      showToast("error", "Gagal Menghapus", error.message);
      setDeleting(false);
      setDeleteConfirm(null);
      return;
    }
    setPayrolls((prev) => prev.filter((p) => p.id !== deleteConfirm.id));
    showToast("success", "Slip Dihapus", `Slip gaji ${deleteConfirm.nama} berhasil dihapus.`);
    setDeleting(false);
    setDeleteConfirm(null);
    if (selectedPayroll?.id === deleteConfirm.id) {
      setShowDetail(false);
      setSelectedPayroll(null);
    }
  };

  // ─── Export PDF slip gaji ───
  const exportSlipPDF = async (payroll: PayrollRow) => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    // ── Company header ──
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("JAMSLOGISTIC", pageWidth / 2, 20, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Slip Gaji Karyawan", pageWidth / 2, 26, { align: "center" });

    // Separator line
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.8);
    doc.line(margin, 30, pageWidth - margin, 30);

    // ── Employee info ──
    const peg = payroll.pegawai;
    let y = 38;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Informasi Karyawan", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    const infoLeft = [
      ["Nama", payroll.pegawaiNama || "-"],
      ["ID Pegawai", payroll.employee_id],
      ["Jabatan", payroll.pegawaiJabatan || "-"],
    ];
    const infoRight = [
      ["Periode", formatPeriodLabel(payroll.periode)],
      ["Bank", peg?.bank || "-"],
      ["No. Rekening", peg?.no_rekening || "-"],
    ];

    infoLeft.forEach(([label, val], i) => {
      doc.setFont("helvetica", "normal");
      doc.text(`${label}`, margin, y + i * 5);
      doc.text(":", margin + 30, y + i * 5);
      doc.setFont("helvetica", "bold");
      doc.text(`${val}`, margin + 33, y + i * 5);
    });

    infoRight.forEach(([label, val], i) => {
      doc.setFont("helvetica", "normal");
      doc.text(`${label}`, pageWidth / 2 + 10, y + i * 5);
      doc.text(":", pageWidth / 2 + 40, y + i * 5);
      doc.setFont("helvetica", "bold");
      doc.text(`${val}`, pageWidth / 2 + 43, y + i * 5);
    });

    y += 20;

    // ── Pendapatan table ──
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("PENDAPATAN", margin, y);
    y += 2;

    const pendapatanData = PENDAPATAN_FIELDS.map((f) => [
      f.label,
      formatCurrency((payroll as unknown as Record<string, number>)[f.key] || 0),
    ]);
    pendapatanData.push(["Total Pendapatan", formatCurrency(payroll.total_pendapatan)]);

    autoTable(doc, {
      startY: y,
      head: [["Komponen", "Jumlah"]],
      body: pendapatanData,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { halign: "right", cellWidth: 60 },
      },
      didParseCell: (data) => {
        if (data.row.index === pendapatanData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [219, 234, 254];
        }
      },
      margin: { left: margin, right: margin },
    });

    y = ((doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? y + 50) + 8;

    // ── Potongan table ──
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("POTONGAN", margin, y);
    y += 2;

    const potonganData = POTONGAN_FIELDS.map((f) => [
      f.label,
      formatCurrency((payroll as unknown as Record<string, number>)[f.key] || 0),
    ]);
    potonganData.push(["Total Potongan", formatCurrency(payroll.total_potongan)]);

    autoTable(doc, {
      startY: y,
      head: [["Komponen", "Jumlah"]],
      body: potonganData,
      theme: "grid",
      headStyles: { fillColor: [239, 68, 68], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { halign: "right", cellWidth: 60 },
      },
      didParseCell: (data) => {
        if (data.row.index === potonganData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [254, 226, 226];
        }
      },
      margin: { left: margin, right: margin },
    });

    y = ((doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? y + 40) + 10;

    // ── Netto ──
    doc.setFillColor(16, 185, 129);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 12, 2, 2, "F");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("GAJI BERSIH (NETTO)", margin + 5, y + 8);
    doc.text(formatCurrency(payroll.netto), pageWidth - margin - 5, y + 8, { align: "right" });
    doc.setTextColor(0, 0, 0);

    y += 22;

    // ── Catatan ──
    if (payroll.catatan) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(`Catatan: ${payroll.catatan}`, margin, y);
      y += 8;
    }

    // ── Signature area ──
    y = Math.max(y + 10, 230);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");

    const sigLeftX = margin + 15;
    const sigRightX = pageWidth - margin - 50;

    doc.text("Diterima oleh,", sigLeftX, y);
    doc.text("Disetujui oleh,", sigRightX, y);

    y += 25;
    doc.setFont("helvetica", "bold");
    doc.text(payroll.pegawaiNama || "-", sigLeftX, y);
    doc.text("HRD Jamslogistic", sigRightX, y);

    y += 3;
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.line(sigLeftX - 5, y, sigLeftX + 40, y);
    doc.line(sigRightX - 5, y, sigRightX + 40, y);

    doc.save(`Slip_Gaji_${payroll.employee_id}_${payroll.periode}.pdf`);
  };

  // ─── Worksheet helpers ───
  const initWsData = useCallback((rows: PayrollRow[]) => {
    const data: Record<number, Record<string, number>> = {};
    rows.forEach((r) => {
      const vals: Record<string, number> = {};
      PENDAPATAN_FIELDS.forEach((f) => { vals[f.key] = (r as unknown as Record<string, number>)[f.key] || 0; });
      POTONGAN_FIELDS.forEach((f) => { vals[f.key] = (r as unknown as Record<string, number>)[f.key] || 0; });
      data[r.id] = vals;
    });
    setWsData(data);
    setWsChanged(new Set());
  }, []);

  // Init worksheet when payrolls change
  useEffect(() => {
    if (payrolls.length > 0) initWsData(payrolls);
  }, [payrolls, initWsData]);

  const handleWsChange = (id: number, field: string, rawValue: string) => {
    const value = parseCurrencyInput(rawValue);
    setWsData((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setWsChanged((prev) => new Set(prev).add(id));
  };

  const wsComputeTotals = (id: number) => {
    const vals = wsData[id];
    if (!vals) return { totalPendapatan: 0, totalPotongan: 0, netto: 0 };
    const totalPendapatan = PENDAPATAN_FIELDS.reduce((s, f) => s + (vals[f.key] || 0), 0);
    const totalPotongan = POTONGAN_FIELDS.reduce((s, f) => s + (vals[f.key] || 0), 0);
    return { totalPendapatan, totalPotongan, netto: totalPendapatan - totalPotongan };
  };

  const handleWsSaveAll = async () => {
    if (wsChanged.size === 0) return;
    setWsSaving(true);
    let errorCount = 0;
    for (const id of wsChanged) {
      const vals = wsData[id];
      if (!vals) continue;
      // Only send editable fields, not generated columns
      const payload: Record<string, number> = {};
      PENDAPATAN_FIELDS.forEach((f) => { payload[f.key] = vals[f.key] || 0; });
      POTONGAN_FIELDS.forEach((f) => { payload[f.key] = vals[f.key] || 0; });
      const { error } = await supabase.from("payrolls").update(payload).eq("id", id);
      if (error) errorCount++;
    }
    setWsSaving(false);
    if (errorCount > 0) {
      showToast("error", "Sebagian Gagal", `${errorCount} dari ${wsChanged.size} slip gagal disimpan.`);
    } else {
      showToast("success", "Worksheet Disimpan", `${wsChanged.size} slip gaji berhasil diperbarui.`);
    }
    setWsChanged(new Set());
    await fetchPayrolls();
  };

  // ─── Gapok handlers ───
  const handleGapokEdit = (empId: string, currentValue: number) => {
    setGapokEditId(empId);
    setGapokEditValue(formatInputCurrency(currentValue));
  };

  const handleGapokCancel = () => {
    setGapokEditId(null);
    setGapokEditValue("");
  };

  const handleGapokSave = async (empId: string) => {
    const value = parseCurrencyInput(gapokEditValue);
    setGapokSaving(true);
    const { error } = await supabase.from("pegawai").update({ gaji_pokok: value }).eq("id", empId);
    setGapokSaving(false);
    if (error) {
      showToast("error", "Gagal Menyimpan", error.message);
      return;
    }
    setEmployees((prev) => prev.map((e) => e.id === empId ? { ...e, gaji_pokok: value } : e));
    setGapokEditId(null);
    setGapokEditValue("");
    showToast("success", "Gaji Pokok Diperbarui");
  };

  // ─── Gapok filter & paginate ───
  const gapokFiltered = employees.filter((e) =>
    e.nama.toLowerCase().includes(gapokSearch.toLowerCase()) ||
    e.id.toLowerCase().includes(gapokSearch.toLowerCase()) ||
    (e.jabatan?.nama || "").toLowerCase().includes(gapokSearch.toLowerCase())
  );
  const gapokPaged = gapokFiltered.slice((gapokPage - 1) * PAGE_SIZE, gapokPage * PAGE_SIZE);
  const gapokTotalGapok = employees.reduce((s, e) => s + (e.gaji_pokok || 0), 0);
  const gapokBelumDiisi = employees.filter((e) => !e.gaji_pokok).length;

  // ─── Filter & paginate ───
  const filtered = payrolls.filter((p) =>
    (p.pegawaiNama || "").toLowerCase().includes(search.toLowerCase()) ||
    p.employee_id.toLowerCase().includes(search.toLowerCase())
  );
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ─── Summary ───
  const totalNetto = payrolls.reduce((s, p) => s + p.netto, 0);
  const totalPegawai = payrolls.length;
  const draftCount = payrolls.filter((p) => p.status === "Draft").length;
  const finalCount = payrolls.filter((p) => p.status === "Final").length;

  // ─── Period navigation ───
  const prevPeriod = () => {
    const [y, m] = periodKey.split("-").map(Number);
    const prev = new Date(y, m - 2, 1);
    setPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
  };
  const nextPeriod = () => {
    const [y, m] = periodKey.split("-").map(Number);
    const next = new Date(y, m, 1);
    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Penggajian"
        description="Kelola slip gaji pegawai perusahaan"
        icon={CreditCard}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={Download} size="sm" onClick={() => {
              const finalSlips = payrolls.filter((p) => p.status === "Final");
              if (finalSlips.length === 0) {
                showToast("error", "Tidak Ada Slip Final", "Belum ada slip gaji berstatus Final untuk di-export.");
                return;
              }
              finalSlips.forEach((p) => exportSlipPDF(p));
              showToast("success", "Export PDF", `${finalSlips.length} slip gaji sedang di-download.`);
            }}>
              Export Semua
            </Button>
            <Button variant="outline" icon={FileText} size="sm" onClick={() => setShowWorksheet(true)} disabled={payrolls.length === 0}>
              Worksheet
            </Button>
            <Button icon={Zap} size="sm" onClick={() => { setGeneratePeriod(periodKey); setShowGenerate(true); }}>
              Generate Slip
            </Button>
          </div>
        }
      />

      {/* ═══ Toast ═══ */}
      {toast.show && (
        <Portal>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]",
              toast.type === "error" ? "border-danger/20" : "border-success/20")}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
                {toast.type === "error"
                  ? <AlertTriangle className="w-5 h-5 text-danger" />
                  : <CircleCheckBig className="w-5 h-5 text-success" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{toast.title}</p>
                {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
              </div>
              <button onClick={() => setToast({ show: false, title: "", message: "", type: "success" })} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Tab Switcher ═══ */}
      <div className="bg-card rounded-2xl border border-border p-1.5 inline-flex items-center gap-1">
        <button
          onClick={() => setActiveTab("slip")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all",
            activeTab === "slip"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <CreditCard className="w-3.5 h-3.5" />
          Slip Gaji
        </button>
        <button
          onClick={() => setActiveTab("gapok")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all",
            activeTab === "gapok"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <Banknote className="w-3.5 h-3.5" />
          Data Gaji Pokok
          {gapokBelumDiisi > 0 && !loading && (
            <span className="ml-0.5 text-[9px] font-bold bg-danger text-white px-1.5 py-0.5 rounded-full">{gapokBelumDiisi}</span>
          )}
        </button>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* ═══ TAB: DATA GAJI POKOK ═══ */}
      {/* ═══════════════════════════════════════ */}
      {activeTab === "gapok" && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><Banknote className="w-5 h-5 text-primary" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Total Gaji Pokok</p><p className="text-lg font-bold text-foreground">{formatCurrency(gapokTotalGapok)}</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center"><Users className="w-5 h-5 text-success" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Jumlah Pegawai</p><p className="text-lg font-bold text-foreground">{employees.length}</p></div>
            </div>
            <div className={cn("bg-card rounded-2xl border p-4 flex items-center gap-3", gapokBelumDiisi > 0 ? "border-danger/30" : "border-border")}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", gapokBelumDiisi > 0 ? "bg-danger/10" : "bg-success-light")}>
                <span className={cn("text-sm font-bold", gapokBelumDiisi > 0 ? "text-danger" : "text-success")}>{gapokBelumDiisi}</span>
              </div>
              <div><p className="text-xs text-muted-foreground font-medium">Belum Diisi</p><p className="text-xs text-muted-foreground">pegawai</p></div>
            </div>
          </div>

          {/* Search */}
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari nama, ID, atau jabatan..."
                value={gapokSearch}
                onChange={(e) => { setGapokSearch(e.target.value); setGapokPage(1); }}
                className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">ID</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Nama Pegawai</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Jabatan</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Gaji Pokok</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={6} cols={7} />
                  ) : gapokPaged.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-16 text-sm text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="w-10 h-10 text-muted-foreground/20" />
                        <p>Tidak ada pegawai ditemukan</p>
                      </div>
                    </td></tr>
                  ) : gapokPaged.map((emp, idx) => {
                    const isEditing = gapokEditId === emp.id;
                    return (
                      <tr key={emp.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{(gapokPage - 1) * PAGE_SIZE + idx + 1}</td>
                        <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground">{emp.id}</span></td>
                        <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{emp.nama}</p></td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{emp.jabatan?.nama || "-"}</td>
                        <td className="px-5 py-3.5">
                          <Badge variant={emp.status === "Aktif" ? "success" : "warning"}>{emp.status}</Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-xs text-muted-foreground">Rp</span>
                              <input
                                type="text"
                                value={gapokEditValue}
                                onChange={(e) => {
                                  const raw = parseCurrencyInput(e.target.value);
                                  setGapokEditValue(formatInputCurrency(raw));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleGapokSave(emp.id);
                                  if (e.key === "Escape") handleGapokCancel();
                                }}
                                autoFocus
                                className="w-32 px-2 py-1.5 rounded-lg border border-primary bg-muted/30 text-sm text-right outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                              />
                            </div>
                          ) : (
                            <span className={cn("text-sm font-semibold", emp.gaji_pokok ? "text-foreground" : "text-muted-foreground italic")}>
                              {emp.gaji_pokok ? formatCurrency(emp.gaji_pokok) : "Belum diisi"}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-center gap-1">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => handleGapokSave(emp.id)}
                                  disabled={gapokSaving}
                                  className="p-1.5 rounded-lg bg-success-light text-success hover:bg-success hover:text-white disabled:opacity-50"
                                  title="Simpan"
                                >
                                  {gapokSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={handleGapokCancel}
                                  disabled={gapokSaving}
                                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                                  title="Batal"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleGapokEdit(emp.id, emp.gaji_pokok || 0)}
                                className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"
                                title="Edit Gaji Pokok"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={gapokPage} totalItems={gapokFiltered.length} pageSize={PAGE_SIZE} onPageChange={setGapokPage} />
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* ═══ TAB: SLIP GAJI ═══ */}
      {/* ═══════════════════════════════════════ */}
      {activeTab === "slip" && (<>

      {/* ═══ Summary Cards ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <div className="space-y-2"><Skeleton className="h-3 w-14 rounded-md" /><Skeleton className="h-5 w-24 rounded-md" /></div>
          </div>
        )) : (
          <>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><DollarSign className="w-5 h-5 text-primary" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Total Netto</p><p className="text-lg font-bold text-foreground">{formatCurrency(totalNetto)}</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center"><Users className="w-5 h-5 text-success" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Jumlah Pegawai</p><p className="text-lg font-bold text-foreground">{totalPegawai}</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-warning-light flex items-center justify-center"><Clock className="w-5 h-5 text-warning" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Draft</p><p className="text-lg font-bold text-warning">{draftCount}</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center"><CheckCircle2 className="w-5 h-5 text-success" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Final</p><p className="text-lg font-bold text-success">{finalCount}</p></div>
            </div>
          </>
        )}
      </div>

      {/* ═══ Filter & Period Navigator ═══ */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari nama pegawai atau ID..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
            <button onClick={prevPeriod} className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-1.5 text-center min-w-[240px]">
              <p className="text-xs font-bold text-foreground">{period.label}</p>
            </div>
            <button onClick={nextPeriod} className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Ringkasan Tabel + Tombol Worksheet ═══ */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Total Pendapatan</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Total Potongan</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Netto</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <SkeletonTable rows={6} cols={7} />
              ) : paged.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-16 text-sm text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <CreditCard className="w-10 h-10 text-muted-foreground/20" />
                    <p>Belum ada slip gaji untuk periode ini</p>
                    <p className="text-xs text-muted-foreground/60">Klik &quot;Generate Slip&quot; untuk membuat slip gaji</p>
                  </div>
                </td></tr>
              ) : paged.map((row, idx) => (
                <tr key={row.id} className="hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => openDetail(row)}>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-foreground">{row.pegawaiNama}</p>
                    <p className="text-xs text-muted-foreground">{row.pegawaiJabatan}</p>
                  </td>
                  <td className="px-5 py-3.5 text-right text-sm font-semibold text-success">{formatCurrency(row.total_pendapatan)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-semibold text-danger">{formatCurrency(row.total_potongan)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground">{formatCurrency(row.netto)}</td>
                  <td className="px-5 py-3.5 text-center">
                    <Badge variant={row.status === "Final" ? "success" : "muted"}>{row.status}</Badge>
                  </td>
                  <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => exportSlipPDF(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary" title="Download PDF">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteConfirm({ id: row.id, nama: row.pegawaiNama || row.employee_id })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      </>)}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ WORKSHEET FULLSCREEN ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {showWorksheet && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-gradient-to-r from-card via-card to-primary/[0.03] flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20">
                  <CreditCard className="w-4.5 h-4.5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Worksheet Penggajian</h2>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                    <span><strong className="text-foreground">{filtered.length}</strong> pegawai</span>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span>Netto: <strong className="text-primary">{formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0))}</strong></span>
                    {wsChanged.size > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <span className="text-warning"><strong>{wsChanged.size}</strong> belum disimpan</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Period navigator */}
                <div className="flex items-center bg-muted rounded-xl p-1">
                  <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                  <span className="text-xs font-bold text-foreground px-3 min-w-[220px] text-center">{period.label}</span>
                  <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronRight className="w-4 h-4" /></button>
                </div>
                {/* Search */}
                <div className="flex items-center gap-1.5 bg-muted rounded-xl px-3 py-1.5 w-52">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <input type="text" placeholder="Cari..." value={search} onChange={(e) => setSearch(e.target.value)}
                    className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/50 text-foreground" />
                </div>
                {/* Save */}
                {wsChanged.size > 0 && (
                  <Button icon={wsSaving ? Loader2 : Save} size="sm" onClick={handleWsSaveAll} disabled={wsSaving}>
                    {wsSaving ? "Menyimpan..." : `Simpan (${wsChanged.size})`}
                  </Button>
                )}
                {/* Close */}
                <button onClick={() => setShowWorksheet(false)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />Tutup
                </button>
              </div>
            </div>

            {/* ── Spreadsheet ── */}
            <div className="flex-1 overflow-auto">
              <table className="border-collapse w-max min-w-full">
                <thead className="sticky top-0 z-20">
                  <tr className="border-b-2 border-border bg-muted/90">
                    <th className="sticky left-0 z-30 bg-muted/95 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-3 w-10 border-r border-border">#</th>
                    <th className="sticky left-[40px] z-30 bg-muted/95 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-3 min-w-[180px] border-r-2 border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Pegawai</th>
                    {PENDAPATAN_FIELDS.map((f) => (
                      <th key={f.key} className={cn(
                        "text-right text-[10px] font-bold uppercase tracking-wider px-2 py-3 min-w-[115px] border-r border-border/50",
                        f.readonly ? "text-primary bg-primary/[0.04]" : "text-muted-foreground"
                      )}>
                        {f.label}
                        {f.readonly && <span className="block text-[8px] font-normal normal-case tracking-normal text-primary/60">otomatis</span>}
                      </th>
                    ))}
                    <th className="text-right text-[10px] font-bold text-success uppercase tracking-wider px-2 py-3 min-w-[120px] border-r-2 border-success/30 bg-success/[0.06]">Total Pend.</th>
                    {POTONGAN_FIELDS.map((f) => (
                      <th key={f.key} className={cn(
                        "text-right text-[10px] font-bold uppercase tracking-wider px-2 py-3 min-w-[115px] border-r border-border/50",
                        f.readonly ? "text-danger bg-danger/[0.04]" : "text-muted-foreground"
                      )}>
                        {f.label}
                        {f.readonly && <span className="block text-[8px] font-normal normal-case tracking-normal text-danger/60">otomatis</span>}
                      </th>
                    ))}
                    <th className="text-right text-[10px] font-bold text-danger uppercase tracking-wider px-2 py-3 min-w-[120px] border-r-2 border-danger/30 bg-danger/[0.06]">Total Pot.</th>
                    <th className="text-right text-[10px] font-bold text-foreground uppercase tracking-wider px-3 py-3 min-w-[130px] bg-primary/[0.06]">Netto</th>
                    <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-3 w-20 border-l border-border">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={PENDAPATAN_FIELDS.length + POTONGAN_FIELDS.length + 6} className="text-center py-20 text-sm text-muted-foreground">
                      Belum ada slip gaji untuk periode ini
                    </td></tr>
                  ) : filtered.map((row, idx) => {
                    const vals = wsData[row.id] || {};
                    const computed = wsComputeTotals(row.id);
                    const isChanged = wsChanged.has(row.id);
                    return (
                      <tr key={row.id} className={cn("hover:bg-muted/20 transition-colors", isChanged && "bg-warning/[0.04]")}>
                        <td className="sticky left-0 z-10 bg-card px-3 py-2 text-xs text-muted-foreground border-r border-border">{idx + 1}</td>
                        <td className="sticky left-[40px] z-10 bg-card px-3 py-2 border-r-2 border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                          <p className="text-xs font-semibold text-foreground truncate max-w-[160px]">{row.pegawaiNama}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">{row.pegawaiJabatan}</p>
                        </td>
                        {PENDAPATAN_FIELDS.map((f) => (
                          <td key={f.key} className={cn("px-1 py-1 border-r border-border/30", f.readonly && "bg-muted/20")}>
                            {f.readonly ? (
                              <div className="text-right text-xs font-medium text-muted-foreground px-1.5 py-1.5">{formatCurrency(vals[f.key] || 0)}</div>
                            ) : (
                              <input
                                type="text"
                                value={vals[f.key] ? formatInputCurrency(vals[f.key]) : ""}
                                onChange={(e) => handleWsChange(row.id, f.key, e.target.value)}
                                placeholder="0"
                                className="w-full text-right text-xs px-1.5 py-1.5 rounded-lg border border-transparent bg-transparent hover:border-border focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary/20 outline-none text-foreground placeholder:text-muted-foreground/30 transition-colors"
                              />
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right text-xs font-bold text-success border-r-2 border-success/20 bg-success/[0.02]">
                          {formatCurrency(computed.totalPendapatan)}
                        </td>
                        {POTONGAN_FIELDS.map((f) => (
                          <td key={f.key} className={cn("px-1 py-1 border-r border-border/30", f.readonly && "bg-muted/20")}>
                            {f.readonly ? (
                              <div className="text-right text-xs font-medium text-muted-foreground px-1.5 py-1.5">{formatCurrency(vals[f.key] || 0)}</div>
                            ) : (
                              <input
                                type="text"
                                value={vals[f.key] ? formatInputCurrency(vals[f.key]) : ""}
                                onChange={(e) => handleWsChange(row.id, f.key, e.target.value)}
                                placeholder="0"
                                className="w-full text-right text-xs px-1.5 py-1.5 rounded-lg border border-transparent bg-transparent hover:border-border focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary/20 outline-none text-foreground placeholder:text-muted-foreground/30 transition-colors"
                              />
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right text-xs font-bold text-danger border-r-2 border-danger/20 bg-danger/[0.02]">
                          {formatCurrency(computed.totalPotongan)}
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-bold text-foreground bg-primary/[0.02]">
                          {formatCurrency(computed.netto)}
                        </td>
                        <td className="px-2 py-2 border-l border-border">
                          <div className="flex items-center justify-center gap-0.5">
                            <button onClick={() => exportSlipPDF(row)} className="p-1 rounded-md hover:bg-primary-light text-muted-foreground hover:text-primary" title="Download PDF">
                              <Download className="w-3 h-3" />
                            </button>
                            <button onClick={() => setDeleteConfirm({ id: row.id, nama: row.pegawaiNama || row.employee_id })} className="p-1 rounded-md hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Grand Total Row */}
                  {filtered.length > 0 && (
                    <tr className="bg-muted/50 border-t-2 border-border sticky bottom-0 z-10">
                      <td className="sticky left-0 z-20 bg-muted/80 px-3 py-3 border-r border-border" />
                      <td className="sticky left-[40px] z-20 bg-muted/80 px-3 py-3 border-r-2 border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        <p className="text-xs font-bold text-foreground">TOTAL ({filtered.length} pegawai)</p>
                      </td>
                      {PENDAPATAN_FIELDS.map((f) => (
                        <td key={f.key} className="px-2 py-3 text-right text-[10px] font-bold text-muted-foreground border-r border-border/30">
                          {formatCurrency(filtered.reduce((s, r) => s + ((wsData[r.id] || {})[f.key] || 0), 0))}
                        </td>
                      ))}
                      <td className="px-2 py-3 text-right text-xs font-bold text-success border-r-2 border-success/20 bg-success/[0.06]">
                        {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPendapatan, 0))}
                      </td>
                      {POTONGAN_FIELDS.map((f) => (
                        <td key={f.key} className="px-2 py-3 text-right text-[10px] font-bold text-muted-foreground border-r border-border/30">
                          {formatCurrency(filtered.reduce((s, r) => s + ((wsData[r.id] || {})[f.key] || 0), 0))}
                        </td>
                      ))}
                      <td className="px-2 py-3 text-right text-xs font-bold text-danger border-r-2 border-danger/20 bg-danger/[0.06]">
                        {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPotongan, 0))}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-bold text-primary bg-primary/[0.06]">
                        {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0))}
                      </td>
                      <td className="border-l border-border" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Generate Modal ═══ */}
      {showGenerate && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !generating && setShowGenerate(false)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md mx-4 animate-fade-in">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center">
                    <Zap className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Generate Slip Gaji</h3>
                    <p className="text-xs text-muted-foreground">Buat slip gaji untuk semua pegawai aktif</p>
                  </div>
                </div>
                <button onClick={() => !generating && setShowGenerate(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Periode</label>
                  <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
                    <button
                      onClick={() => {
                        const [y, m] = generatePeriod.split("-").map(Number);
                        const prev = new Date(y, m - 2, 1);
                        setGeneratePeriod(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
                      }}
                      className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="px-3 py-1.5 text-center flex-1">
                      <p className="text-xs font-bold text-foreground">{getPeriodRange(generatePeriod).label}</p>
                    </div>
                    <button
                      onClick={() => {
                        const [y, m] = generatePeriod.split("-").map(Number);
                        const next = new Date(y, m, 1);
                        setGeneratePeriod(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
                      }}
                      className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="bg-muted/50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-foreground">Yang akan dilakukan:</p>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      Mengambil semua pegawai berstatus Aktif/Training
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      Menghitung pendapatan titik dari rekap titik pengantaran
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      Menghitung potongan absen dari data kehadiran
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      Melewati pegawai yang sudah memiliki slip
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" onClick={() => setShowGenerate(false)} disabled={generating}>
                  Batal
                </Button>
                <Button icon={generating ? Loader2 : Zap} size="sm" onClick={handleGenerate} disabled={generating}>
                  {generating ? "Generating..." : "Generate Slip"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Detail Slide-over Panel ═══ */}
      {showDetail && selectedPayroll && (
        <Portal>
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDetail(false)} />
            <div className="relative w-full max-w-xl bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-card via-card to-primary/[0.03] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center">
                    <FileText className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{selectedPayroll.pegawaiNama}</h3>
                    <p className="text-xs text-muted-foreground">{selectedPayroll.pegawaiJabatan} &middot; {formatPeriodLabel(selectedPayroll.periode)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={selectedPayroll.status === "Final" ? "success" : "muted"}>{selectedPayroll.status}</Badge>
                  <button onClick={() => setShowDetail(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-6 py-5 space-y-6">

                  {/* ── PENDAPATAN ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-success/10 flex items-center justify-center">
                        <TrendingDown className="w-3.5 h-3.5 text-success rotate-180" />
                      </div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Pendapatan</h4>
                    </div>
                    <div className="space-y-2.5">
                      {PENDAPATAN_FIELDS.map((f) => (
                        <div key={f.key} className="flex items-center gap-3">
                          <label className="text-xs text-muted-foreground w-36 flex-shrink-0">
                            {f.label}
                            {f.readonly && <span className="text-[9px] text-primary ml-1">(auto)</span>}
                          </label>
                          <div className="flex-1 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                            <input
                              type="text"
                              value={formatInputCurrency(editForm[f.key] || 0)}
                              onChange={(e) => {
                                if (f.readonly) return;
                                const val = parseCurrencyInput(e.target.value);
                                setEditForm((prev) => ({ ...prev, [f.key]: val }));
                              }}
                              readOnly={f.readonly}
                              className={cn(
                                inputClass,
                                "pl-9 text-right",
                                f.readonly && "bg-muted/60 text-muted-foreground cursor-not-allowed"
                              )}
                            />
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center gap-3 pt-2 border-t border-border">
                        <span className="text-xs font-bold text-foreground w-36">Total Pendapatan</span>
                        <span className="flex-1 text-right text-sm font-bold text-success">{formatCurrency(computedTotalPendapatan)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── POTONGAN ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-danger/10 flex items-center justify-center">
                        <TrendingDown className="w-3.5 h-3.5 text-danger" />
                      </div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Potongan</h4>
                    </div>
                    <div className="space-y-2.5">
                      {POTONGAN_FIELDS.map((f) => (
                        <div key={f.key} className="flex items-center gap-3">
                          <label className="text-xs text-muted-foreground w-36 flex-shrink-0">
                            {f.label}
                            {f.readonly && <span className="text-[9px] text-primary ml-1">(auto)</span>}
                          </label>
                          <div className="flex-1 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                            <input
                              type="text"
                              value={formatInputCurrency(editForm[f.key] || 0)}
                              onChange={(e) => {
                                if (f.readonly) return;
                                const val = parseCurrencyInput(e.target.value);
                                setEditForm((prev) => ({ ...prev, [f.key]: val }));
                              }}
                              readOnly={f.readonly}
                              className={cn(
                                inputClass,
                                "pl-9 text-right",
                                f.readonly && "bg-muted/60 text-muted-foreground cursor-not-allowed"
                              )}
                            />
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center gap-3 pt-2 border-t border-border">
                        <span className="text-xs font-bold text-foreground w-36">Total Potongan</span>
                        <span className="flex-1 text-right text-sm font-bold text-danger">{formatCurrency(computedTotalPotongan)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── NETTO ── */}
                  <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-primary" />
                        </div>
                        <span className="text-sm font-bold text-foreground">Gaji Bersih (Netto)</span>
                      </div>
                      <span className={cn("text-xl font-bold", computedNetto >= 0 ? "text-primary" : "text-danger")}>
                        {formatCurrency(computedNetto)}
                      </span>
                    </div>
                  </div>

                  {/* ── Catatan ── */}
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan</label>
                    <textarea
                      value={editCatatan}
                      onChange={(e) => setEditCatatan(e.target.value)}
                      placeholder="Catatan tambahan (opsional)..."
                      rows={2}
                      className={cn(inputClass, "resize-none")}
                    />
                  </div>

                  {/* ── Riwayat 6 bulan terakhir ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
                        <History className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Riwayat (6 Bulan Terakhir)</h4>
                    </div>
                    {loadingHistory ? (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-14 w-full rounded-xl" />
                        ))}
                      </div>
                    ) : history.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-4 text-center">Belum ada riwayat</p>
                    ) : (
                      <div className="space-y-2">
                        {history.map((h) => (
                          <div
                            key={h.id}
                            className={cn(
                              "flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-colors",
                              h.id === selectedPayroll.id
                                ? "border-primary/30 bg-primary/5"
                                : "border-border bg-muted/20 hover:bg-muted/40"
                            )}
                          >
                            <div>
                              <p className="text-xs font-semibold text-foreground">{formatPeriodLabel(h.periode)}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-muted-foreground">
                                  Pend: <span className="text-success font-medium">{formatCurrency(h.total_pendapatan)}</span>
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  Pot: <span className="text-danger font-medium">{formatCurrency(h.total_potongan)}</span>
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-foreground">{formatCurrency(h.netto)}</p>
                              <Badge variant={h.status === "Final" ? "success" : "muted"} size="sm">{h.status}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-card flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    onClick={() => setDeleteConfirm({ id: selectedPayroll.id, nama: selectedPayroll.pegawaiNama || selectedPayroll.employee_id })}
                  >
                    Hapus
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Download}
                    onClick={() => exportSlipPDF(selectedPayroll)}
                  >
                    PDF
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleStatus}
                    disabled={saving}
                  >
                    {selectedPayroll.status === "Draft" ? "Finalkan" : "Kembalikan ke Draft"}
                  </Button>
                  <Button
                    icon={saving ? Loader2 : Save}
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Menyimpan..." : "Simpan"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Delete Confirmation Modal ═══ */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm mx-4 animate-fade-in">
              <div className="px-6 py-5 text-center">
                <div className="w-12 h-12 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-6 h-6 text-danger" />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-1">Hapus Slip Gaji?</h3>
                <p className="text-xs text-muted-foreground">
                  Slip gaji <strong>{deleteConfirm.nama}</strong> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                  Batal
                </Button>
                <Button variant="danger" size="sm" className="flex-1" icon={deleting ? Loader2 : Trash2} onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Hapus"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}


    </div>
  );
}
