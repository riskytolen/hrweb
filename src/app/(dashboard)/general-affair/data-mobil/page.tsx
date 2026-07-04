"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Truck, Plus, Search, Pencil, Trash2, X, Check, Eye,
  CircleCheckBig, AlertTriangle, FileText, Upload, Download,
  ExternalLink, Image as ImageIcon, Settings2,
  Building2, ChevronDown, FileDown,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { cn } from "@/lib/utils";
import {
  supabase,
  type DbGaVehicle,
  type DbGaVehicleDocument,
  type DbGaVehicleDocumentFile,
  type DbGaVehicleDocumentSetting,
  type DbGaVehicleVendor,
  type DbGaVehicleDivision,
} from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

const PAGE_SIZE = 50;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const DETAIL_FIELDS = [
  { key: "unit", label: "UNIT" },
  { key: "jenis", label: "JENIS" },
  { key: "divisi", label: "DEVISI" },
  { key: "vendor", label: "VENDOR" },
  { key: "lokasi_administrasi", label: "LOKASI ADMINISTRASI" },
  { key: "no_rangka", label: "NO RANGKA" },
  { key: "nomer_mesin", label: "NOMER MESIN" },
  { key: "volume", label: "VOLUME" },
  { key: "tonase", label: "TONASE" },
  { key: "suhu", label: "SUHU" },
] as const;

const DOCUMENT_TYPES = ["KIR", "STNK"] as const;
type DocumentType = (typeof DOCUMENT_TYPES)[number];
type StatusTarget = "KIR" | "STNK" | "PAJAK";
type DocumentStatus = "Aktif" | "Akan Habis" | "Expired" | "Belum Ada" | "Tidak Wajib";
type OverallDocumentStatus = "Aman" | "Perlu Diperhatikan" | "Akan Habis" | "Expired" | "Belum Lengkap" | "Tidak Wajib";

type FormState = {
  unit: string;
  jenis: string;
  divisi: string;
  vendor: string;
  vendor_id: number | null;
  vehicle_division_id: number | null;
  lokasi_administrasi: string;
  no_rangka: string;
  nomer_mesin: string;
  volume: string;
  tonase: string;
  suhu: string;
  kir_required: boolean;
  stnk_required: boolean;
  pajak_required: boolean;
};

type DocumentFormState = {
  document_type: DocumentType;
  document_number: string;
  issued_date: string;
  expired_date: string;
  pajak_expired_date: string;
  notes: string;
};

type StatusInfo = {
  key: DocumentStatus;
  label: string;
  detail: string;
  date: string | null;
};

type OverallStatusInfo = {
  key: OverallDocumentStatus;
  label: string;
  detail: string;
};

const emptyForm: FormState = {
  unit: "", jenis: "", divisi: "", vendor: "", vendor_id: null, vehicle_division_id: null,
  lokasi_administrasi: "", no_rangka: "", nomer_mesin: "", volume: "", tonase: "", suhu: "",
  kir_required: true, stnk_required: true, pajak_required: true,
};

const emptyDocumentForm: DocumentFormState = {
  document_type: "KIR",
  document_number: "",
  issued_date: "",
  expired_date: "",
  pajak_expired_date: "",
  notes: "",
};

const statusStyle: Record<DocumentStatus, string> = {
  Aktif: "bg-success/10 text-success",
  "Akan Habis": "bg-warning/10 text-warning",
  Expired: "bg-danger/10 text-danger",
  "Belum Ada": "bg-muted text-muted-foreground",
  "Tidak Wajib": "bg-muted/60 text-muted-foreground",
};

const documentCardStyle: Record<DocumentStatus, string> = {
  Aktif: "border-success/40 bg-success/5 text-success",
  "Akan Habis": "border-warning/50 bg-warning/5 text-warning",
  Expired: "border-danger/60 bg-danger/5 text-danger",
  "Belum Ada": "border-muted-foreground/30 bg-muted/60 text-muted-foreground",
  "Tidak Wajib": "border-border bg-muted/40 text-muted-foreground",
};

const overallStyle: Record<OverallDocumentStatus, { card: string; badge: string; footer: string }> = {
  Aman: {
    card: "border-success/30 hover:border-success/60",
    badge: "bg-success/10 text-success",
    footer: "bg-success/10 text-success border-success/20",
  },
  "Perlu Diperhatikan": {
    card: "border-warning/30 hover:border-warning/60",
    badge: "bg-warning/10 text-warning",
    footer: "bg-warning/10 text-warning border-warning/20",
  },
  "Akan Habis": {
    card: "border-danger/30 hover:border-danger/60",
    badge: "bg-danger/10 text-danger",
    footer: "bg-danger/10 text-danger border-danger/20",
  },
  Expired: {
    card: "border-danger/50 hover:border-danger/80",
    badge: "bg-danger text-white",
    footer: "bg-danger/10 text-danger border-danger/20",
  },
  "Belum Lengkap": {
    card: "border-warning/30 hover:border-warning/60",
    badge: "bg-warning/10 text-warning",
    footer: "bg-warning/10 text-warning border-warning/20",
  },
  "Tidak Wajib": {
    card: "border-border hover:border-primary/40",
    badge: "bg-muted text-muted-foreground",
    footer: "bg-muted/60 text-muted-foreground border-border",
  },
};

