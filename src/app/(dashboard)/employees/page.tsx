"use client";

import { useState, useEffect, useRef } from "react";
import {
  Users,
  Plus,
  Search,
  Filter,
  Download,
  Eye,
  X,
  User,
  MapPin,
  Phone,
  Briefcase,
  Heart,
  CreditCard,
  Shield,
  FileText,
  Calendar,
  ChevronRight,
  ImageIcon,
  Copy,
  Check,
  Pencil,
  Save,
  Upload,
  FileSpreadsheet,
  Table,
  Wand2,
  CircleCheckBig,
  ExternalLink,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import DatePicker from "@/components/ui/DatePicker";
import Select from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import Pagination from "@/components/ui/Pagination";
import { supabase, type DbPegawai } from "@/lib/supabase";
import { cn, formatShortDate, toTitleCase } from "@/lib/utils";
import { compressFile } from "@/lib/file-compression";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

// ─── Map DB row to UI-friendly shape ───
type Employee = DbPegawai & { jabatanNama?: string };

// ─── Kelengkapan Data ───
const COMPLETENESS_FIELDS: { key: keyof DbPegawai; label: string; group: string }[] = [
  // Data Pribadi
  { key: "nama", label: "Nama Lengkap", group: "Pribadi" },
  { key: "no_ktp", label: "No. KTP", group: "Pribadi" },
  { key: "jenis_kelamin", label: "Jenis Kelamin", group: "Pribadi" },
  { key: "agama", label: "Agama", group: "Pribadi" },
  { key: "tempat_lahir", label: "Tempat Lahir", group: "Pribadi" },
  { key: "tanggal_lahir", label: "Tanggal Lahir", group: "Pribadi" },
  { key: "alamat_ktp", label: "Alamat KTP", group: "Pribadi" },
  { key: "alamat_domisili", label: "Alamat Domisili", group: "Pribadi" },
  { key: "no_telp", label: "No. Telepon", group: "Pribadi" },
  // Kepegawaian
  { key: "jabatan_id", label: "Jabatan", group: "Kepegawaian" },
  { key: "tanggal_bergabung", label: "Tanggal Bergabung", group: "Kepegawaian" },
  // Keuangan
  { key: "bank", label: "Bank", group: "Keuangan" },
  { key: "no_rekening", label: "No. Rekening", group: "Keuangan" },
  { key: "nama_rekening", label: "Nama Rekening", group: "Keuangan" },
  // BPJS
  { key: "no_bpjs_kesehatan", label: "BPJS Kesehatan", group: "BPJS" },
  { key: "no_bpjs_ketenagakerjaan", label: "BPJS Ketenagakerjaan", group: "BPJS" },
  // Dokumen
  { key: "foto_ktp", label: "Foto KTP", group: "Dokumen" },
  { key: "foto_diri", label: "Foto Diri", group: "Dokumen" },
  { key: "foto_sim", label: "Foto SIM", group: "Dokumen" },
  { key: "kartu_keluarga", label: "Kartu Keluarga", group: "Dokumen" },
];

function getCompleteness(emp: Employee) {
  const total = COMPLETENESS_FIELDS.length;
  let filled = 0;
  const missing: { label: string; group: string }[] = [];

  for (const f of COMPLETENESS_FIELDS) {
    const val = emp[f.key];
    const isFilled = val !== null && val !== undefined && val !== "" && val !== "-";
    if (isFilled) filled++;
    else missing.push({ label: f.label, group: f.group });
  }

  const percent = Math.round((filled / total) * 100);
  return { filled, total, percent, missing };
}

function CompletenessRing({ percent, size = 28 }: { percent: number; size?: number }) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent === 100 ? "var(--color-success)" : percent >= 70 ? "var(--color-warning)" : "var(--color-danger)";

  return (
    <svg width={size} height={size} className="flex-shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-border" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
    </svg>
  );
}

// ─── Status helpers ───
const statusVariant: Record<string, "success" | "warning" | "muted"> = {
  Aktif: "success",
  Cuti: "warning",
  "Tidak Aktif": "muted",
};

