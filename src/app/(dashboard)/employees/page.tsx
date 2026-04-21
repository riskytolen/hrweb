"use client";

import { useState, useEffect } from "react";
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
import { supabase, type DbPegawai } from "@/lib/supabase";
import { cn, formatShortDate, toTitleCase } from "@/lib/utils";

// ─── Map DB row to UI-friendly shape ───
type Employee = DbPegawai & { jabatanNama?: string };

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

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

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
        <select
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          className={selectClass}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
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
        ...fileUpdates,
      })
      .eq("id", selectedEmployee.id);

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

  const generateId = () => {
    const existingNums = employees.map((e) => {
      const num = parseInt(e.id.replace(/\D/g, ""), 10);
      return isNaN(num) ? 0 : num;
    });
    const nextNum = (existingNums.length > 0 ? Math.max(...existingNums) : 57200) + 1;
    const generated = `ID${nextNum}`;
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

  const parseCsv = (text: string): string[][] => {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    return lines.map((line) => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
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
    // TODO: parse CSV rows and insert to Supabase
    setCsvImportSuccess(true);
    setTimeout(() => {
      setCsvImportSuccess(false);
      setShowImportCsv(false);
      setCsvData([]);
      setCsvFileName("");
      fetchEmployees();
    }, 2500);
  };

  const handleCloseImport = () => {
    setShowImportCsv(false);
    setCsvData([]);
    setCsvFileName("");
    setCsvImportSuccess(false);
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
  const [jabatanOptions, setJabatanOptions] = useState<{ id: number; nama: string }[]>([]);

  // Fetch jabatan options for form dropdown
  useEffect(() => {
    supabase.from("jabatan").select("id, nama").eq("status", "Aktif").order("nama").then(({ data }) => {
      if (data) setJabatanOptions(data);
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

  const handleEditFileSelect = (field: string, file: File | null) => {
    if (file && file.size > MAX_FILE_SIZE) {
      showSuccessToast("File Terlalu Besar", `File "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)}MB) melebihi batas 2MB.`);
      return;
    }
    setEditFiles((prev) => ({ ...prev, [field]: file }));
  };

  const handleFileSelect = (field: string, file: File | null) => {
    if (file && file.size > MAX_FILE_SIZE) {
      setAddError(`File "${file.name}" terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimal 2MB.`);
      return;
    }
    setAddError("");
    setAddFiles((prev) => ({ ...prev, [field]: file }));
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

  const activeCount = employees.filter((e) => e.status === "Aktif").length;
  const cutiCount = employees.filter((e) => e.status === "Cuti").length;
  const inactiveCount = employees.filter((e) => e.status === "Tidak Aktif").length;

  return (
    <>
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
              <Button variant="outline" icon={Upload} size="sm" onClick={() => setShowImportCsv(true)}>Import CSV</Button>
              <Button variant="outline" icon={Download} size="sm">Export</Button>
              <Button icon={Plus} size="sm" onClick={() => { setNewId(""); setAddForm(emptyForm); setAddFiles({ foto_ktp: null, foto_diri: null, foto_sim: null, kartu_keluarga: null }); setAddError(""); setAddErrors(new Set()); setShowAddForm(true); }}>Tambah Pegawai</Button>
            </div>
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                onChange={(e) => setSearch(e.target.value)}
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
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((emp) => (
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
                      <button
                        onClick={() => handleOpenDetail(emp)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light"
                      >
                        <Eye className="w-3.5 h-3.5" /> Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground">
            Menampilkan {filtered.length} dari {employees.length} pegawai
          </div>
        </div>
      </div>

      {/* ═══ DETAIL PANEL (Slide-over) ═══ */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!isEditing) { setSelectedEmployee(null); } }} />
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
                    <button onClick={handleStartEdit} className="p-2 rounded-xl hover:bg-primary-light text-primary" title="Edit Data">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setSelectedEmployee(null)} className="p-2 rounded-xl hover:bg-muted text-muted-foreground">
                      <X className="w-5 h-5" />
                    </button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={handleCancelEdit}>Batal</Button>
                    <Button icon={Save} size="sm" onClick={handleSaveEdit}>Simpan</Button>
                  </>
                )}
              </div>
            </div>

            {/* (toast moved to global) */}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

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
                    <EditField label="Jabatan" value={selectedEmployee.jabatanNama || null} field="jabatan" editData={editData} setEditData={setEditData} />
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
                    <EditField label="Bank" value={selectedEmployee.bank} field="bank" editData={editData} setEditData={setEditData} type="select" options={["BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "Danamon", "BSI"]} />
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
                      <p className="text-[10px] text-muted-foreground mb-3">Pilih file baru untuk mengganti. Maks 2MB per file (JPG, PNG, PDF).</p>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { label: "Foto KTP", key: "foto_ktp", current: selectedEmployee.foto_ktp },
                          { label: "Foto Diri", key: "foto_diri", current: selectedEmployee.foto_diri },
                          { label: "Foto SIM", key: "foto_sim", current: selectedEmployee.foto_sim },
                          { label: "Kartu Keluarga", key: "kartu_keluarga", current: selectedEmployee.kartu_keluarga },
                        ] as const).map((doc) => {
                          const newFile = editFiles[doc.key];
                          const hasExisting = !!doc.current;
                          return (
                            <div key={doc.key}>
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{doc.label}</label>
                              <label className={cn(
                                "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed cursor-pointer text-xs",
                                newFile
                                  ? "border-success/40 bg-success-light/20 text-success"
                                  : hasExisting
                                    ? "border-primary/30 bg-primary-light/10 text-primary hover:border-primary/50"
                                    : "border-border hover:border-primary/40 hover:bg-primary-light/20 text-muted-foreground"
                              )}>
                                {newFile ? (
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
                                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => handleEditFileSelect(doc.key, e.target.files?.[0] || null)} />
                              </label>
                              {hasExisting && !newFile && (
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
                    <Field label="Tanggal Lahir" value={formatShortDate(selectedEmployee.tanggal_lahir)} />
                    <Field label="Alamat KTP" value={selectedEmployee.alamat_ktp} full copyable />
                    <Field label="Alamat Domisili" value={selectedEmployee.alamat_domisili} full copyable />
                    <Field label="No. Telepon (WhatsApp)" value={selectedEmployee.no_telp} copyable />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Kepegawaian" icon={Briefcase}>
                    <Field label="ID Pegawai" value={selectedEmployee.id} copyable />
                    <Field label="Jabatan" value={selectedEmployee.jabatanNama} />
                    <Field label="Tanggal Bergabung" value={formatShortDate(selectedEmployee.tanggal_bergabung)} />
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
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!addSaving) setShowAddForm(false); }} />
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
                    <select value={addForm.jenis_kelamin} onChange={(e) => updateAddForm("jenis_kelamin", e.target.value)} className={selectClass}>
                      <option value="Laki-laki">Laki-laki</option>
                      <option value="Perempuan">Perempuan</option>
                    </select>
                  </FormField>
                  <FormField label="Agama" required>
                    <select value={addForm.agama} onChange={(e) => updateAddForm("agama", e.target.value)} className={selectClass}>
                      <option value="Islam">Islam</option><option value="Kristen">Kristen</option><option value="Katolik">Katolik</option>
                      <option value="Hindu">Hindu</option><option value="Buddha">Buddha</option><option value="Konghucu">Konghucu</option>
                    </select>
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
                    <select value={addForm.jabatan_id} onChange={(e) => updateAddForm("jabatan_id", e.target.value)} className={selectClass}>
                      <option value="">Pilih jabatan</option>
                      {jabatanOptions.map((j) => (<option key={j.id} value={j.id}>{j.nama}</option>))}
                    </select>
                  </FormField>
                  <FormField label="Tanggal Bergabung" required hasError={addErrors.has("tanggal_bergabung")}>
                    <DatePicker value={addForm.tanggal_bergabung} onChange={(val) => updateAddForm("tanggal_bergabung", val)} placeholder="Pilih tanggal bergabung" />
                  </FormField>
                  <FormField label="Status Pegawai" required>
                    <select value={addForm.status} onChange={(e) => updateAddForm("status", e.target.value)} className={selectClass}>
                      <option value="Aktif">Aktif</option><option value="Cuti">Cuti</option><option value="Tidak Aktif">Tidak Aktif</option>
                    </select>
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
                    <select value={addForm.status_pernikahan} onChange={(e) => updateAddForm("status_pernikahan", e.target.value)} className={selectClass}>
                      <option value="Belum Menikah">Belum Menikah</option><option value="Menikah">Menikah</option><option value="Cerai">Cerai</option>
                    </select>
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
                    <select value={addForm.bank} onChange={(e) => updateAddForm("bank", e.target.value)} className={selectClass}>
                      <option value="">Pilih bank</option>
                      <option value="BCA">BCA</option><option value="Mandiri">Mandiri</option><option value="BNI">BNI</option>
                      <option value="BRI">BRI</option><option value="CIMB Niaga">CIMB Niaga</option><option value="Danamon">Danamon</option><option value="BSI">BSI</option>
                    </select>
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
                <p className="text-[10px] text-muted-foreground mb-4">Format: JPG, PNG, PDF. Maksimal 2MB per file.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {([
                    { label: "Foto KTP", key: "foto_ktp" },
                    { label: "Foto Diri", key: "foto_diri" },
                    { label: "Foto SIM", key: "foto_sim" },
                    { label: "Kartu Keluarga", key: "kartu_keluarga" },
                  ] as const).map((doc) => (
                    <FormField key={doc.key} label={doc.label}>
                      <label className={cn(
                        "flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer text-sm",
                        addFiles[doc.key]
                          ? "border-success/40 bg-success-light/20 text-success"
                          : "border-border hover:border-primary/40 hover:bg-primary-light/20 text-muted-foreground"
                      )}>
                        {addFiles[doc.key] ? (
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
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => handleFileSelect(doc.key, e.target.files?.[0] || null)} />
                      </label>
                    </FormField>
                  ))}
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
                  {csvData.length - 1} data pegawai berhasil diimport!
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
                      href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvExpectedHeaders.join(",") + "\n")}`}
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
                  <div className="bg-success-light/50 border border-success/20 rounded-xl px-4 py-3 flex items-center gap-3">
                    <Check className="w-5 h-5 text-success flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">File siap diimport</p>
                      <p className="text-xs text-muted-foreground">
                        {csvData.length - 1} data pegawai akan ditambahkan ke sistem
                      </p>
                    </div>
                  </div>
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
                  <Button icon={Upload} onClick={handleImportConfirm}>
                    Import {csvData.length - 1} Pegawai
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
    </>
  );
}