function formatTanggal(date?: string | null): string {
  if (!date) return "-";
  return new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function getStatus(expiredDate: string | null | undefined, required: boolean, reminderDays: number): StatusInfo {
  if (!required) return { key: "Tidak Wajib", label: "Tidak Wajib", detail: "Dokumen tidak diwajibkan", date: expiredDate || null };
  if (!expiredDate) return { key: "Belum Ada", label: "Belum Ada", detail: "Tanggal belum diisi", date: null };
  const remaining = daysUntil(expiredDate);
  if (remaining < 0) return { key: "Expired", label: "Expired", detail: `${Math.abs(remaining)} hari lalu`, date: expiredDate };
  if (remaining <= reminderDays) return { key: "Akan Habis", label: "Akan Habis", detail: remaining === 0 ? "Hari ini" : `${remaining} hari lagi`, date: expiredDate };
  return { key: "Aktif", label: "Aktif", detail: `${remaining} hari lagi`, date: expiredDate };
}

function getOverallDocumentStatus(statuses: Record<StatusTarget, StatusInfo>): OverallStatusInfo {
  const statusList = [statuses.KIR, statuses.STNK, statuses.PAJAK];
  if (statusList.some((s) => s.key === "Expired")) return { key: "Expired", label: "Expired", detail: "Ada dokumen yang sudah lewat jatuh tempo" };
  if (statusList.some((s) => s.key === "Akan Habis")) return { key: "Akan Habis", label: "Segera Habis", detail: "Segera lakukan perpanjangan" };
  if (statusList.some((s) => s.key === "Belum Ada")) return { key: "Belum Lengkap", label: "Belum Lengkap", detail: "Lengkapi data dokumen wajib" };

  const activeDates = statusList
    .filter((s) => s.key === "Aktif" && s.date)
    .map((s) => daysUntil(s.date as string));
  if (activeDates.some((remaining) => remaining <= 60)) return { key: "Perlu Diperhatikan", label: "Perlu Diperhatikan", detail: "Siapkan dokumen untuk perpanjangan" };
  if (statusList.every((s) => s.key === "Tidak Wajib")) return { key: "Tidak Wajib", label: "Tidak Wajib", detail: "Tidak ada dokumen wajib" };
  return { key: "Aman", label: "Aman", detail: "Semua dokumen masih berlaku" };
}

const overallPriority: Record<OverallDocumentStatus, number> = {
  Expired: 0, "Akan Habis": 1, "Belum Lengkap": 2, "Perlu Diperhatikan": 3, Aman: 4, "Tidak Wajib": 5,
};

function getDocumentDayText(info: StatusInfo): { value: string; label: string } {
  if (info.key === "Tidak Wajib") return { value: "-", label: "Opsional" };
  if (!info.date) return { value: "!", label: "Belum ada" };
  const remaining = daysUntil(info.date);
  if (remaining < 0) return { value: String(Math.abs(remaining)), label: "hari lalu" };
  if (remaining === 0) return { value: "0", label: "hari ini" };
  return { value: String(remaining), label: "hari lagi" };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatFileSize(size?: number | null): string {
  if (!size) return "-";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function localDateStr(date?: Date): string {
  const d = date || new Date();
  return d.toISOString().slice(0, 10);
}

function pdfDocCellContent(
  label: string,
  status: StatusInfo,
  doc: { issued_date: string | null; expired_date: string | null } | null,
  extra?: { label: string; date: string | null }[],
): string {
  const lines = [status.label];
  if (doc) {
    lines.push(`Terbit: ${formatTanggal(doc.issued_date)}`);
    lines.push(`Sampai: ${formatTanggal(doc.expired_date)}`);
  } else {
    lines.push("Terbit: -");
    lines.push("Sampai: -");
  }
  if (extra && extra.length > 0) {
    for (const e of extra) {
      lines.push(`${e.label}: ${formatTanggal(e.date)}`);
    }
  }
  return lines.join("\n");
}

function DocumentStatusBadge({ info, onClick }: { info: StatusInfo; onClick?: () => void }) {
  const content = (
    <>
      <span className={cn("inline-flex items-center text-[10px] font-bold px-2 py-1 rounded-full", statusStyle[info.key])}>{info.label}</span>
      <span className="text-[10px] text-muted-foreground mt-1 block">{info.date ? `${formatTanggal(info.date)} - ${info.detail}` : info.detail}</span>
    </>
  );

  if (!onClick) return <div>{content}</div>;
  return (
    <button type="button" onClick={onClick} className="text-left hover:opacity-80 transition-opacity">
      {content}
    </button>
  );
}

export default function DataMobilPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("data-mobil");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [docPage, setDocPage] = useState(1);
  const [docSearch, setDocSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("Semua");
  const [overallFilter, setOverallFilter] = useState<OverallDocumentStatus | "Semua">("Semua");
  const [vendorFilter, setVendorFilter] = useState("Semua");
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());

  const [vehicles, setVehicles] = useState<DbGaVehicle[]>([]);
  const [documents, setDocuments] = useState<DbGaVehicleDocument[]>([]);
  const [docSettings, setDocSettings] = useState<DbGaVehicleDocumentSetting | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; unit: string } | null>(null);
  const [detailVehicle, setDetailVehicle] = useState<DbGaVehicle | null>(null);
  const [docModalVehicle, setDocModalVehicle] = useState<DbGaVehicle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [vehicleVendors, setVehicleVendors] = useState<DbGaVehicleVendor[]>([]);
  const [vehicleDivisions, setVehicleDivisions] = useState<DbGaVehicleDivision[]>([]);

  const [documentForm, setDocumentForm] = useState<DocumentFormState>(emptyDocumentForm);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; label: string; mimeType?: string | null } | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (showForm || detailVehicle || deleteConfirm || docModalVehicle || previewMedia) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm, detailVehicle, deleteConfirm, docModalVehicle, previewMedia]);

  const fetchVehicles = useCallback(async () => {
    const { data, error } = await supabase
      .from("ga_vehicles")
      .select("*")
      .order("unit", { ascending: true });
    if (error) { showToast("error", "Gagal Memuat Data", error.message); return; }
    if (data) setVehicles(data as DbGaVehicle[]);
  }, [showToast]);

  const fetchVehicleDocuments = useCallback(async () => {
    const { data, error } = await supabase
      .from("ga_vehicle_documents")
      .select("*, files:ga_vehicle_document_files(*)")
      .order("created_at", { ascending: false });
    if (error) { showToast("error", "Gagal Memuat Dokumen", error.message); return; }
    if (data) {
      const rows = data.map((d) => ({
        ...d,
        files: (((d as { files?: DbGaVehicleDocumentFile[] }).files || []) as DbGaVehicleDocumentFile[])
          .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
      })) as DbGaVehicleDocument[];
      setDocuments(rows);
    }
  }, [showToast]);

  const fetchDocumentSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from("ga_vehicle_document_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) { showToast("error", "Gagal Memuat Setting Dokumen", error.message); return; }
    if (data) setDocSettings(data as DbGaVehicleDocumentSetting);
  }, [showToast]);

  const fetchVehicleVendors = useCallback(async () => {
    const { data } = await supabase.from("ga_vehicle_vendors").select("*").order("nama");
    if (data) setVehicleVendors(data);
  }, []);

  const fetchVehicleDivisions = useCallback(async () => {
    const { data } = await supabase.from("ga_vehicle_divisions").select("*").order("nama");
    if (data) setVehicleDivisions(data);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchVehicles(), fetchVehicleDocuments(), fetchDocumentSettings(), fetchVehicleVendors(), fetchVehicleDivisions()]);
      setLoading(false);
    })();
  }, [fetchVehicles, fetchVehicleDocuments, fetchDocumentSettings, fetchVehicleVendors, fetchVehicleDivisions]);

  const getCurrentDocument = (vehicleId: number, type: DocumentType) =>
    documents.find((d) => d.vehicle_id === vehicleId && d.document_type === type && d.is_current) || null;

  const getVehicleStatuses = (vehicle: DbGaVehicle) => {
    const kirDoc = getCurrentDocument(vehicle.id, "KIR");
    const stnkDoc = getCurrentDocument(vehicle.id, "STNK");
    return {
      KIR: getStatus(kirDoc?.expired_date, vehicle.kir_required ?? true, docSettings?.kir_reminder_days ?? 30),
      STNK: getStatus(stnkDoc?.expired_date, vehicle.stnk_required ?? true, docSettings?.stnk_reminder_days ?? 30),
      PAJAK: getStatus(stnkDoc?.pajak_expired_date, vehicle.pajak_required ?? true, docSettings?.pajak_reminder_days ?? 30),
    };
  };

  const vehicleStatusRows = vehicles.map((vehicle) => {
    const statuses = getVehicleStatuses(vehicle);
    return { vehicle, statuses, overall: getOverallDocumentStatus(statuses) };
  });
  const soonCount = vehicleStatusRows.filter((r) => r.overall.key === "Expired" || r.overall.key === "Akan Habis").length;
  const attentionCount = vehicleStatusRows.filter((r) => r.overall.key === "Perlu Diperhatikan" || r.overall.key === "Belum Lengkap").length;
  const safeCount = vehicleStatusRows.filter((r) => r.overall.key === "Aman").length;

  const filteredDocVehicles = vehicleStatusRows.filter(({ vehicle, statuses, overall }) => {
    const q = docSearch.toLowerCase();
    const matchSearch = !q
      || vehicle.unit.toLowerCase().includes(q)
      || vehicle.jenis.toLowerCase().includes(q)
      || (vehicle.divisi || "").toLowerCase().includes(q)
      || (vehicle.vendor || "").toLowerCase().includes(q)
      || (vehicle.lokasi_administrasi || "").toLowerCase().includes(q);
    const matchDivision = divisionFilter === "Semua" || (vehicle.divisi || "").toLowerCase() === divisionFilter.toLowerCase();
    const matchOverall = overallFilter === "Semua" || overall.key === overallFilter;
    const matchVendor = vendorFilter === "Semua" || (vehicle.vendor || "Tanpa Vendor") === vendorFilter;
    return matchSearch && matchDivision && matchOverall && matchVendor;
  });

  const getVendorKey = (v: DbGaVehicle): string => (v.vendor || "Tanpa Vendor").trim();

  const vendorCounts = new Map<string, number>();
  for (const v of filteredDocVehicles) {
    const key = getVendorKey(v.vehicle).toLowerCase();
    vendorCounts.set(key, (vendorCounts.get(key) || 0) + 1);
  }

  const sortedDocVehicles = [...filteredDocVehicles].sort((a, b) => {
    const va = getVendorKey(a.vehicle).toLowerCase();
    const vb = getVendorKey(b.vehicle).toLowerCase();
    const ca = -(vendorCounts.get(va) || 0);
    const cb = -(vendorCounts.get(vb) || 0);
    if (ca !== cb) return ca - cb;
    if (va !== vb) return va.localeCompare(vb);
    return overallPriority[a.overall.key] - overallPriority[b.overall.key];
  });

  const pagedDocVehicles = sortedDocVehicles.slice((docPage - 1) * PAGE_SIZE, docPage * PAGE_SIZE);

  const vendorGroups: { vendorKey: string; rows: typeof pagedDocVehicles }[] = [];
  const vendorGroupMap = new Map<string, typeof pagedDocVehicles>();
  for (const row of pagedDocVehicles) {
    const key = getVendorKey(row.vehicle);
    if (!vendorGroupMap.has(key)) vendorGroupMap.set(key, []);
    vendorGroupMap.get(key)!.push(row);
  }
  for (const [vendorKey, rows] of vendorGroupMap) {
    vendorGroups.push({ vendorKey, rows });
  }

  const toggleVendorGroup = (key: string) => {
    setExpandedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getVendorStats = (rows: typeof pagedDocVehicles) => {
    let expiredSoon = 0, attention = 0, safe = 0;
    for (const r of rows) {
      if (r.overall.key === "Expired" || r.overall.key === "Akan Habis") expiredSoon++;
      else if (r.overall.key === "Perlu Diperhatikan" || r.overall.key === "Belum Lengkap") attention++;
      else safe++;
    }
    return { total: rows.length, expiredSoon, attention, safe };
  };

  useEffect(() => {
    setExpandedVendors(new Set(vendorGroups.map((g) => g.vendorKey)));
  }, [vendorGroups]);

  const handleExportPdf = async () => {
    if (filteredDocVehicles.length === 0) {
      showToast("error", "Tidak Ada Data", "Tidak ada kendaraan yang cocok dengan filter saat ini.");
      return;
    }
    setPdfExporting(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFontSize(18);
      doc.text("Laporan Data Kendaraan", 14, 15);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(
        `General Affair - ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`,
        14, 22
      );
      doc.text(`${filteredDocVehicles.length} kendaraan`, pageWidth - 14, 22, { align: "right" });

      const expiredSoon = filteredDocVehicles.filter((r) => r.overall.key === "Expired" || r.overall.key === "Akan Habis").length;
      const attn = filteredDocVehicles.filter((r) => r.overall.key === "Perlu Diperhatikan" || r.overall.key === "Belum Lengkap").length;
      const safe = filteredDocVehicles.filter((r) => r.overall.key === "Aman").length;
      const vendorCount = new Set(filteredDocVehicles.map((r) => getVendorKey(r.vehicle))).size;

      doc.setDrawColor(200);
      doc.setFillColor(245, 247, 250);
      doc.roundedRect(14, 27, pageWidth - 28, 10, 2, 2, "FD");
      doc.setFontSize(8);
      doc.setTextColor(60);
      let sx = 19;
      doc.text(`Total: ${filteredDocVehicles.length}`, sx, 34);
      sx += 38;
      if (expiredSoon > 0) { doc.setTextColor(220, 38, 38); doc.text(`Kritis: ${expiredSoon}`, sx, 34); sx += 42; }
      if (attn > 0) { doc.setTextColor(245, 158, 11); doc.text(`Perhatian: ${attn}`, sx, 34); sx += 50; }
      if (safe > 0) { doc.setTextColor(34, 197, 94); doc.text(`Aman: ${safe}`, sx, 34); sx += 42; }
      doc.setTextColor(100); doc.text(`Vendor: ${vendorCount}`, sx, 34);

      let filterParts: string[] = [];
      if (docSearch) filterParts.push(`Cari: "${docSearch}"`);
      if (divisionFilter !== "Semua") filterParts.push(`Divisi: ${divisionFilter}`);
      if (overallFilter !== "Semua") filterParts.push(`Status: ${overallFilter}`);
      if (vendorFilter !== "Semua") filterParts.push(`Vendor: ${vendorFilter}`);
      if (filterParts.length > 0) {
        doc.setTextColor(120);
        doc.setFontSize(7);
        doc.text(`Filter: ${filterParts.join(" | ")}`, 14, 41);
      }

      const exportGroups = new Map<string, typeof filteredDocVehicles>();
      for (const row of filteredDocVehicles) {
        const key = getVendorKey(row.vehicle);
        if (!exportGroups.has(key)) exportGroups.set(key, []);
        exportGroups.get(key)!.push(row);
      }
      const sortedExportGroups = [...exportGroups.entries()].sort((a, b) => {
        if (a[1].length !== b[1].length) return b[1].length - a[1].length;
        return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
      });

      const pdfHeaders = ["No", "Unit", "Jenis", "Divisi", "Lokasi Administrasi", "Status Unit", "Status Kendaraan", "KIR", "STNK", "Pajak"];
      const pdfColWidths = [7, 28, 22, 18, 22, 14, 20, 38, 38, 38];
      let startY = 46;

      for (const [vendorKey, rows] of sortedExportGroups) {
        const stats = getVendorStats(rows);
        doc.setFontSize(9);
        doc.setTextColor(59, 130, 246);
        doc.setFont("helvetica", "bold");
        doc.text(`${vendorKey === "Tanpa Vendor" ? "Tanpa Vendor" : vendorKey} — ${stats.total} kendaraan`, 14, startY + 4);
        doc.setFontSize(7);
        doc.setTextColor(100);
        doc.setFont("helvetica", "normal");
        const extras: string[] = [];
        if (stats.expiredSoon > 0) extras.push(`Kritis: ${stats.expiredSoon}`);
        if (stats.attention > 0) extras.push(`Perhatian: ${stats.attention}`);
        if (stats.safe > 0) extras.push(`Aman: ${stats.safe}`);
        if (extras.length > 0) doc.text(extras.join(" | "), 90, startY + 4);

        const sortedRows = [...rows].sort((a, b) => overallPriority[a.overall.key] - overallPriority[b.overall.key]);

        const pdfRows = sortedRows.map((row, i) => {
          const kirDoc = getCurrentDocument(row.vehicle.id, "KIR");
          const stnkDoc = getCurrentDocument(row.vehicle.id, "STNK");
          return [
            String(i + 1),
            row.vehicle.unit,
            row.vehicle.jenis,
            row.vehicle.divisi || "-",
            row.vehicle.lokasi_administrasi || "-",
            row.vehicle.status || "Aktif",
            row.overall.label,
            pdfDocCellContent("KIR", row.statuses.KIR, kirDoc),
            pdfDocCellContent("STNK", row.statuses.STNK, stnkDoc),
            pdfDocCellContent("Pajak", row.statuses.PAJAK, stnkDoc, stnkDoc
              ? [{ label: "Jatuh Tempo", date: stnkDoc.pajak_expired_date }]
              : [{ label: "Jatuh Tempo", date: null }]
            ),
          ];
        });

        startY += 6;
        autoTable(doc, {
          head: [pdfHeaders],
          body: pdfRows,
          startY,
          columnStyles: {
            0: { cellWidth: pdfColWidths[0] },
            1: { cellWidth: pdfColWidths[1] },
            2: { cellWidth: pdfColWidths[2] },
            3: { cellWidth: pdfColWidths[3] },
            4: { cellWidth: pdfColWidths[4] },
            5: { cellWidth: pdfColWidths[5] },
            6: { cellWidth: pdfColWidths[6] },
            7: { cellWidth: pdfColWidths[7] },
            8: { cellWidth: pdfColWidths[8] },
            9: { cellWidth: pdfColWidths[9] },
          },
          styles: { fontSize: 6.5, cellPadding: 1.5, valign: "top" },
          headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold", fontSize: 6.5 },
          alternateRowStyles: { fillColor: [245, 247, 250] },
          margin: { left: 14, right: 14 },
        });
        startY = (doc as any).lastAutoTable.finalY + 8;
      }

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: "right" });
        doc.text("HRM System - General Affair", 14, doc.internal.pageSize.getHeight() - 8);
      }

      doc.save(`data_mobil_${localDateStr()}.pdf`);
      showToast("success", "Export Berhasil", `${filteredDocVehicles.length} kendaraan berhasil diexport ke PDF.`);
    } catch (err) {
      showToast("error", "Gagal Export PDF", err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setPdfExporting(false);
    }
  };

  const makeEmptyForm = (): FormState => ({
    ...emptyForm,
    kir_required: docSettings?.kir_required_default ?? true,
    stnk_required: docSettings?.stnk_required_default ?? true,
    pajak_required: docSettings?.pajak_required_default ?? true,
  });

  const openAdd = () => {
    setForm(makeEmptyForm());
    setEditingId(null);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (v: DbGaVehicle) => {
    setForm({
      unit: v.unit,
      jenis: v.jenis,
      divisi: v.divisi || "",
      vendor: v.vendor || "",
      vendor_id: v.vendor_id,
      vehicle_division_id: v.vehicle_division_id,
      lokasi_administrasi: v.lokasi_administrasi || "",
      no_rangka: v.no_rangka || "",
      nomer_mesin: v.nomer_mesin || "",
      volume: v.volume || "",
      tonase: v.tonase || "",
      suhu: v.suhu || "",
      kir_required: v.kir_required ?? true,
      stnk_required: v.stnk_required ?? true,
      pajak_required: v.pajak_required ?? true,
    });
    setEditingId(v.id);
    setFormError("");
    setShowForm(true);
  };

  const openDocumentModal = (vehicle: DbGaVehicle, type: DocumentType = "KIR") => {
    setDocModalVehicle(vehicle);
    setDetailVehicle(null);
    setDocumentForm({ ...emptyDocumentForm, document_type: type });
    setDocumentFiles([]);
    setDocumentError("");
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.unit.trim()) { setFormError("Unit wajib diisi."); return; }
    if (!form.jenis.trim()) { setFormError("Jenis wajib diisi."); return; }

    setFormSaving(true);
    const payload = {
      unit: form.unit.trim(),
      jenis: form.jenis.trim(),
      divisi: form.divisi.trim() || null,
      vendor: form.vendor.trim() || null,
      vendor_id: form.vendor_id,
      vehicle_division_id: form.vehicle_division_id,
      lokasi_administrasi: form.lokasi_administrasi.trim() || null,
      no_rangka: form.no_rangka.trim() || null,
      nomer_mesin: form.nomer_mesin.trim() || null,
      volume: form.volume.trim() || null,
      tonase: form.tonase.trim() || null,
      suhu: form.suhu.trim() || null,
      kir_required: form.kir_required,
      stnk_required: form.stnk_required,
      pajak_required: form.pajak_required,
    };

    try {
      if (editingId) {
        const { data: oldRow } = await supabase.from("ga_vehicles").select("*").eq("id", editingId).maybeSingle();
        const { error } = await supabase.from("ga_vehicles").update(payload).eq("id", editingId);
        if (error) {
          if (error.message.includes("unique") || error.message.includes("duplicate")) setFormError(`Unit "${payload.unit}" sudah digunakan.`);
          else setFormError(error.message);
          setFormSaving(false);
          return;
        }
        await logAudit({
          supabase, action: "update", entityType: "ga_vehicles", entityId: String(editingId),
          entityLabel: payload.unit, oldData: oldRow as Record<string, unknown>, newData: payload,
        });
        showToast("success", "Data Mobil Diperbarui", `Unit ${payload.unit} berhasil diperbarui.`);
      } else {
        const { data: inserted, error } = await supabase.from("ga_vehicles").insert(payload).select("id").single();
        if (error) {
          if (error.message.includes("unique") || error.message.includes("duplicate")) setFormError(`Unit "${payload.unit}" sudah digunakan.`);
          else setFormError(error.message);
          setFormSaving(false);
          return;
        }
        await logAudit({
          supabase, action: "create", entityType: "ga_vehicles", entityId: String(inserted?.id || ""),
          entityLabel: payload.unit, newData: payload,
        });
        showToast("success", "Data Mobil Ditambahkan", `Unit ${payload.unit} berhasil disimpan.`);
      }
      setShowForm(false);
      await fetchVehicles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { data: oldRow } = await supabase.from("ga_vehicles").select("*").eq("id", deleteConfirm.id).maybeSingle();
    const { error } = await supabase.from("ga_vehicles").delete().eq("id", deleteConfirm.id);
    if (error) { showToast("error", "Gagal Menghapus", error.message); setDeleting(false); return; }
    await logAudit({
      supabase, action: "delete", entityType: "ga_vehicles", entityId: String(deleteConfirm.id),
      entityLabel: deleteConfirm.unit, oldData: oldRow as Record<string, unknown>,
    });
    showToast("success", "Data Mobil Dihapus", `Unit ${deleteConfirm.unit} berhasil dihapus.`);
    setDeleting(false);
    setDeleteConfirm(null);
    await fetchVehicles();
    await fetchVehicleDocuments();
  };

  const handleDocumentFileSelect = (files: FileList | null) => {
    const selected = Array.from(files || []);
    if (selected.length === 0) { setDocumentFiles([]); return; }
    const invalidType = selected.find((file) => file.type !== "application/pdf" && !file.type.startsWith("image/"));
    if (invalidType) {
      setDocumentError(`Format file ${invalidType.name} tidak didukung. Gunakan PDF atau file gambar.`);
      return;
    }
    const invalidSize = selected.find((file) => file.size > MAX_FILE_SIZE);
    if (invalidSize) {
      setDocumentError(`File ${invalidSize.name} melebihi batas 5 MB.`);
      return;
    }
    setDocumentError("");
    setDocumentFiles(selected);
  };

  const handleSaveDocument = async () => {
    if (!docModalVehicle) return;
    setDocumentError("");
    if (!documentForm.expired_date) { setDocumentError("Tanggal masa berlaku wajib diisi."); return; }
    if (documentForm.document_type === "STNK" && docModalVehicle.pajak_required && !documentForm.pajak_expired_date) {
      setDocumentError("Tanggal jatuh tempo pajak wajib diisi untuk STNK.");
      return;
    }
    if (documentFiles.length === 0) { setDocumentError("Pilih minimal 1 file dokumen."); return; }

    setDocumentSaving(true);
    const payload = {
      vehicle_id: docModalVehicle.id,
      document_type: documentForm.document_type,
      document_number: documentForm.document_number.trim() || null,
      issued_date: documentForm.issued_date || null,
      expired_date: documentForm.expired_date || null,
      pajak_expired_date: documentForm.document_type === "STNK" ? (documentForm.pajak_expired_date || null) : null,
      notes: documentForm.notes.trim() || null,
      is_current: true,
    };

    try {
      const { data: inserted, error } = await supabase
        .from("ga_vehicle_documents")
        .insert(payload)
        .select("id")
        .single();
      if (error || !inserted?.id) {
        setDocumentError(error?.message || "Gagal menyimpan dokumen.");
        setDocumentSaving(false);
        return;
      }

      const fileRows = [];
      const timestamp = Date.now();
      for (let i = 0; i < documentFiles.length; i++) {
        const file = documentFiles[i];
        const path = `${docModalVehicle.id}/${documentForm.document_type.toLowerCase()}/${inserted.id}/${timestamp}-${i + 1}-${sanitizeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from("ga-vehicle-docs").upload(path, file, { upsert: false });
        if (uploadError) {
          setDocumentError(uploadError.message);
          setDocumentSaving(false);
          return;
        }
        const { data: urlData } = supabase.storage.from("ga-vehicle-docs").getPublicUrl(path);
        fileRows.push({
          document_id: inserted.id,
          file_url: `${urlData.publicUrl}?t=${timestamp}`,
          file_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          file_size_bytes: file.size,
          sort_order: i,
        });
      }

      const { error: fileError } = await supabase.from("ga_vehicle_document_files").insert(fileRows);
      if (fileError) {
        setDocumentError(fileError.message);
        setDocumentSaving(false);
        return;
      }

      await logAudit({
        supabase,
        action: "create",
        entityType: "ga_vehicle_documents",
        entityId: String(inserted.id),
        entityLabel: `${documentForm.document_type} ${docModalVehicle.unit}`,
        newData: { ...payload, files: fileRows } as Record<string, unknown>,
      });

      showToast("success", "Dokumen Disimpan", `${documentForm.document_type} unit ${docModalVehicle.unit} berhasil disimpan.`);
      setDocumentForm({ ...emptyDocumentForm, document_type: documentForm.document_type });
      setDocumentFiles([]);
      await fetchVehicleDocuments();
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setDocumentSaving(false);
    }
  };

  const handleDeleteFile = async (file: DbGaVehicleDocumentFile) => {
    if (!canEdit) return;
    setDeletingFileId(file.id);
    await supabase.storage.from("ga-vehicle-docs").remove([file.file_path]);
    const { error } = await supabase.from("ga_vehicle_document_files").delete().eq("id", file.id);
    if (error) showToast("error", "Gagal Menghapus File", error.message);
    else {
      await logAudit({
        supabase,
        action: "delete",
        entityType: "ga_vehicle_documents",
        entityId: String(file.document_id),
        entityLabel: file.file_name,
        oldData: file as unknown as Record<string, unknown>,
      });
      showToast("success", "File Dihapus", file.file_name);
      await fetchVehicleDocuments();
    }
    setDeletingFileId(null);
  };

  const handleDownloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const ext = url.split(".").pop()?.split("?")[0] || "file";
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${filename}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  const renderDocumentFiles = (doc: DbGaVehicleDocument) => (
    <div className="space-y-2 mt-3">
      {(doc.files || []).length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Belum ada file.</p>
      ) : (doc.files || []).map((file) => (
        <div key={file.id} className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            {file.mime_type === "application/pdf" ? <FileText className="w-4 h-4 text-primary" /> : <ImageIcon className="w-4 h-4 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{file.file_name}</p>
            <p className="text-[10px] text-muted-foreground">{formatFileSize(file.file_size_bytes)}</p>
          </div>
          <button onClick={() => setPreviewMedia({ url: file.file_url, label: file.file_name, mimeType: file.mime_type })} title="Lihat" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Eye className="w-3.5 h-3.5" /></button>
          <button onClick={() => handleDownloadFile(file.file_url, file.file_name)} title="Download" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Download className="w-3.5 h-3.5" /></button>
          {canEdit && <button onClick={() => handleDeleteFile(file)} disabled={deletingFileId === file.id} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      ))}
    </div>
  );

  const renderDocumentPanel = (vehicle: DbGaVehicle, type: DocumentType) => {
    const doc = getCurrentDocument(vehicle.id, type);
    const status = type === "KIR" ? getVehicleStatuses(vehicle).KIR : getVehicleStatuses(vehicle).STNK;
    return (
      <div className="rounded-2xl border border-border p-4 bg-muted/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-foreground">{type}</p>
            <DocumentStatusBadge info={status} />
          </div>
        </div>
        {doc ? (
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <p>No: <span className="text-foreground font-medium">{doc.document_number || "-"}</span></p>
            <p>Terbit: <span className="text-foreground font-medium">{formatTanggal(doc.issued_date)}</span></p>
            {type === "STNK" && <p>Pajak: <span className="text-foreground font-medium">{formatTanggal(doc.pajak_expired_date)}</span></p>}
            {doc.notes && <p>Catatan: <span className="text-foreground font-medium">{doc.notes}</span></p>}
            {renderDocumentFiles(doc)}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-3">Belum ada dokumen aktif.</p>
        )}
      </div>
    );
  };

  const renderVehicleDocumentMetric = (vehicle: DbGaVehicle, target: StatusTarget, info: StatusInfo) => {
    const dayText = getDocumentDayText(info);
    const documentType: DocumentType = target === "KIR" ? "KIR" : "STNK";
    return (
      <button
        key={target}
        type="button"
        onClick={(e) => { e.stopPropagation(); openDocumentModal(vehicle, documentType); }}
        className="group text-center rounded-2xl p-2 hover:bg-muted/70 transition-colors"
      >
        <p className="text-[10px] font-bold text-foreground mb-1">{target}</p>
        <div className={cn("mx-auto w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center leading-none", documentCardStyle[info.key])}>
          <span className="text-base font-black">{dayText.value}</span>
          <span className="text-[9px] font-bold mt-0.5">{dayText.value === "!" ? "" : "hari"}</span>
        </div>
        <p className="text-[10px] font-semibold text-foreground mt-1.5 truncate">{dayText.label}</p>
        <p className="text-[9px] text-muted-foreground truncate">{info.date ? formatTanggal(info.date) : info.label}</p>
      </button>
    );
  };

  const renderVehicleCard = ({ vehicle, statuses, overall }: (typeof vehicleStatusRows)[number]) => {
    const styles = overallStyle[overall.key];
    return (
      <div
        key={vehicle.id}
        role="button"
        tabIndex={0}
        onClick={() => openDocumentModal(vehicle)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDocumentModal(vehicle);
          }
        }}
        className={cn("bg-card rounded-3xl border p-4 shadow-sm hover:shadow-lg transition-all cursor-pointer outline-none focus:ring-2 focus:ring-primary/20", styles.card)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-foreground truncate">{vehicle.unit}</h3>
            <p className="text-xs font-semibold text-muted-foreground truncate mt-0.5">{vehicle.jenis}</p>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{vehicle.lokasi_administrasi || vehicle.divisi || vehicle.vendor || "Lokasi belum diisi"}</p>
          </div>
          <span className={cn("shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide", styles.badge)}>{overall.label}</span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-[92px_1fr] gap-3 items-center">
          <div className="h-24 rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-muted flex items-center justify-center border border-primary/10">
            <Truck className="w-12 h-12 text-primary/70" />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {renderVehicleDocumentMetric(vehicle, "KIR", statuses.KIR)}
            {renderVehicleDocumentMetric(vehicle, "PAJAK", statuses.PAJAK)}
            {renderVehicleDocumentMetric(vehicle, "STNK", statuses.STNK)}
          </div>
        </div>

        <div className={cn("mt-4 flex items-center gap-2 rounded-2xl border px-3 py-2", styles.footer)}>
          {overall.key === "Aman" ? <CircleCheckBig className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <p className="text-[10px] font-bold flex-1 min-w-0 truncate">{overall.detail}</p>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center rounded-full px-2 py-1 text-[9px] font-bold", vehicle.status === "Aktif" ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>{vehicle.status}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); setDetailVehicle(vehicle); }} title="Detail Unit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Eye className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); openDocumentModal(vehicle); }} title="Kelola Dokumen" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Settings2 className="w-3.5 h-3.5" /></button>
            {canEdit && <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(vehicle); }} title="Edit Unit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
            {canEdit && <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: vehicle.id, unit: vehicle.unit }); }} title="Hapus Unit" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <RouteGuard permission="data-mobil">
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          title="Kendaraan Aktif"
          description="Pantau masa berlaku KIR, STNK, dan Pajak setiap kendaraan"
          icon={Truck}
          actions={<div className="flex items-center gap-2">
            <Button icon={FileDown} variant="outline" size="sm" onClick={handleExportPdf} disabled={pdfExporting}>{pdfExporting ? "Mengexport..." : "Export PDF"}</Button>
            {canInput && <Button icon={Plus} size="sm" onClick={openAdd}>Tambah Mobil</Button>}
          </div>}
        />

        {toast.show && (
          <Portal>
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
              <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]", toast.type === "error" ? "border-danger/20" : "border-success/20")}>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
                  {toast.type === "error" ? <AlertTriangle className="w-5 h-5 text-danger" /> : <CircleCheckBig className="w-5 h-5 text-success" />}
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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Segera Habis / Expired</p>
            <p className="text-xl font-bold text-danger mt-1">{soonCount}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Perlu Diperhatikan</p>
            <p className="text-xl font-bold text-warning mt-1">{attentionCount}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Aman</p>
            <p className="text-xl font-bold text-success mt-1">{safeCount}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Kendaraan</p>
            <p className="text-xl font-bold text-foreground mt-1">{vehicles.length}</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" placeholder="Cari unit, jenis, lokasi administrasi..." value={docSearch}
                onChange={(e) => { setDocSearch(e.target.value); setDocPage(1); }}
                className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
            </div>
            <Select
              value={divisionFilter}
              onChange={(v) => { setDivisionFilter(v); setDocPage(1); }}
              options={["Semua", ...new Set(vehicleStatusRows.map((r) => r.vehicle.divisi).filter((d): d is string => !!d))].map((v) => ({ value: v, label: v === "Semua" ? "Semua Divisi" : v }))}
              className="w-44"
            />
            <Select
              value={overallFilter}
              onChange={(v) => { setOverallFilter(v as OverallDocumentStatus | "Semua"); setDocPage(1); }}
              options={["Semua", "Aman", "Perlu Diperhatikan", "Akan Habis", "Expired", "Belum Lengkap", "Tidak Wajib"].map((v) => ({ value: v, label: v === "Semua" ? "Semua Kendaraan" : v }))}
              className="w-44"
            />
            <Select
              value={vendorFilter}
              onChange={(v) => { setVendorFilter(v); setDocPage(1); setExpandedVendors(new Set()); }}
              options={["Semua", ...new Set(vehicleStatusRows.map((r) => r.vehicle.vendor || "Tanpa Vendor"))].map((v) => ({ value: v, label: v === "Semua" ? "Semua Vendor" : v }))}
              className="w-44"
            />
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card rounded-3xl border border-border p-4 animate-pulse space-y-3">
                <div className="h-4 bg-muted rounded w-24" />
                <div className="h-3 bg-muted rounded w-40" />
                <div className="h-24 bg-muted rounded-2xl" />
                <div className="h-10 bg-muted rounded-2xl" />
                <div className="flex justify-between"><div className="h-4 bg-muted rounded w-16" /><div className="flex gap-1"><div className="w-7 h-7 bg-muted rounded-lg" /><div className="w-7 h-7 bg-muted rounded-lg" /></div></div>
              </div>
            ))}
          </div>
        ) : pagedDocVehicles.length === 0 ? (
          <div className="bg-card rounded-3xl border border-border p-12 text-center">
            <Truck className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-sm font-bold text-foreground">{vehicles.length === 0 ? "Belum ada kendaraan" : "Tidak ada kendaraan yang cocok"}</p>
            <p className="text-xs text-muted-foreground mt-1">{vehicles.length === 0 ? "Klik tombol Tambah Mobil untuk mulai." : "Coba ubah filter atau kata kunci pencarian."}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {vendorGroups.map(({ vendorKey, rows }) => {
              const stats = getVendorStats(rows);
              const isExpanded = expandedVendors.has(vendorKey);
              return (
                <div key={vendorKey} className="bg-card rounded-3xl border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleVendorGroup(vendorKey)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-foreground truncate">{vendorKey === "Tanpa Vendor" ? "Tanpa Vendor" : vendorKey}</p>
                      <p className="text-[10px] text-muted-foreground">{stats.total} kendaraan</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-2.5">
                      {stats.expiredSoon > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-1 text-[10px] font-bold text-danger"><AlertTriangle className="w-3 h-3" />{stats.expiredSoon} {stats.expiredSoon > 1 ? "Kritis" : "Kritis"}</span>}
                      {stats.attention > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 text-[10px] font-bold text-warning"><AlertTriangle className="w-3 h-3" />{stats.attention} Perhatian</span>}
                      {stats.safe > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold text-success"><CircleCheckBig className="w-3 h-3" />{stats.safe} Aman</span>}
                    </div>
                    <div className="shrink-0 text-muted-foreground">
                      <ChevronDown className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")} />
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {rows.map(({ vehicle, statuses, overall }) => renderVehicleCard({ vehicle, statuses, overall }))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <Pagination currentPage={docPage} totalItems={filteredDocVehicles.length} pageSize={PAGE_SIZE} onPageChange={setDocPage} />
          </div>
        )}

        {showForm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
              <div className="relative w-full max-w-2xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Truck className="w-5 h-5 text-primary" /></div>
                    <h3 className="text-base font-bold text-foreground">{editingId ? "Edit Data Mobil" : "Tambah Data Mobil"}</h3>
                  </div>
                  <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {formError && <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{formError}</div>}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">UNIT *</label>
                      <input type="text" placeholder="B 1234 ABC" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value.toUpperCase() })} className={cn(inputClass, "uppercase")} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">JENIS *</label>
                      <input type="text" placeholder="Box, Wingbox, Tronton, dll" value={form.jenis} onChange={(e) => setForm({ ...form, jenis: e.target.value })} className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">DEVISI</label>
                      <Select
                        value={String(form.vehicle_division_id || "")}
                        onChange={(val) => {
                          const found = vehicleDivisions.find((d) => String(d.id) === val);
                          setForm({ ...form, vehicle_division_id: found ? found.id : null, divisi: found ? found.nama : val });
                        }}
                        options={[
                          { value: "", label: "Pilih divisi..." },
                          ...vehicleDivisions.filter((d) => d.status === "Aktif").map((d) => ({ value: String(d.id), label: d.nama })),
                        ]}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">VENDOR</label>
                      <Select
                        value={String(form.vendor_id || "")}
                        onChange={(val) => {
                          const found = vehicleVendors.find((v) => String(v.id) === val);
                          setForm({ ...form, vendor_id: found ? found.id : null, vendor: found ? found.nama : val });
                        }}
                        options={[
                          { value: "", label: "Pilih vendor..." },
                          ...vehicleVendors.filter((v) => v.status === "Aktif").map((v) => ({ value: String(v.id), label: v.nama })),
                        ]}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">LOKASI ADMINISTRASI</label>
                    <input type="text" placeholder="Lokasi penyimpanan/administrasi dokumen" value={form.lokasi_administrasi} onChange={(e) => setForm({ ...form, lokasi_administrasi: e.target.value })} className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">NO RANGKA</label>
                      <input type="text" placeholder="Nomor rangka kendaraan" value={form.no_rangka} onChange={(e) => setForm({ ...form, no_rangka: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">NOMER MESIN</label>
                      <input type="text" placeholder="Nomor mesin kendaraan" value={form.nomer_mesin} onChange={(e) => setForm({ ...form, nomer_mesin: e.target.value })} className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">VOLUME</label>
                      <input type="text" placeholder="CBM / liter" value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">TONASE</label>
                      <input type="text" placeholder="Ton / kg" value={form.tonase} onChange={(e) => setForm({ ...form, tonase: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">SUHU</label>
                      <input type="text" placeholder="-18C / Normal" value={form.suhu} onChange={(e) => setForm({ ...form, suhu: e.target.value })} className={inputClass} />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border p-3 bg-muted/20">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Kewajiban Dokumen</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { key: "kir_required", label: "Wajib KIR" },
                        { key: "stnk_required", label: "Wajib STNK" },
                        { key: "pajak_required", label: "Wajib Pajak" },
                      ].map((item) => (
                        <label key={item.key} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground cursor-pointer">
                          <input type="checkbox" checked={Boolean(form[item.key as keyof FormState])} onChange={(e) => setForm({ ...form, [item.key]: e.target.checked })} className="rounded border-border text-primary focus:ring-primary" />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                  <Button size="sm" icon={Check} onClick={handleSave} disabled={formSaving}>{formSaving ? "Menyimpan..." : editingId ? "Simpan" : "Tambah"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {detailVehicle && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetailVehicle(null)} />
              <div className="relative w-full max-w-2xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Truck className="w-5 h-5 text-primary" /></div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">Detail Data Mobil</h3>
                      <p className="text-xs text-muted-foreground">{detailVehicle.unit}</p>
                    </div>
                  </div>
                  <button onClick={() => setDetailVehicle(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {DETAIL_FIELDS.map((f) => {
                      const value = detailVehicle[f.key] || "-";
                      return (
                        <div key={f.key}>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{f.label}</label>
                          <p className="text-sm text-foreground mt-1">{value}</p>
                        </div>
                      );
                    })}
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">STATUS</label>
                      <span className={cn("inline-flex items-center text-xs font-bold px-2 py-1 rounded-full mt-1", detailVehicle.status === "Aktif" ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>{detailVehicle.status}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border p-4 bg-muted/20">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-sm font-bold text-foreground">Status Dokumen</p>
                        <p className="text-[10px] text-muted-foreground">KIR, STNK, dan pajak dari data STNK</p>
                      </div>
                      <Button variant="outline" size="sm" icon={FileText} onClick={() => openDocumentModal(detailVehicle)}>Kelola Dokumen</Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {Object.entries(getVehicleStatuses(detailVehicle)).map(([key, info]) => (
                        <div key={key} className="rounded-xl border border-border bg-card px-3 py-2">
                          <p className="text-[10px] font-bold text-muted-foreground mb-1">{key}</p>
                          <DocumentStatusBadge info={info} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-end">
                  <Button variant="outline" size="sm" onClick={() => setDetailVehicle(null)}>Tutup</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {docModalVehicle && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !documentSaving && setDocModalVehicle(null)} />
              <div className="relative w-full max-w-5xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[92vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><FileText className="w-5 h-5 text-primary" /></div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">Kelola Dokumen Kendaraan</h3>
                      <p className="text-xs text-muted-foreground">{docModalVehicle.unit} - {docModalVehicle.jenis}</p>
                    </div>
                  </div>
                  <button onClick={() => !documentSaving && setDocModalVehicle(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {renderDocumentPanel(docModalVehicle, "KIR")}
                    {renderDocumentPanel(docModalVehicle, "STNK")}
                  </div>

                  {canInput && (
                    <div className="rounded-2xl border border-border p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Upload className="w-4 h-4 text-primary" />
                        <p className="text-sm font-bold text-foreground">Upload / Perpanjang Dokumen</p>
                      </div>
                      {documentError && <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger mb-3">{documentError}</div>}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">JENIS DOKUMEN *</label>
                          <Select
                            value={documentForm.document_type}
                            onChange={(v) => setDocumentForm({ ...documentForm, document_type: v as DocumentType, pajak_expired_date: v === "STNK" ? documentForm.pajak_expired_date : "" })}
                            options={DOCUMENT_TYPES.map((v) => ({ value: v, label: v }))}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">NOMOR DOKUMEN</label>
                          <input type="text" value={documentForm.document_number} onChange={(e) => setDocumentForm({ ...documentForm, document_number: e.target.value })} className={inputClass} placeholder="Nomor KIR/STNK" />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">TANGGAL TERBIT/BAYAR</label>
                          <input type="date" value={documentForm.issued_date} onChange={(e) => setDocumentForm({ ...documentForm, issued_date: e.target.value })} className={inputClass} />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">MASA BERLAKU *</label>
                          <input type="date" value={documentForm.expired_date} onChange={(e) => setDocumentForm({ ...documentForm, expired_date: e.target.value })} className={inputClass} />
                        </div>
                        {documentForm.document_type === "STNK" && (
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">JATUH TEMPO PAJAK</label>
                            <input type="date" value={documentForm.pajak_expired_date} onChange={(e) => setDocumentForm({ ...documentForm, pajak_expired_date: e.target.value })} className={inputClass} />
                          </div>
                        )}
                        <div className={cn(documentForm.document_type === "STNK" ? "" : "md:col-span-2")}>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">CATATAN</label>
                          <input type="text" value={documentForm.notes} onChange={(e) => setDocumentForm({ ...documentForm, notes: e.target.value })} className={inputClass} placeholder="Catatan opsional" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">MEDIA DOKUMEN * <span className="font-normal">(PDF / foto, maks 5 MB per file)</span></label>
                          <label className="flex items-center justify-center gap-2 px-3 py-4 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary-light/20 text-xs text-muted-foreground hover:text-primary cursor-pointer transition-all">
                            <Upload className="w-4 h-4" />
                            <span>{documentFiles.length > 0 ? `${documentFiles.length} file dipilih` : "Pilih satu atau beberapa file"}</span>
                            <input type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => { handleDocumentFileSelect(e.target.files); e.target.value = ""; }} />
                          </label>
                          {documentFiles.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {documentFiles.map((file) => (
                                <span key={`${file.name}-${file.size}`} className="text-[10px] font-semibold bg-success/10 text-success px-2 py-1 rounded-lg">{file.name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 mt-4">
                        <Button variant="outline" size="sm" onClick={() => { setDocumentForm({ ...emptyDocumentForm, document_type: documentForm.document_type }); setDocumentFiles([]); setDocumentError(""); }} disabled={documentSaving}>Reset</Button>
                        <Button size="sm" icon={Upload} onClick={handleSaveDocument} disabled={documentSaving}>{documentSaving ? "Menyimpan..." : "Simpan Dokumen"}</Button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-border p-4">
                    <p className="text-sm font-bold text-foreground mb-3">History Dokumen</p>
                    <div className="space-y-3">
                      {documents.filter((d) => d.vehicle_id === docModalVehicle.id).length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">Belum ada history dokumen.</p>
                      ) : documents.filter((d) => d.vehicle_id === docModalVehicle.id).map((doc) => (
                        <div key={doc.id} className="rounded-xl border border-border bg-muted/20 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-foreground">{doc.document_type}</p>
                                {doc.is_current && <span className="text-[10px] font-bold bg-success/10 text-success px-2 py-0.5 rounded-full">Aktif</span>}
                              </div>
                              <p className="text-[10px] text-muted-foreground">Berlaku sampai {formatTanggal(doc.expired_date)}{doc.document_type === "STNK" ? `, pajak ${formatTanggal(doc.pajak_expired_date)}` : ""}</p>
                            </div>
                            <p className="text-[10px] text-muted-foreground">{formatTanggal(doc.created_at?.slice(0, 10))}</p>
                          </div>
                          {renderDocumentFiles(doc)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-end">
                  <Button variant="outline" size="sm" onClick={() => setDocModalVehicle(null)} disabled={documentSaving}>Tutup</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {previewMedia && (
          <Portal>
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setPreviewMedia(null)} />
              <div className="relative bg-card rounded-2xl shadow-2xl overflow-hidden max-w-3xl w-full max-h-[85vh] flex flex-col animate-scale-in">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center"><FileText className="w-4 h-4 text-primary" /></div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">{previewMedia.label}</h3>
                      <p className="text-[10px] text-muted-foreground">Dokumen Kendaraan</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a href={previewMedia.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"><ExternalLink className="w-3.5 h-3.5" />Buka</a>
                    <button onClick={() => handleDownloadFile(previewMedia.url, previewMedia.label)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary bg-primary-light hover:bg-primary hover:text-white"><Download className="w-3.5 h-3.5" />Download</button>
                    <button onClick={() => setPreviewMedia(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/20 min-h-[300px]">
                  {previewMedia.mimeType === "application/pdf" || previewMedia.url.split("?")[0].toLowerCase().endsWith(".pdf") ? (
                    <div className="text-center space-y-3">
                      <FileText className="w-16 h-16 text-muted-foreground/30 mx-auto" />
                      <p className="text-sm text-muted-foreground">File PDF tidak bisa di-preview langsung</p>
                      <Button size="sm" icon={Download} onClick={() => handleDownloadFile(previewMedia.url, previewMedia.label)}>Download PDF</Button>
                    </div>
                  ) : (
                    <img src={previewMedia.url} alt={previewMedia.label} className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg" />
                  )}
                </div>
              </div>
            </div>
          </Portal>
        )}

        {deleteConfirm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
              <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0"><Trash2 className="w-5 h-5 text-danger" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-foreground">Hapus Data Mobil?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Unit <strong className="text-foreground">{deleteConfirm.unit}</strong> akan dihapus permanen.</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                  <Button size="sm" icon={Trash2} onClick={handleDelete} disabled={deleting} className="bg-danger text-white hover:bg-danger/90">{deleting ? "Menghapus..." : "Hapus"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    </RouteGuard>
  );
}