// ─── Detail Section Component ───
function Section({ title, icon: Icon, children }: { title: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-primary-light flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">{title}</h4>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, full, copyable }: { label: string; value: React.ReactNode; full?: boolean; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value || typeof value !== "string") return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5 group">
        <p className="text-sm text-foreground">{value || <span className="text-muted-foreground italic">Belum diisi</span>}</p>
        {copyable && value && typeof value === "string" && (
          <button
            onClick={handleCopy}
            className={cn(
              "p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity",
              copied ? "text-success bg-success-light" : "text-muted-foreground hover:text-primary hover:bg-primary-light"
            )}
            title={copied ? "Tersalin!" : `Salin ${label}`}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

function DocBadge({ exists, label, url, onPreview }: { exists: boolean; label: string; url?: string | null; onPreview?: (url: string, label: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => { if (exists && url && onPreview) onPreview(url, label); }}
      disabled={!exists}
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium w-full text-left",
        exists
          ? "bg-success-light/50 border-success/20 text-success hover:bg-success-light/80 hover:border-success/40 cursor-pointer"
          : "bg-muted border-border text-muted-foreground cursor-default"
      )}
    >
      <ImageIcon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {exists ? (
        <span className="text-[10px] flex items-center gap-1"><Eye className="w-3 h-3" />Lihat</span>
      ) : (
        <span className="text-[10px]">Belum</span>
      )}
    </button>
  );
}

// ─── Form Field Component ───
function FormField({ label, required, children, full, hasError }: { label: string; required?: boolean; children: React.ReactNode; full?: boolean; hasError?: boolean }) {
  return (
    <div className={cn(full ? "sm:col-span-2" : "", hasError ? "animate-fade-in" : "")}>
      <label className={cn("text-xs font-semibold mb-1.5 block", hasError ? "text-danger" : "text-foreground")}>
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <div className={hasError ? "[&>input]:border-danger [&>input]:ring-2 [&>input]:ring-danger/20 [&>select]:border-danger [&>select]:ring-2 [&>select]:ring-danger/20 [&>textarea]:border-danger [&>textarea]:ring-2 [&>textarea]:ring-danger/20 [&>div>input]:border-danger [&>div>input]:ring-2 [&>div>input]:ring-danger/20" : ""}>
        {children}
      </div>
      {hasError && <p className="text-[10px] text-danger mt-1">Wajib diisi</p>}
    </div>
  );
}

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const selectClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none text-foreground";

// Fields yang auto Title Case di edit mode
const editTitleCaseFields = new Set(["nama", "tempat_lahir", "nama_pasangan", "nama_rekening"]);

// ─── Edit Field (inline edit) ───
function EditField({ label, value, field, editData, setEditData, full, type = "text", options }: {
  label: string;
  value: string | null;
  field: string;
  editData: Record<string, string | null>;
  setEditData: (data: Record<string, string | null>) => void;
  full?: boolean;
  type?: "text" | "date" | "number" | "select" | "textarea";
  options?: string[];
}) {
  const currentValue = editData[field] ?? value ?? "";
  const handleChange = (val: string) => {
    const formatted = editTitleCaseFields.has(field) ? toTitleCase(val) : val;
    setEditData({ ...editData, [field]: formatted });
  };
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      {type === "textarea" ? (
        <textarea
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          rows={2}
          className={cn(inputClass, "resize-none")}
        />
      ) : type === "select" && options ? (
        <Select
          value={currentValue}
          onChange={(val) => handleChange(val)}
          options={options.map((opt) => ({ value: opt, label: opt }))}
        />
      ) : type === "date" ? (
        <DatePicker value={currentValue} onChange={(val) => handleChange(val)} />
      ) : (
        <input
          type={type}
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════
export default function EmployeesPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("employees");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editData, setEditData] = useState<Record<string, string | null>>({});
  const [successToast, setSuccessToast] = useState<{ show: boolean; title: string; message: string }>({ show: false, title: "", message: "" });

  const showSuccessToast = (title: string, message: string) => {
    setSuccessToast({ show: true, title, message });
    setTimeout(() => setSuccessToast({ show: false, title: "", message: "" }), 4000);
  };
  const [newId, setNewId] = useState("");
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvImportSuccess, setCsvImportSuccess] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvImportedCount, setCsvImportedCount] = useState(0);

  // ─── Fetch pegawai dari Supabase ───
  const fetchEmployees = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pegawai")
      .select("*, jabatan(id, nama, level_id, levels(nama))")
      .order("created_at", { ascending: false });

    if (!error && data) {
      const mapped: Employee[] = data.map((row) => ({
        ...row,
        jabatanNama: row.jabatan?.nama || "-",
      }));
      setEmployees(mapped);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  // Lock body scroll saat panel/modal terbuka
  useEffect(() => {
    if (selectedEmployee || showAddForm || showImportCsv) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [selectedEmployee, showAddForm, showImportCsv]);

  const handleOpenDetail = (emp: Employee) => {
    setSelectedEmployee(emp);
    setIsEditing(false);
    setEditData({});
  };

  const handleStartEdit = () => {
    if (!selectedEmployee) return;
    setEditData({
      nama: selectedEmployee.nama,
      jenis_kelamin: selectedEmployee.jenis_kelamin,
      agama: selectedEmployee.agama,
      no_ktp: selectedEmployee.no_ktp,
      tempat_lahir: selectedEmployee.tempat_lahir,
      tanggal_lahir: selectedEmployee.tanggal_lahir,
      alamat_ktp: selectedEmployee.alamat_ktp,
      alamat_domisili: selectedEmployee.alamat_domisili,
      no_telp: selectedEmployee.no_telp,
      tanggal_bergabung: selectedEmployee.tanggal_bergabung,
      status: selectedEmployee.status,
      tanggal_mulai_pkwt: selectedEmployee.tanggal_mulai_pkwt,
      tanggal_berakhir_pkwt: selectedEmployee.tanggal_berakhir_pkwt,
      status_pernikahan: selectedEmployee.status_pernikahan,
      nama_pasangan: selectedEmployee.nama_pasangan,
      jumlah_anak: String(selectedEmployee.jumlah_anak),
      bank: selectedEmployee.bank,
      no_rekening: selectedEmployee.no_rekening,
      nama_rekening: selectedEmployee.nama_rekening,
      no_bpjs_kesehatan: selectedEmployee.no_bpjs_kesehatan,
      no_bpjs_ketenagakerjaan: selectedEmployee.no_bpjs_ketenagakerjaan,
      jabatan_id: selectedEmployee.jabatan_id ? String(selectedEmployee.jabatan_id) : "",
    });
    setEditFiles({ foto_ktp: null, foto_diri: null, foto_sim: null, kartu_keluarga: null });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({});
  };

  const handleSaveEdit = async () => {
    if (!selectedEmployee) return;
    setEditSaving(true);

    // Upload new files if any
    const fileUpdates: Record<string, string | null> = {};
    if (editFiles.foto_ktp) {
      const url = await uploadFile(editFiles.foto_ktp, selectedEmployee.id, "ktp");
      if (url) fileUpdates.foto_ktp = url;
    }
    if (editFiles.foto_diri) {
      const url = await uploadFile(editFiles.foto_diri, selectedEmployee.id, "foto");
      if (url) fileUpdates.foto_diri = url;
    }
    if (editFiles.foto_sim) {
      const url = await uploadFile(editFiles.foto_sim, selectedEmployee.id, "sim");
      if (url) fileUpdates.foto_sim = url;
    }
    if (editFiles.kartu_keluarga) {
      const url = await uploadFile(editFiles.kartu_keluarga, selectedEmployee.id, "kk");
      if (url) fileUpdates.kartu_keluarga = url;
    }

    const { error } = await supabase
      .from("pegawai")
      .update({
        nama: editData.nama,
        jenis_kelamin: editData.jenis_kelamin,
        agama: editData.agama,
        no_ktp: editData.no_ktp,
        tempat_lahir: editData.tempat_lahir,
        tanggal_lahir: editData.tanggal_lahir,
        alamat_ktp: editData.alamat_ktp,
        alamat_domisili: editData.alamat_domisili,
        no_telp: editData.no_telp,
        tanggal_bergabung: editData.tanggal_bergabung,
        status: editData.status,
        tanggal_mulai_pkwt: editData.tanggal_mulai_pkwt || null,
        tanggal_berakhir_pkwt: editData.tanggal_berakhir_pkwt || null,
        status_pernikahan: editData.status_pernikahan,
        nama_pasangan: editData.nama_pasangan || null,
        jumlah_anak: parseInt(editData.jumlah_anak || "0"),
        bank: editData.bank,
        no_rekening: editData.no_rekening,
        nama_rekening: editData.nama_rekening,
        no_bpjs_kesehatan: editData.no_bpjs_kesehatan || null,
        no_bpjs_ketenagakerjaan: editData.no_bpjs_ketenagakerjaan || null,
        jabatan_id: editData.jabatan_id ? parseInt(editData.jabatan_id) : null,
        ...fileUpdates,
      })
      .eq("id", selectedEmployee.id);

    setEditSaving(false);

    if (!error) {
      setIsEditing(false);
      const uploadCount = Object.keys(fileUpdates).length;
      const msg = uploadCount > 0
        ? `Data dan ${uploadCount} berkas pegawai telah diperbarui.`
        : "Perubahan data pegawai telah disimpan ke sistem.";
      showSuccessToast("Data Berhasil Diperbarui", msg);
      fetchEmployees();
      setSelectedEmployee((prev) => prev ? { ...prev, ...editData, ...fileUpdates, jumlah_anak: parseInt(editData.jumlah_anak || "0") } as Employee : null);
    }
  };

  const generateId = async () => {
    const { data: allIds } = await supabase.from("pegawai").select("id");
    const existingSet = new Set(allIds?.map((e) => e.id) || []);
    let generated: string;
    do {
      const rand = Math.floor(Math.random() * 100000);
      generated = `ID${String(rand).padStart(5, "0")}`;
    } while (existingSet.has(generated));
    setNewId(generated);
    setAddForm((prev) => ({ ...prev, id: generated }));
  };

  // ─── CSV Import handlers ───
  const csvExpectedHeaders = [
    "ID", "NAMA", "JENIS_KELAMIN", "AGAMA", "STATUS", "NO_KTP", "TEMPAT_LAHIR", "TANGGAL_LAHIR",
    "ALAMAT_KTP", "ALAMAT_DOMISILI", "NO_TELP", "TANGGAL_BERGABUNG",
    "JABATAN", "STATUS_PERNIKAHAN", "NAMA_PASANGAN", "JUMLAH_ANAK",
    "NO_BPJS_KESEHATAN", "NO_BPJS_KETENAGAKERJAAN", "NO_REKENING",
    "BANK", "NAMA_REKENING", "TANGGAL_MULAI_PKWT", "TANGGAL_BERAKHIR_PKWT",
  ];

  const csvSampleRows = [
    ["ID00001", "Budi Santoso", "Laki-laki", "Islam", "Aktif", "3201012345670001", "Jakarta", "1990-05-15", "Jl. Merdeka No. 10 RT 01/02 Kel. Menteng Kec. Menteng Jakarta Pusat", "Jl. Sudirman No. 25 Jakarta Selatan", "081234567890", "2024-01-15", "Staff", "Menikah", "Siti Aminah", "2", "0001234567890", "JKT2024001234", "1234567890", "BCA", "Budi Santoso", "2024-01-15", "2026-01-14"],
    ["ID00002", "Dewi Lestari", "Perempuan", "Kristen", "Aktif", "3201019876540002", "Bandung", "1995-11-20", "Jl. Asia Afrika No. 5 Bandung", "Jl. Dago No. 88 Bandung", "085298765432", "2025-03-01", "Supervisor", "Belum Menikah", "", "0", "", "", "9876543210", "Mandiri", "Dewi Lestari", "", ""],
  ];

  const csvTemplateContent = [
    csvExpectedHeaders.join(","),
    ...csvSampleRows.map((row) => row.map((cell) => cell.includes(",") ? `"${cell}"` : cell).join(",")),
  ].join("\n");

  const parseCsv = (text: string): string[][] => {
    // Strip BOM if present
    const clean = text.replace(/^\uFEFF/, "");
    const lines = clean.split(/\r?\n/).filter((line) => line.trim() !== "");
    return lines.map((line) => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            // Escaped quote ("") -> literal "
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if ((char === "," || char === ";") && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    });
  };

  const handleCsvFile = (file: File) => {
    setCsvFileName(file.name);
    setCsvErrors([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      setCsvData(parsed);
    };
    reader.readAsText(file);
  };

  const handleCsvDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
      handleCsvFile(file);
    }
  };

  const handleCsvInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCsvFile(file);
  };

  const handleImportConfirm = async () => {
    if (csvData.length < 2) return;
    setCsvErrors([]);
    setCsvImporting(true);

    const headers = csvData[0].map((h) => h.toUpperCase().trim());
    const rows = csvData.slice(1);

    // ── Validate headers ──
    const missingHeaders = csvExpectedHeaders.filter((h) => !headers.includes(h));
    if (missingHeaders.length > 0) {
      setCsvErrors([`Kolom tidak ditemukan: ${missingHeaders.join(", ")}`]);
      setCsvImporting(false);
      return;
    }

    // ── Build column index map ──
    const col = (name: string) => headers.indexOf(name);

    // ── Fetch jabatan lookup (nama -> id) ──
    const { data: jabatanData } = await supabase.from("jabatan").select("id, nama");
    const jabatanMap = new Map<string, number>();
    jabatanData?.forEach((j) => jabatanMap.set(j.nama.toLowerCase(), j.id));

    // ── Fetch existing employee IDs to detect duplicates ──
    const { data: existingData } = await supabase.from("pegawai").select("id");
    const existingIds = new Set(existingData?.map((e) => e.id) || []);

    // ── Valid enum values ──
    const validJk = new Set(["Laki-laki", "Perempuan"]);
    const validAgama = new Set(["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"]);
    const validStatus = new Set(["Aktif", "Tidak Aktif", "Cuti", "Training"]);
    const validPernikahan = new Set(["Belum Menikah", "Menikah", "Cerai"]);
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    // ── Validate & map each row ──
    const errors: string[] = [];
    const validRows: Record<string, unknown>[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // 1-indexed + header
      const rowErrors: string[] = [];

      const id = r[col("ID")]?.trim();
      const nama = r[col("NAMA")]?.trim();
      const jk = r[col("JENIS_KELAMIN")]?.trim();
      const agama = r[col("AGAMA")]?.trim();
      const status = r[col("STATUS")]?.trim() || "Aktif";
      const noKtp = r[col("NO_KTP")]?.trim();
      const tempatLahir = r[col("TEMPAT_LAHIR")]?.trim();
      const tglLahir = r[col("TANGGAL_LAHIR")]?.trim();
      const alamatKtp = r[col("ALAMAT_KTP")]?.trim();
      const alamatDomisili = r[col("ALAMAT_DOMISILI")]?.trim();
      const noTelp = r[col("NO_TELP")]?.trim();
      const tglBergabung = r[col("TANGGAL_BERGABUNG")]?.trim();
      const jabatanNama = r[col("JABATAN")]?.trim();
      const statusPernikahan = r[col("STATUS_PERNIKAHAN")]?.trim() || "Belum Menikah";
      const namaPasangan = r[col("NAMA_PASANGAN")]?.trim();
      const jumlahAnak = r[col("JUMLAH_ANAK")]?.trim();
      const noBpjsKes = r[col("NO_BPJS_KESEHATAN")]?.trim();
      const noBpjsKet = r[col("NO_BPJS_KETENAGAKERJAAN")]?.trim();
      const noRek = r[col("NO_REKENING")]?.trim();
      const bank = r[col("BANK")]?.trim();
      const namaRek = r[col("NAMA_REKENING")]?.trim();
      const tglMulaiPkwt = r[col("TANGGAL_MULAI_PKWT")]?.trim();
      const tglAkhirPkwt = r[col("TANGGAL_BERAKHIR_PKWT")]?.trim();

      // Required fields (hanya ID, NAMA, NO_TELP yang wajib)
      if (!id) rowErrors.push("ID kosong");
      else if (!/^ID\d{5}$/.test(id)) rowErrors.push(`ID "${id}" harus format ID + 5 digit angka (contoh: ID00001)`);
      if (id && existingIds.has(id)) rowErrors.push(`ID "${id}" sudah ada`);
      if (!nama) rowErrors.push("NAMA kosong");
      if (!noTelp) rowErrors.push("NO_TELP kosong");
      // Optional fields — validasi format jika diisi
      if (noKtp && !/^\d{16}$/.test(noKtp)) rowErrors.push(`NO_KTP "${noKtp}" harus 16 digit angka`);
      if (jk && !validJk.has(jk)) rowErrors.push(`JENIS_KELAMIN "${jk}" tidak valid`);
      if (agama && !validAgama.has(agama)) rowErrors.push(`AGAMA "${agama}" tidak valid`);
      if (!validStatus.has(status)) rowErrors.push(`STATUS "${status}" tidak valid`);
      if (tglLahir && !dateRegex.test(tglLahir)) rowErrors.push("TANGGAL_LAHIR harus format YYYY-MM-DD");
      if (tglBergabung && !dateRegex.test(tglBergabung)) rowErrors.push("TANGGAL_BERGABUNG harus format YYYY-MM-DD");
      if (statusPernikahan && !validPernikahan.has(statusPernikahan)) rowErrors.push(`STATUS_PERNIKAHAN "${statusPernikahan}" tidak valid`);
      if (tglMulaiPkwt && !dateRegex.test(tglMulaiPkwt)) rowErrors.push("TANGGAL_MULAI_PKWT harus format YYYY-MM-DD");
      if (tglAkhirPkwt && !dateRegex.test(tglAkhirPkwt)) rowErrors.push("TANGGAL_BERAKHIR_PKWT harus format YYYY-MM-DD");

      // Resolve jabatan
      let jabatanId: number | null = null;
      if (jabatanNama) {
        jabatanId = jabatanMap.get(jabatanNama.toLowerCase()) ?? null;
        if (!jabatanId) rowErrors.push(`JABATAN "${jabatanNama}" tidak ditemukan di data master`);
      }

      if (rowErrors.length > 0) {
        errors.push(`Baris ${rowNum}: ${rowErrors.join(", ")}`);
      } else {
        existingIds.add(id); // Prevent duplicate within same CSV
        validRows.push({
          id,
          nama,
          jenis_kelamin: jk || null,
          agama: agama || null,
          status,
          no_ktp: noKtp || null,
          tempat_lahir: tempatLahir || null,
          tanggal_lahir: tglLahir || null,
          alamat_ktp: alamatKtp || null,
          alamat_domisili: alamatDomisili || null,
          no_telp: noTelp,
          tanggal_bergabung: tglBergabung || null,
          jabatan_id: jabatanId,
          status_pernikahan: statusPernikahan || null,
          nama_pasangan: namaPasangan || null,
          jumlah_anak: parseInt(jumlahAnak || "0") || 0,
          no_bpjs_kesehatan: noBpjsKes || null,
          no_bpjs_ketenagakerjaan: noBpjsKet || null,
          no_rekening: noRek || null,
          bank: bank || null,
          nama_rekening: namaRek || null,
          tanggal_mulai_pkwt: tglMulaiPkwt || null,
          tanggal_berakhir_pkwt: tglAkhirPkwt || null,
        });
      }
    }

    // ── If there are validation errors, show them ──
    if (errors.length > 0) {
      setCsvErrors(errors);
      setCsvImporting(false);
      return;
    }

    // ── Batch insert to Supabase ──
    const { error } = await supabase.from("pegawai").insert(validRows);

    if (error) {
      setCsvErrors([`Gagal menyimpan ke database: ${error.message}`]);
      setCsvImporting(false);
      return;
    }

    setCsvImportedCount(validRows.length);
    setCsvImporting(false);
    setCsvImportSuccess(true);
    setTimeout(() => {
      setCsvImportSuccess(false);
      setShowImportCsv(false);
      setCsvData([]);
      setCsvFileName("");
      setCsvErrors([]);
      setCsvImportedCount(0);
      fetchEmployees();
    }, 2500);
  };

  const handleCloseImport = () => {
    setShowImportCsv(false);
    setCsvData([]);
    setCsvFileName("");
    setCsvImportSuccess(false);
    setCsvImporting(false);
    setCsvErrors([]);
    setCsvImportedCount(0);
  };

  // ─── Export handlers ───
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const getExportData = () => {
    const data = filtered.length > 0 ? filtered : employees;
    return data.map((emp) => ({
      ID: emp.id,
      NAMA: emp.nama,
      JENIS_KELAMIN: emp.jenis_kelamin,
      AGAMA: emp.agama,
      STATUS: emp.status,
      NO_KTP: emp.no_ktp,
      TEMPAT_LAHIR: emp.tempat_lahir,
      TANGGAL_LAHIR: emp.tanggal_lahir,
      ALAMAT_KTP: emp.alamat_ktp,
      ALAMAT_DOMISILI: emp.alamat_domisili,
      NO_TELP: emp.no_telp,
      TANGGAL_BERGABUNG: emp.tanggal_bergabung,
      JABATAN: emp.jabatanNama || "-",
      STATUS_PERNIKAHAN: emp.status_pernikahan,
      NAMA_PASANGAN: emp.nama_pasangan || "",
      JUMLAH_ANAK: String(emp.jumlah_anak),
      NO_BPJS_KESEHATAN: emp.no_bpjs_kesehatan || "",
      NO_BPJS_KETENAGAKERJAAN: emp.no_bpjs_ketenagakerjaan || "",
      NO_REKENING: emp.no_rekening,
      BANK: emp.bank,
      NAMA_REKENING: emp.nama_rekening,
      TANGGAL_MULAI_PKWT: emp.tanggal_mulai_pkwt || "",
      TANGGAL_BERAKHIR_PKWT: emp.tanggal_berakhir_pkwt || "",
    }));
  };

  const handleExportCsv = () => {
    setShowExportMenu(false);
    const data = getExportData();
    if (data.length === 0) return;

    const headers = csvExpectedHeaders;
    const rows = data.map((row) =>
      headers.map((h) => {
        const val = row[h as keyof typeof row] || "";
        return val.includes(",") || val.includes('"') || val.includes("\n")
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(",")
    );

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `data_pegawai_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showSuccessToast("Export Berhasil", `${data.length} data pegawai berhasil diexport ke CSV.`);
  };

  const handleExportPdf = async () => {
    setShowExportMenu(false);
    const data = getExportData();
    if (data.length === 0) return;

    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    // Title
    doc.setFontSize(16);
    doc.text("Data Pegawai", 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Diekspor pada ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} - ${data.length} pegawai`, 14, 21);

    // Table
    const pdfHeaders = ["ID", "Nama", "Jenis Kelamin", "Jabatan", "Status", "No. KTP", "No. Telp", "Bank", "No. Rekening", "Tgl Bergabung"];
    const pdfRows = data.map((row) => [
      row.ID,
      row.NAMA,
      row.JENIS_KELAMIN,
      row.JABATAN,
      row.STATUS,
      row.NO_KTP,
      row.NO_TELP,
      row.BANK,
      row.NO_REKENING,
      row.TANGGAL_BERGABUNG,
    ]);

    autoTable(doc, {
      head: [pdfHeaders],
      body: pdfRows,
      startY: 26,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold", fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 14, right: 14 },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(`Halaman ${i} dari ${pageCount}`, doc.internal.pageSize.getWidth() - 14, doc.internal.pageSize.getHeight() - 8, { align: "right" });
      doc.text("HRM System", 14, doc.internal.pageSize.getHeight() - 8);
    }

    doc.save(`data_pegawai_${new Date().toISOString().slice(0, 10)}.pdf`);
    showSuccessToast("Export Berhasil", `${data.length} data pegawai berhasil diexport ke PDF.`);
  };

  // ─── Add Employee Form State ───
  const emptyForm = {
    id: "", nama: "", jenis_kelamin: "Laki-laki", agama: "Islam", status: "Aktif",
    no_ktp: "", tempat_lahir: "", tanggal_lahir: "", alamat_ktp: "", alamat_domisili: "",
    no_telp: "", tanggal_bergabung: "", jabatan_id: "", status_pernikahan: "Belum Menikah",
    nama_pasangan: "", jumlah_anak: "0", no_bpjs_kesehatan: "", no_bpjs_ketenagakerjaan: "",
    no_rekening: "", bank: "", nama_rekening: "", tanggal_mulai_pkwt: "", tanggal_berakhir_pkwt: "",
  };
  const [addForm, setAddForm] = useState(emptyForm);
  const [addFiles, setAddFiles] = useState<Record<string, File | null>>({ foto_ktp: null, foto_diri: null, foto_sim: null, kartu_keluarga: null });
  const [addError, setAddError] = useState("");
  const [addErrors, setAddErrors] = useState<Set<string>>(new Set());
  const [addSaving, setAddSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null);
  const [editFiles, setEditFiles] = useState<Record<string, File | null>>({ foto_ktp: null, foto_diri: null, foto_sim: null, kartu_keluarga: null });
  const [compressingField, setCompressingField] = useState<string | null>(null);
  const [jabatanOptions, setJabatanOptions] = useState<{ id: number; nama: string }[]>([]);
  const [bankOptions, setBankOptions] = useState<{ id: number; nama: string }[]>([]);

  // Fetch jabatan & bank options for form dropdowns
  useEffect(() => {
    supabase.from("jabatan").select("id, nama").eq("status", "Aktif").order("nama").then(({ data }) => {
      if (data) setJabatanOptions(data);
    });
    supabase.from("banks").select("id, nama").eq("status", "Aktif").order("nama").then(({ data }) => {
      if (data) setBankOptions(data);
    });
  }, []);

  // Fields yang auto Title Case
  const titleCaseFields = new Set(["nama", "tempat_lahir", "nama_pasangan", "nama_rekening"]);

  const updateAddForm = (field: string, value: string) => {
    const formatted = titleCaseFields.has(field) ? toTitleCase(value) : value;
    setAddForm((prev) => ({ ...prev, [field]: formatted }));
    // Clear error for this field when user types
    if (addErrors.has(field)) {
      setAddErrors((prev) => { const next = new Set(prev); next.delete(field); return next; });
      if (addErrors.size <= 1) setAddError("");
    }
  };

  const handleEditFileSelect = async (field: string, file: File | null) => {
    if (!file) { setEditFiles((prev) => ({ ...prev, [field]: null })); return; }
    setCompressingField(field);
    const result = await compressFile(file);
    setCompressingField(null);
    if (!result.success) {
      showSuccessToast("File Gagal", result.error);
      return;
    }
    setEditFiles((prev) => ({ ...prev, [field]: result.file }));
  };

  const handleFileSelect = async (field: string, file: File | null) => {
    if (!file) { setAddFiles((prev) => ({ ...prev, [field]: null })); return; }
    setCompressingField(field);
    const result = await compressFile(file);
    setCompressingField(null);
    if (!result.success) {
      setAddError(result.error);
      return;
    }
    setAddError("");
    setAddFiles((prev) => ({ ...prev, [field]: result.file }));
  };

  const handleOpenPreview = (url: string, label: string) => {
    setPreviewImage({ url, label });
  };

  const handleDownloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const ext = url.split(".").pop()?.split("?")[0] || "jpg";
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

  const uploadFile = async (file: File, pegawaiId: string, docType: string): Promise<string | null> => {
    const ext = file.name.split(".").pop();
    const path = `${pegawaiId}/${docType}.${ext}`;
    const { error } = await supabase.storage.from("pegawai-docs").upload(path, file, { upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from("pegawai-docs").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleAddEmployee = async () => {
    setAddError("");
    setAddErrors(new Set());

    const requiredFields: { key: string; label: string }[] = [
      { key: "id", label: "ID Pegawai" },
      { key: "nama", label: "Nama Lengkap" },
      { key: "no_ktp", label: "No. KTP (NIK)" },
      { key: "tempat_lahir", label: "Tempat Lahir" },
      { key: "tanggal_lahir", label: "Tanggal Lahir" },
      { key: "no_telp", label: "No. Telepon" },
      { key: "tanggal_bergabung", label: "Tanggal Bergabung" },
      { key: "no_rekening", label: "No. Rekening" },
      { key: "bank", label: "Bank" },
      { key: "nama_rekening", label: "Nama Rekening" },
    ];

    const emptyFields = requiredFields.filter((f) => !addForm[f.key as keyof typeof addForm]?.toString().trim());

    if (emptyFields.length > 0) {
      setAddErrors(new Set(emptyFields.map((f) => f.key)));
      const names = emptyFields.map((f) => f.label).join(", ");
      setAddError(`Field berikut wajib diisi: ${names}`);
      return;
    }

    setAddSaving(true);

    // Upload files first
    let foto_ktp: string | null = null;
    let foto_diri: string | null = null;
    let foto_sim: string | null = null;
    let kartu_keluarga: string | null = null;

    if (addFiles.foto_ktp) foto_ktp = await uploadFile(addFiles.foto_ktp, addForm.id, "ktp");
    if (addFiles.foto_diri) foto_diri = await uploadFile(addFiles.foto_diri, addForm.id, "foto");
    if (addFiles.foto_sim) foto_sim = await uploadFile(addFiles.foto_sim, addForm.id, "sim");
    if (addFiles.kartu_keluarga) kartu_keluarga = await uploadFile(addFiles.kartu_keluarga, addForm.id, "kk");

    const { error } = await supabase.from("pegawai").insert({
      id: addForm.id,
      nama: addForm.nama,
      jenis_kelamin: addForm.jenis_kelamin,
      agama: addForm.agama,
      status: addForm.status,
      no_ktp: addForm.no_ktp,
      tempat_lahir: addForm.tempat_lahir,
      tanggal_lahir: addForm.tanggal_lahir,
      alamat_ktp: addForm.alamat_ktp || "-",
      alamat_domisili: addForm.alamat_domisili || "-",
      no_telp: addForm.no_telp,
      tanggal_bergabung: addForm.tanggal_bergabung,
      jabatan_id: addForm.jabatan_id ? parseInt(addForm.jabatan_id) : null,
      status_pernikahan: addForm.status_pernikahan,
      nama_pasangan: addForm.nama_pasangan || null,
      jumlah_anak: parseInt(addForm.jumlah_anak) || 0,
      no_bpjs_kesehatan: addForm.no_bpjs_kesehatan || null,
      no_bpjs_ketenagakerjaan: addForm.no_bpjs_ketenagakerjaan || null,
      no_rekening: addForm.no_rekening,
      bank: addForm.bank,
      nama_rekening: addForm.nama_rekening,
      tanggal_mulai_pkwt: addForm.tanggal_mulai_pkwt || null,
      tanggal_berakhir_pkwt: addForm.tanggal_berakhir_pkwt || null,
      foto_ktp,
      foto_diri,
      foto_sim,
      kartu_keluarga,
    });

    setAddSaving(false);

    if (error) {
      setAddError(`Gagal menyimpan: ${error.message}`);
      return;
    }

    setShowAddForm(false);
    setAddForm(emptyForm);
    setAddFiles({ foto_ktp: null, foto_diri: null, foto_sim: null, kartu_keluarga: null });
    showSuccessToast("Pegawai Berhasil Ditambahkan", `Data pegawai ${addForm.nama} (${addForm.id}) telah tersimpan ke sistem.`);
    fetchEmployees();
  };

  const filtered = employees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.nama.toLowerCase().includes(q) ||
      emp.id.toLowerCase().includes(q) ||
      (emp.jabatanNama || "").toLowerCase().includes(q) ||
      emp.no_telp.includes(search)
    );
  });

  // Paginate filtered data
  const paginatedEmployees = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const activeCount = employees.filter((e) => e.status === "Aktif").length;
  const cutiCount = employees.filter((e) => e.status === "Cuti").length;
  const inactiveCount = employees.filter((e) => e.status === "Tidak Aktif").length;
  const incompleteCount = employees.filter((e) => getCompleteness(e).percent < 100).length;

  return (
    <RouteGuard permission="employees">
      {/* ═══ GLOBAL SUCCESS TOAST ═══ */}
      {successToast.show && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
          <div className="flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border border-success/20 min-w-[360px] max-w-[480px]">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
              <CircleCheckBig className="w-5 h-5 text-success" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">{successToast.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{successToast.message}</p>
            </div>
            <button
              onClick={() => setSuccessToast({ show: false, title: "", message: "" })}
              className="p-1 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* Progress bar */}
          <div className="mt-1 mx-2 h-[2px] bg-border rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ animation: "shrink 4s linear forwards" }} />
          </div>
        </div>
      )}

      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Data Pegawai"
          description={`${employees.length} pegawai terdaftar`}
          icon={Users}
          actions={
            <div className="flex items-center gap-2">
              {canInput && <Button variant="outline" icon={Upload} size="sm" onClick={() => setShowImportCsv(true)}>Import CSV</Button>}
              <div ref={exportMenuRef} className="relative">
                <Button variant="outline" icon={Download} size="sm" onClick={() => setShowExportMenu(!showExportMenu)}>Export</Button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-border bg-card shadow-xl shadow-black/8 overflow-hidden z-50 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150">
                    <button onClick={handleExportCsv} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
                      <FileSpreadsheet className="w-4 h-4 text-success" />
                      <div className="text-left">
                        <p className="font-medium">Export CSV</p>
                        <p className="text-[10px] text-muted-foreground">Spreadsheet format</p>
                      </div>
                    </button>
                    <div className="border-t border-border" />
                    <button onClick={handleExportPdf} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
                      <FileText className="w-4 h-4 text-danger" />
                      <div className="text-left">
                        <p className="font-medium">Export PDF</p>
                        <p className="text-[10px] text-muted-foreground">Dokumen cetak</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={() => { setNewId(""); setAddForm(emptyForm); setAddFiles({ foto_ktp: null, foto_diri: null, foto_sim: null, kartu_keluarga: null }); setAddError(""); setAddErrors(new Set()); setShowAddForm(true); }}>Tambah Pegawai</Button>}
            </div>
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {loading ? (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-xl" />
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-14 rounded-md" />
                    <Skeleton className="h-5 w-8 rounded-md" />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Total</p>
                  <p className="text-lg font-bold text-foreground">{employees.length}</p>
                </div>
              </div>
              <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center">
                  <span className="text-sm font-bold text-success">{activeCount}</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Aktif</p>
                  <p className="text-xs text-muted-foreground">pegawai</p>
                </div>
              </div>
              <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning-light flex items-center justify-center">
                  <span className="text-sm font-bold text-warning">{cutiCount}</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Cuti</p>
                  <p className="text-xs text-muted-foreground">pegawai</p>
                </div>
              </div>
              <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                  <span className="text-sm font-bold text-muted-foreground">{inactiveCount}</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Tidak Aktif</p>
                  <p className="text-xs text-muted-foreground">pegawai</p>
                </div>
              </div>
              <div className={cn("bg-card rounded-2xl border p-4 flex items-center gap-3", incompleteCount > 0 ? "border-danger/30" : "border-border")}>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", incompleteCount > 0 ? "bg-danger/10" : "bg-success-light")}>
                  <span className={cn("text-sm font-bold", incompleteCount > 0 ? "text-danger" : "text-success")}>{incompleteCount}</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Belum Lengkap</p>
                  <p className="text-xs text-muted-foreground">pegawai</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Filters */}
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari nama, ID, jabatan, atau no. telepon..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60"
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              {["Semua", "Aktif", "Cuti", "Tidak Aktif"].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    // filter by status via search is handled differently, keep simple
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap bg-muted text-muted-foreground hover:bg-muted/80"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">ID</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Nama Pegawai</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Jabatan</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">No. Telepon</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Kelengkapan</th>
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-5 py-4"><Skeleton className="h-4 w-16 rounded-md" /></td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Skeleton className="w-9 h-9 rounded-full" />
                          <div className="space-y-1.5">
                            <Skeleton className="h-4 w-28 rounded-md" />
                            <Skeleton className="h-3 w-16 rounded-md" />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4"><Skeleton className="h-4 w-20 rounded-md" /></td>
                      <td className="px-5 py-4"><Skeleton className="h-4 w-24 rounded-md" /></td>
                      <td className="px-5 py-4"><Skeleton className="h-6 w-14 rounded-lg" /></td>
                      <td className="px-5 py-4 text-center"><Skeleton className="h-6 w-12 rounded-lg mx-auto" /></td>
                      <td className="px-5 py-4 text-center"><Skeleton className="h-6 w-14 rounded-lg mx-auto" /></td>
                    </tr>
                  ))
                ) : (
                  paginatedEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-muted/30">
                      <td className="px-5 py-4">
                        <span className="text-xs font-mono text-muted-foreground">{emp.id}</span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 flex items-center justify-center flex-shrink-0 group-hover:border-primary/40">
                            <User className="w-4 h-4 text-primary/70" />
                            <div className={cn(
                              "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card",
                              emp.status === "Aktif" ? "bg-emerald-400" : emp.status === "Cuti" ? "bg-amber-400" : "bg-slate-300"
                            )} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{emp.nama}</p>
                            <p className="text-[11px] text-muted-foreground">{emp.tempat_lahir}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-foreground">{emp.jabatanNama}</td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">{emp.no_telp}</td>
                      <td className="px-5 py-4">
                        <Badge variant={statusVariant[emp.status] || "muted"}>{emp.status}</Badge>
                      </td>
                      <td className="px-5 py-4 text-center">
                        {(() => {
                          const c = getCompleteness(emp);
                          return (
                            <div className="inline-flex items-center gap-1.5" title={c.percent === 100 ? "Data lengkap" : `${c.missing.length} data belum diisi`}>
                              <CompletenessRing percent={c.percent} />
                              <span className={cn("text-[11px] font-bold",
                                c.percent === 100 ? "text-success" : c.percent >= 70 ? "text-warning" : "text-danger"
                              )}>{c.percent}%</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={() => handleOpenDetail(emp)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light"
                        >
                          <Eye className="w-3.5 h-3.5" /> Detail
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      </div>

      {/* ═══ DETAIL PANEL (Slide-over) ═══ */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!isEditing && !editSaving) { setSelectedEmployee(null); } }} />
          <div className="relative w-full max-w-2xl bg-card shadow-2xl flex flex-col animate-slide-in-left">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative w-11 h-11 rounded-full bg-gradient-to-br from-primary/10 to-accent/10 border-2 border-primary/20 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary/70" />
                  <div className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card",
                    selectedEmployee.status === "Aktif" ? "bg-emerald-400" : selectedEmployee.status === "Cuti" ? "bg-amber-400" : "bg-slate-300"
                  )} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    {isEditing ? (editData.nama as string) || selectedEmployee.nama : selectedEmployee.nama}
                  </h2>
                  <p className="text-xs text-muted-foreground">{selectedEmployee.id} &middot; {isEditing ? (editData.jabatan as string) || selectedEmployee.jabatanNama : selectedEmployee.jabatanNama}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!isEditing ? (
                  <>
                    <Badge variant={statusVariant[selectedEmployee.status] || "muted"}>{selectedEmployee.status}</Badge>
                    {canEdit && <button onClick={handleStartEdit} className="p-2 rounded-xl hover:bg-primary-light text-primary" title="Edit Data">
                      <Pencil className="w-4 h-4" />
                    </button>}
                    <button onClick={() => setSelectedEmployee(null)} className="p-2 rounded-xl hover:bg-muted text-muted-foreground">
                      <X className="w-5 h-5" />
                    </button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={editSaving}>Batal</Button>
                    {canEdit && <Button icon={editSaving ? undefined : Save} size="sm" onClick={handleSaveEdit} disabled={editSaving}>
                      {editSaving ? (
                        <span className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Menyimpan...
                        </span>
                      ) : "Simpan"}
                    </Button>}
                  </>
                )}
              </div>
            </div>

            {/* (toast moved to global) */}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* ── Kelengkapan Data ── */}
              {!isEditing && (() => {
                const c = getCompleteness(selectedEmployee);
                if (c.percent === 100) return null;
                const grouped = c.missing.reduce<Record<string, string[]>>((acc, m) => {
                  (acc[m.group] ??= []).push(m.label);
                  return acc;
                }, {});
                return (
                  <div className={cn(
                    "rounded-2xl border p-4",
                    c.percent >= 70 ? "border-warning/20 bg-warning/[0.04]" : "border-danger/20 bg-danger/[0.04]"
                  )}>
                    <div className="flex items-center gap-3 mb-3">
                      <CompletenessRing percent={c.percent} size={36} />
                      <div>
                        <p className="text-sm font-bold text-foreground">{c.percent}% Lengkap</p>
                        <p className="text-[11px] text-muted-foreground">{c.missing.length} dari {c.total} data belum diisi</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(grouped).map(([group, fields]) => (
                        fields.map((f) => (
                          <span key={f} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-card border border-border text-[10px] text-muted-foreground">
                            <span className="w-1 h-1 rounded-full bg-danger/60 flex-shrink-0" />
                            {f}
                          </span>
                        ))
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── MODE EDIT ── */}
              {isEditing ? (
                <>
                  <Section title="Data Pribadi" icon={User}>
                    <EditField label="Nama Lengkap" value={selectedEmployee.nama} field="nama" editData={editData} setEditData={setEditData} />
                    <EditField label="No. KTP (NIK)" value={selectedEmployee.no_ktp} field="no_ktp" editData={editData} setEditData={setEditData} />
                    <EditField label="Jenis Kelamin" value={selectedEmployee.jenis_kelamin} field="jenis_kelamin" editData={editData} setEditData={setEditData} type="select" options={["Laki-laki", "Perempuan"]} />
                    <EditField label="Agama" value={selectedEmployee.agama} field="agama" editData={editData} setEditData={setEditData} type="select" options={["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"]} />
                    <EditField label="Tempat Lahir" value={selectedEmployee.tempat_lahir} field="tempat_lahir" editData={editData} setEditData={setEditData} />
                    <EditField label="Tanggal Lahir" value={selectedEmployee.tanggal_lahir} field="tanggal_lahir" editData={editData} setEditData={setEditData} type="date" />
                    <EditField label="Alamat KTP" value={selectedEmployee.alamat_ktp} field="alamat_ktp" editData={editData} setEditData={setEditData} type="textarea" full />
                    <EditField label="Alamat Domisili" value={selectedEmployee.alamat_domisili} field="alamat_domisili" editData={editData} setEditData={setEditData} type="textarea" full />
                    <EditField label="No. Telepon (WhatsApp)" value={selectedEmployee.no_telp} field="no_telp" editData={editData} setEditData={setEditData} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Kepegawaian" icon={Briefcase}>
                    <Field label="ID Pegawai" value={selectedEmployee.id} copyable />
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Jabatan</label>
                      <Select
                        value={editData.jabatan_id ?? (selectedEmployee.jabatan_id ? String(selectedEmployee.jabatan_id) : "")}
                        onChange={(val) => setEditData({ ...editData, jabatan_id: val })}
                        options={jabatanOptions.map((j) => ({ value: String(j.id), label: j.nama }))}
                        placeholder="Pilih jabatan"
                      />
                    </div>
                    <EditField label="Tanggal Bergabung" value={selectedEmployee.tanggal_bergabung} field="tanggal_bergabung" editData={editData} setEditData={setEditData} type="date" />
                    <EditField label="Status" value={selectedEmployee.status} field="status" editData={editData} setEditData={setEditData} type="select" options={["Aktif", "Cuti", "Tidak Aktif"]} />
                    <EditField label="Tanggal Mulai PKWT" value={selectedEmployee.tanggal_mulai_pkwt} field="tanggal_mulai_pkwt" editData={editData} setEditData={setEditData} type="date" />
                    <EditField label="Tanggal Berakhir PKWT" value={selectedEmployee.tanggal_berakhir_pkwt} field="tanggal_berakhir_pkwt" editData={editData} setEditData={setEditData} type="date" />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Keluarga" icon={Heart}>
                    <EditField label="Status Pernikahan" value={selectedEmployee.status_pernikahan} field="status_pernikahan" editData={editData} setEditData={setEditData} type="select" options={["Belum Menikah", "Menikah", "Cerai"]} />
                    <EditField label="Nama Pasangan" value={selectedEmployee.nama_pasangan} field="nama_pasangan" editData={editData} setEditData={setEditData} />
                    <EditField label="Jumlah Anak" value={String(selectedEmployee.jumlah_anak)} field="jumlah_anak" editData={editData} setEditData={setEditData} type="number" />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Rekening & Keuangan" icon={CreditCard}>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Bank</label>
                      <Select
                        value={editData.bank ?? selectedEmployee.bank ?? ""}
                        onChange={(val) => setEditData({ ...editData, bank: val })}
                        options={bankOptions.map((b) => ({ value: b.nama, label: b.nama }))}
                        placeholder="Pilih bank"
                      />
                    </div>
                    <EditField label="No. Rekening" value={selectedEmployee.no_rekening} field="no_rekening" editData={editData} setEditData={setEditData} />
                    <EditField label="Nama Rekening" value={selectedEmployee.nama_rekening} field="nama_rekening" editData={editData} setEditData={setEditData} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="BPJS & Jaminan Sosial" icon={Shield}>
                    <EditField label="No. BPJS Kesehatan (JKN)" value={selectedEmployee.no_bpjs_kesehatan} field="no_bpjs_kesehatan" editData={editData} setEditData={setEditData} />
                    <EditField label="No. BPJS Ketenagakerjaan (KPJ)" value={selectedEmployee.no_bpjs_ketenagakerjaan} field="no_bpjs_ketenagakerjaan" editData={editData} setEditData={setEditData} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Dokumen & Berkas" icon={FileText}>
                    <div className="sm:col-span-2">
                      <p className="text-[10px] text-muted-foreground mb-3">Pilih file baru untuk mengganti. Maks 300KB per file (JPG, PNG, PDF).</p>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { label: "Foto KTP", key: "foto_ktp", current: selectedEmployee.foto_ktp },
                          { label: "Foto Diri", key: "foto_diri", current: selectedEmployee.foto_diri },
                          { label: "Foto SIM", key: "foto_sim", current: selectedEmployee.foto_sim },
                          { label: "Kartu Keluarga", key: "kartu_keluarga", current: selectedEmployee.kartu_keluarga },
                        ] as const).map((doc) => {
                          const newFile = editFiles[doc.key];
                          const hasExisting = !!doc.current;
                          const isCompressing = compressingField === doc.key;
                          return (
                            <div key={doc.key}>
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{doc.label}</label>
                              <label className={cn(
                                "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed text-xs transition-all",
                                isCompressing
                                  ? "border-warning/40 bg-warning/5 text-warning cursor-wait pointer-events-none"
                                  : newFile
                                    ? "border-success/40 bg-success-light/20 text-success cursor-pointer"
                                    : hasExisting
                                      ? "border-primary/30 bg-primary-light/10 text-primary hover:border-primary/50 cursor-pointer"
                                      : "border-border hover:border-primary/40 hover:bg-primary-light/20 text-muted-foreground cursor-pointer"
                              )}>
                                {isCompressing ? (
                                  <>
                                    <span className="w-3.5 h-3.5 border-2 border-warning/30 border-t-warning rounded-full animate-spin" />
                                    <span>Memproses...</span>
                                  </>
                                ) : newFile ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span className="truncate max-w-[100px]">{newFile.name}</span>
                                  </>
                                ) : hasExisting ? (
                                  <>
                                    <ImageIcon className="w-3.5 h-3.5" />
                                    <span>Ganti file</span>
                                  </>
                                ) : (
                                  <>
                                    <Upload className="w-3.5 h-3.5" />
                                    <span>Upload</span>
                                  </>
                                )}
                                <input type="file" accept="image/*,.pdf" className="hidden" disabled={isCompressing} onChange={(e) => handleEditFileSelect(doc.key, e.target.files?.[0] || null)} />
                              </label>
                              {hasExisting && !newFile && !isCompressing && (
                                <p className="text-[9px] text-success mt-1">File tersedia</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Section>
                </>
              ) : (
                /* ── MODE VIEW ── */
                <>
                  <Section title="Data Pribadi" icon={User}>
                    <Field label="Nama Lengkap" value={selectedEmployee.nama} copyable />
                    <Field label="No. KTP (NIK)" value={selectedEmployee.no_ktp} copyable />
                    <Field label="Jenis Kelamin" value={selectedEmployee.jenis_kelamin} />
                    <Field label="Agama" value={selectedEmployee.agama} />
                    <Field label="Tempat Lahir" value={selectedEmployee.tempat_lahir} />
                    <Field label="Tanggal Lahir" value={selectedEmployee.tanggal_lahir ? formatShortDate(selectedEmployee.tanggal_lahir) : "-"} />
                    <Field label="Alamat KTP" value={selectedEmployee.alamat_ktp} full copyable />
                    <Field label="Alamat Domisili" value={selectedEmployee.alamat_domisili} full copyable />
                    <Field label="No. Telepon (WhatsApp)" value={selectedEmployee.no_telp} copyable />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Kepegawaian" icon={Briefcase}>
                    <Field label="ID Pegawai" value={selectedEmployee.id} copyable />
                    <Field label="Jabatan" value={selectedEmployee.jabatanNama} />
                    <Field label="Tanggal Bergabung" value={selectedEmployee.tanggal_bergabung ? formatShortDate(selectedEmployee.tanggal_bergabung) : "-"} />
                    <Field label="Status" value={<Badge variant={statusVariant[selectedEmployee.status] || "muted"}>{selectedEmployee.status}</Badge>} />
                    <Field label="Mulai PKWT" value={selectedEmployee.tanggal_mulai_pkwt ? formatShortDate(selectedEmployee.tanggal_mulai_pkwt) : "Pegawai Tetap"} />
                    <Field label="Berakhir PKWT" value={selectedEmployee.tanggal_berakhir_pkwt ? formatShortDate(selectedEmployee.tanggal_berakhir_pkwt) : "Pegawai Tetap"} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Keluarga" icon={Heart}>
                    <Field label="Status Pernikahan" value={selectedEmployee.status_pernikahan} />
                    <Field label="Nama Pasangan" value={selectedEmployee.nama_pasangan} />
                    <Field label="Jumlah Anak" value={`${selectedEmployee.jumlah_anak} orang`} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Rekening & Keuangan" icon={CreditCard}>
                    <Field label="Bank" value={selectedEmployee.bank} />
                    <Field label="No. Rekening" value={selectedEmployee.no_rekening} copyable />
                    <Field label="Nama Rekening" value={selectedEmployee.nama_rekening} copyable />
                  </Section>

                  <hr className="border-border" />

                  <Section title="BPJS & Jaminan Sosial" icon={Shield}>
                    <Field label="No. BPJS Kesehatan (JKN)" value={selectedEmployee.no_bpjs_kesehatan} copyable />
                    <Field label="No. BPJS Ketenagakerjaan (KPJ)" value={selectedEmployee.no_bpjs_ketenagakerjaan} copyable />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Dokumen & Berkas" icon={FileText}>
                    <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <DocBadge exists={!!selectedEmployee.foto_ktp} label="Foto KTP" url={selectedEmployee.foto_ktp} onPreview={handleOpenPreview} />
                      <DocBadge exists={!!selectedEmployee.foto_diri} label="Foto Diri" url={selectedEmployee.foto_diri} onPreview={handleOpenPreview} />
                      <DocBadge exists={!!selectedEmployee.foto_sim} label="Foto SIM" url={selectedEmployee.foto_sim} onPreview={handleOpenPreview} />
                      <DocBadge exists={!!selectedEmployee.kartu_keluarga} label="Kartu Keluarga" url={selectedEmployee.kartu_keluarga} onPreview={handleOpenPreview} />
                    </div>
                  </Section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ FORM TAMBAH PEGAWAI (Modal) ═══ */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
           <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-4rem)] flex flex-col animate-scale-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">Tambah Pegawai Baru</h2>
                  <p className="text-xs text-muted-foreground">Lengkapi data pegawai di bawah ini</p>
                </div>
              </div>
              <button onClick={() => setShowAddForm(false)} className="p-2 rounded-xl hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>

            {addError && (
              <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-danger-light border border-danger/20 text-danger text-sm font-medium animate-fade-in">
                <X className="w-4 h-4" />{addError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Data Pribadi */}
              <div>
                <div className="flex items-center gap-2 mb-4"><User className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Data Pribadi</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Nama Lengkap" required hasError={addErrors.has("nama")}>
                    <input type="text" placeholder="Masukkan nama lengkap" value={addForm.nama} onChange={(e) => updateAddForm("nama", e.target.value)} className={inputClass} />
                  </FormField>
                  <FormField label="No. KTP (NIK)" required hasError={addErrors.has("no_ktp")}>
                    <input type="text" placeholder="16 digit NIK" maxLength={16} value={addForm.no_ktp} onChange={(e) => updateAddForm("no_ktp", e.target.value)} className={inputClass} />
                  </FormField>
                  <FormField label="Jenis Kelamin" required>
                    <Select
                      value={addForm.jenis_kelamin}
                      onChange={(val) => updateAddForm("jenis_kelamin", val)}
                      options={[{ value: "Laki-laki", label: "Laki-laki" }, { value: "Perempuan", label: "Perempuan" }]}
                      placeholder="Pilih jenis kelamin"
                    />
                  </FormField>
                  <FormField label="Agama" required>
                    <Select
                      value={addForm.agama}
                      onChange={(val) => updateAddForm("agama", val)}
                      options={[
                        { value: "Islam", label: "Islam" }, { value: "Kristen", label: "Kristen" }, { value: "Katolik", label: "Katolik" },
                        { value: "Hindu", label: "Hindu" }, { value: "Buddha", label: "Buddha" }, { value: "Konghucu", label: "Konghucu" },
                      ]}
                      placeholder="Pilih agama"
                    />
                  </FormField>
                  <FormField label="Tempat Lahir" required hasError={addErrors.has("tempat_lahir")}>
                    <input type="text" placeholder="Kota kelahiran" value={addForm.tempat_lahir} onChange={(e) => updateAddForm("tempat_lahir", e.target.value)} className={inputClass} />
                  </FormField>
                  <FormField label="Tanggal Lahir" required hasError={addErrors.has("tanggal_lahir")}>
                    <DatePicker value={addForm.tanggal_lahir} onChange={(val) => updateAddForm("tanggal_lahir", val)} placeholder="Pilih tanggal lahir" />
                  </FormField>
                  <FormField label="Alamat KTP" full>
                    <textarea rows={2} placeholder="Alamat sesuai KTP" value={addForm.alamat_ktp} onChange={(e) => updateAddForm("alamat_ktp", e.target.value)} className={cn(inputClass, "resize-none")} />
                  </FormField>
                  <FormField label="Alamat Domisili" full>
                    <textarea rows={2} placeholder="Alamat tempat tinggal saat ini" value={addForm.alamat_domisili} onChange={(e) => updateAddForm("alamat_domisili", e.target.value)} className={cn(inputClass, "resize-none")} />
                  </FormField>
                  <FormField label="No. Telepon (WhatsApp)" required hasError={addErrors.has("no_telp")}>
                    <input type="tel" placeholder="08xx-xxxx-xxxx" value={addForm.no_telp} onChange={(e) => updateAddForm("no_telp", e.target.value)} className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* Kepegawaian */}
              <div>
                <div className="flex items-center gap-2 mb-4"><Briefcase className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Kepegawaian</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="ID Pegawai" required hasError={addErrors.has("id")}>
                    <div className="flex items-center gap-2">
                      <input type="text" placeholder="Contoh: ID57213" value={addForm.id || newId} onChange={(e) => { setNewId(e.target.value); updateAddForm("id", e.target.value); }} className={cn(inputClass, "flex-1")} />
                      <button type="button" onClick={() => { generateId(); }} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary-light text-primary text-xs font-semibold hover:bg-primary hover:text-white whitespace-nowrap">
                        <Wand2 className="w-3.5 h-3.5" />Auto
                      </button>
                    </div>
                  </FormField>
                  <FormField label="Jabatan">
                    <Select
                      value={addForm.jabatan_id}
                      onChange={(val) => updateAddForm("jabatan_id", val)}
                      options={jabatanOptions.map((j) => ({ value: String(j.id), label: j.nama }))}
                      placeholder="Pilih jabatan"
                    />
                  </FormField>
                  <FormField label="Tanggal Bergabung" required hasError={addErrors.has("tanggal_bergabung")}>
                    <DatePicker value={addForm.tanggal_bergabung} onChange={(val) => updateAddForm("tanggal_bergabung", val)} placeholder="Pilih tanggal bergabung" />
                  </FormField>
                  <FormField label="Status Pegawai" required>
                    <Select
                      value={addForm.status}
                      onChange={(val) => updateAddForm("status", val)}
                      options={[
                        { value: "Aktif", label: "Aktif" }, { value: "Cuti", label: "Cuti" }, { value: "Tidak Aktif", label: "Tidak Aktif" },
                      ]}
                      placeholder="Pilih status"
                    />
                  </FormField>
                  <FormField label="Tanggal Mulai PKWT">
                    <DatePicker value={addForm.tanggal_mulai_pkwt} onChange={(val) => updateAddForm("tanggal_mulai_pkwt", val)} placeholder="Pilih tanggal mulai" />
                  </FormField>
                  <FormField label="Tanggal Berakhir PKWT">
                    <DatePicker value={addForm.tanggal_berakhir_pkwt} onChange={(val) => updateAddForm("tanggal_berakhir_pkwt", val)} placeholder="Pilih tanggal berakhir" />
                  </FormField>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">* Kosongkan PKWT jika pegawai tetap (PKWTT)</p>
              </div>

              {/* Keluarga */}
              <div>
                <div className="flex items-center gap-2 mb-4"><Heart className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Data Keluarga</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Status Pernikahan" required>
                    <Select
                      value={addForm.status_pernikahan}
                      onChange={(val) => updateAddForm("status_pernikahan", val)}
                      options={[
                        { value: "Belum Menikah", label: "Belum Menikah" }, { value: "Menikah", label: "Menikah" }, { value: "Cerai", label: "Cerai" },
                      ]}
                      placeholder="Pilih status pernikahan"
                    />
                  </FormField>
                  <FormField label="Nama Pasangan">
                    <input type="text" placeholder="Nama suami/istri" value={addForm.nama_pasangan} onChange={(e) => updateAddForm("nama_pasangan", e.target.value)} className={inputClass} />
                  </FormField>
                  <FormField label="Jumlah Anak">
                    <input type="number" min={0} value={addForm.jumlah_anak} onChange={(e) => updateAddForm("jumlah_anak", e.target.value)} className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* Rekening */}
              <div>
                <div className="flex items-center gap-2 mb-4"><CreditCard className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Rekening & Keuangan</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Bank" required hasError={addErrors.has("bank")}>
                    <Select
                      value={addForm.bank}
                      onChange={(val) => updateAddForm("bank", val)}
                      options={bankOptions.map((b) => ({ value: b.nama, label: b.nama }))}
                      placeholder="Pilih bank"
                      hasError={addErrors.has("bank")}
                    />
                  </FormField>
                  <FormField label="No. Rekening" required hasError={addErrors.has("no_rekening")}>
                    <input type="text" placeholder="Nomor rekening" value={addForm.no_rekening} onChange={(e) => updateAddForm("no_rekening", e.target.value)} className={inputClass} />
                  </FormField>
                  <FormField label="Nama Rekening" required hasError={addErrors.has("nama_rekening")}>
                    <input type="text" placeholder="Nama pemilik rekening" value={addForm.nama_rekening} onChange={(e) => updateAddForm("nama_rekening", e.target.value)} className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* BPJS */}
              <div>
                <div className="flex items-center gap-2 mb-4"><Shield className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">BPJS & Jaminan Sosial</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="No. BPJS Kesehatan (JKN)">
                    <input type="text" placeholder="13 digit nomor JKN" value={addForm.no_bpjs_kesehatan} onChange={(e) => updateAddForm("no_bpjs_kesehatan", e.target.value)} className={inputClass} />
                  </FormField>
                  <FormField label="No. BPJS Ketenagakerjaan (KPJ)">
                    <input type="text" placeholder="Nomor KPJ" value={addForm.no_bpjs_ketenagakerjaan} onChange={(e) => updateAddForm("no_bpjs_ketenagakerjaan", e.target.value)} className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* Dokumen Upload */}
              <div>
                <div className="flex items-center gap-2 mb-1"><FileText className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Dokumen & Berkas</h3></div>
                <p className="text-[10px] text-muted-foreground mb-4">Format: JPG, PNG, PDF. Maksimal 300KB per file.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {([
                    { label: "Foto KTP", key: "foto_ktp" },
                    { label: "Foto Diri", key: "foto_diri" },
                    { label: "Foto SIM", key: "foto_sim" },
                    { label: "Kartu Keluarga", key: "kartu_keluarga" },
                  ] as const).map((doc) => {
                    const isCompressing = compressingField === doc.key;
                    return (
                      <FormField key={doc.key} label={doc.label}>
                        <label className={cn(
                          "flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed text-sm transition-all",
                          isCompressing
                            ? "border-warning/40 bg-warning/5 text-warning cursor-wait pointer-events-none"
                            : addFiles[doc.key]
                              ? "border-success/40 bg-success-light/20 text-success cursor-pointer"
                              : "border-border hover:border-primary/40 hover:bg-primary-light/20 text-muted-foreground cursor-pointer"
                        )}>
                          {isCompressing ? (
                            <>
                              <span className="w-4 h-4 border-2 border-warning/30 border-t-warning rounded-full animate-spin" />
                              <span>Memproses...</span>
                            </>
                          ) : addFiles[doc.key] ? (
                            <>
                              <Check className="w-4 h-4" />
                              <span className="truncate max-w-[150px]">{addFiles[doc.key]!.name}</span>
                            </>
                          ) : (
                            <>
                              <ImageIcon className="w-4 h-4" />
                              <span>Pilih file</span>
                            </>
                          )}
                          <input type="file" accept="image/*,.pdf" className="hidden" disabled={isCompressing} onChange={(e) => handleFileSelect(doc.key, e.target.files?.[0] || null)} />
                        </label>
                      </FormField>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" onClick={() => setShowAddForm(false)} disabled={addSaving}>Batal</Button>
              <Button icon={addSaving ? undefined : Plus} onClick={handleAddEmployee} disabled={addSaving}>
                {addSaving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Menyimpan...
                  </span>
                ) : "Simpan Pegawai"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ IMPORT CSV MODAL ═══ */}
      {showImportCsv && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCloseImport} />
          <div className="relative w-full max-w-4xl bg-card rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-4rem)] flex flex-col animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">Import Data Pegawai (CSV)</h2>
                  <p className="text-xs text-muted-foreground">Upload file CSV untuk menambah data pegawai secara batch</p>
                </div>
              </div>
              <button onClick={handleCloseImport} className="p-2 rounded-xl hover:bg-muted text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Success Message */}
              {csvImportSuccess && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success-light border border-success/20 text-success text-sm font-medium animate-fade-in">
                  <Check className="w-4 h-4" />
                  {csvImportedCount} data pegawai berhasil diimport!
                </div>
              )}

              {/* Error Messages */}
              {csvErrors.length > 0 && (
                <div className="rounded-xl border border-danger/20 bg-danger-light/50 overflow-hidden animate-fade-in">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-danger/10">
                    <X className="w-4 h-4 text-danger" />
                    <p className="text-sm font-semibold text-danger">Ditemukan {csvErrors.length} error</p>
                  </div>
                  <div className="max-h-40 overflow-y-auto px-4 py-2 space-y-1">
                    {csvErrors.map((err, i) => (
                      <p key={i} className="text-xs text-danger/80">{err}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload Area */}
              {csvData.length === 0 && !csvImportSuccess && (
                <>
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleCsvDrop}
                    className="border-2 border-dashed border-border rounded-2xl p-10 text-center hover:border-primary/40 hover:bg-primary-light/10 cursor-pointer"
                  >
                    <label className="cursor-pointer flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-primary-light flex items-center justify-center">
                        <Upload className="w-7 h-7 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Drag & drop file CSV di sini
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          atau <span className="text-primary font-medium">klik untuk pilih file</span>
                        </p>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Format: .csv (maks. 10MB)</p>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleCsvInputChange}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* Download Template */}
                  <div className="flex items-center justify-center">
                    <a
                      href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvTemplateContent)}`}
                      download="template_data_pegawai.csv"
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-border hover:bg-muted hover:border-primary/30 text-sm font-medium text-foreground"
                    >
                      <Download className="w-4 h-4 text-primary" />
                      Download Template CSV
                    </a>
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center">
                    * Foto/gambar (KTP, Diri, SIM, KK) tidak termasuk CSV, diupload terpisah per pegawai.
                  </p>
                </>
              )}

              {/* Preview Data */}
              {csvData.length > 0 && !csvImportSuccess && (
                <>
                  {/* File info */}
                  <div className="flex items-center justify-between bg-muted/50 rounded-xl px-4 py-3 border border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-success-light flex items-center justify-center">
                        <FileSpreadsheet className="w-4 h-4 text-success" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{csvFileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {csvData.length - 1} baris data &middot; {csvData[0]?.length || 0} kolom
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setCsvData([]); setCsvFileName(""); }}
                      className="text-xs font-medium text-danger hover:underline"
                    >
                      Hapus file
                    </button>
                  </div>

                  {/* Data Preview Table */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Table className="w-4 h-4 text-primary" />
                      <h4 className="text-sm font-semibold text-foreground">Preview Data</h4>
                      <span className="text-xs text-muted-foreground">(menampilkan 5 baris pertama)</span>
                    </div>
                    <div className="border border-border rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/50 border-b border-border">
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">#</th>
                              {csvData[0]?.map((header, i) => (
                                <th key={i} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {csvData.slice(1, 6).map((row, rowIdx) => (
                              <tr key={rowIdx} className="hover:bg-muted/30">
                                <td className="px-3 py-2 text-muted-foreground">{rowIdx + 1}</td>
                                {row.map((cell, cellIdx) => (
                                  <td key={cellIdx} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] truncate">
                                    {cell || <span className="text-muted-foreground italic">-</span>}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {csvData.length - 1 > 5 && (
                      <p className="text-[10px] text-muted-foreground mt-2 text-center">
                        ... dan {csvData.length - 6} baris lainnya
                      </p>
                    )}
                  </div>

                  {/* Validation Summary */}
                  {csvErrors.length === 0 && (
                    <div className="bg-success-light/50 border border-success/20 rounded-xl px-4 py-3 flex items-center gap-3">
                      <Check className="w-5 h-5 text-success flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">File siap diimport</p>
                        <p className="text-xs text-muted-foreground">
                          {csvData.length - 1} data pegawai akan ditambahkan ke sistem.
                          Kolom JABATAN akan dicocokkan otomatis dengan data master.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
              <p className="text-[10px] text-muted-foreground">
                * Foto & dokumen gambar diupload terpisah setelah data diimport
              </p>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={handleCloseImport}>Batal</Button>
                {csvData.length > 0 && !csvImportSuccess && (
                  <Button icon={Upload} onClick={handleImportConfirm} disabled={csvImporting}>
                    {csvImporting ? "Mengimport..." : `Import ${csvData.length - 1} Pegawai`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ IMAGE PREVIEW LIGHTBOX ═══ */}
      {previewImage && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setPreviewImage(null)} />
          <div className="relative bg-card rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full max-h-[85vh] flex flex-col animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">{previewImage.label}</h3>
                  <p className="text-[10px] text-muted-foreground">{selectedEmployee?.nama || "Pegawai"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={previewImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka
                </a>
                <button
                  onClick={() => handleDownloadFile(previewImage.url, `${previewImage.label} - ${selectedEmployee?.nama || "pegawai"}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary bg-primary-light hover:bg-primary hover:text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button onClick={() => setPreviewImage(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Image */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/20 min-h-[300px]">
              {previewImage.url.endsWith(".pdf") ? (
                <div className="text-center space-y-3">
                  <FileText className="w-16 h-16 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground">File PDF tidak bisa di-preview</p>
                  <button
                    onClick={() => handleDownloadFile(previewImage.url, `${previewImage.label} - ${selectedEmployee?.nama || "pegawai"}.pdf`)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90"
                  >
                    <Download className="w-4 h-4" />
                    Download PDF
                  </button>
                </div>
              ) : (
                <img
                  src={previewImage.url}
                  alt={previewImage.label}
                  className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </RouteGuard>
  );
}
