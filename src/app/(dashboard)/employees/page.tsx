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
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { employees, type Employee } from "@/lib/mock-data";
import { cn, formatShortDate } from "@/lib/utils";

// ─── Status helpers ───
const statusVariant: Record<string, "success" | "warning" | "muted"> = {
  Aktif: "success",
  Cuti: "warning",
  "Tidak Aktif": "muted",
};

// ─── Unique jabatan list for filter ───
const jabatanList = ["Semua", ...Array.from(new Set(employees.map((e) => e.jabatan)))];

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

function DocBadge({ exists, label }: { exists: boolean; label: string }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium",
      exists ? "bg-success-light/50 border-success/20 text-success" : "bg-muted border-border text-muted-foreground"
    )}>
      <ImageIcon className="w-3.5 h-3.5" />
      <span>{label}</span>
      <span className="ml-auto text-[10px]">{exists ? "Ada" : "Belum"}</span>
    </div>
  );
}

// ─── Form Field Component ───
function FormField({ label, required, children, full }: { label: string; required?: boolean; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="text-xs font-semibold text-foreground mb-1.5 block">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const selectClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none text-foreground";

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
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      {type === "textarea" ? (
        <textarea
          value={currentValue}
          onChange={(e) => setEditData({ ...editData, [field]: e.target.value })}
          rows={2}
          className={cn(inputClass, "resize-none")}
        />
      ) : type === "select" && options ? (
        <select
          value={currentValue}
          onChange={(e) => setEditData({ ...editData, [field]: e.target.value })}
          className={selectClass}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={currentValue}
          onChange={(e) => setEditData({ ...editData, [field]: e.target.value })}
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
  const [search, setSearch] = useState("");
  const [selectedJabatan, setSelectedJabatan] = useState("Semua");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, string | null>>({});
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [newId, setNewId] = useState("");
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvImportSuccess, setCsvImportSuccess] = useState(false);

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
      jenisKelamin: selectedEmployee.jenisKelamin,
      agama: selectedEmployee.agama,
      noKtp: selectedEmployee.noKtp,
      tempatLahir: selectedEmployee.tempatLahir,
      tanggalLahir: selectedEmployee.tanggalLahir,
      alamatKtp: selectedEmployee.alamatKtp,
      alamatDomisili: selectedEmployee.alamatDomisili,
      noTelp: selectedEmployee.noTelp,
      jabatan: selectedEmployee.jabatan,
      tanggalBergabung: selectedEmployee.tanggalBergabung,
      status: selectedEmployee.status,
      tanggalMulaiPkwt: selectedEmployee.tanggalMulaiPkwt,
      tanggalBerakhirPkwt: selectedEmployee.tanggalBerakhirPkwt,
      statusPernikahan: selectedEmployee.statusPernikahan,
      namaPasangan: selectedEmployee.namaPasangan,
      jumlahAnak: String(selectedEmployee.jumlahAnak),
      bank: selectedEmployee.bank,
      noRekening: selectedEmployee.noRekening,
      namaRekening: selectedEmployee.namaRekening,
      noBpjsKesehatan: selectedEmployee.noBpjsKesehatan,
      noBpjsKetenagakerjaan: selectedEmployee.noBpjsKetenagakerjaan,
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({});
  };

  const handleSaveEdit = () => {
    // In production: API call to save data
    setIsEditing(false);
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2500);
  };

  const generateId = () => {
    const existingNums = employees.map((e) => {
      const num = parseInt(e.id.replace(/\D/g, ""), 10);
      return isNaN(num) ? 0 : num;
    });
    const nextNum = Math.max(...existingNums) + 1;
    setNewId(`ID${nextNum}`);
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

  const handleImportConfirm = () => {
    // In production: send csvData to API
    setCsvImportSuccess(true);
    setTimeout(() => {
      setCsvImportSuccess(false);
      setShowImportCsv(false);
      setCsvData([]);
      setCsvFileName("");
    }, 2500);
  };

  const handleCloseImport = () => {
    setShowImportCsv(false);
    setCsvData([]);
    setCsvFileName("");
    setCsvImportSuccess(false);
  };

  const filtered = employees.filter((emp) => {
    const q = search.toLowerCase();
    const matchSearch =
      emp.nama.toLowerCase().includes(q) ||
      emp.id.toLowerCase().includes(q) ||
      emp.jabatan.toLowerCase().includes(q) ||
      emp.noTelp.includes(search);
    const matchJabatan = selectedJabatan === "Semua" || emp.jabatan === selectedJabatan;
    return matchSearch && matchJabatan;
  });

  const activeCount = employees.filter((e) => e.status === "Aktif").length;
  const cutiCount = employees.filter((e) => e.status === "Cuti").length;
  const inactiveCount = employees.filter((e) => e.status === "Tidak Aktif").length;

  return (
    <>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Data Pegawai"
          description={`${employees.length} pegawai terdaftar`}
          icon={Users}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" icon={Upload} size="sm" onClick={() => setShowImportCsv(true)}>Import CSV</Button>
              <Button variant="outline" icon={Download} size="sm">Export</Button>
              <Button icon={Plus} size="sm" onClick={() => { setNewId(""); setShowAddForm(true); }}>Tambah Pegawai</Button>
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
                          <p className="text-[11px] text-muted-foreground">{emp.tempatLahir}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-foreground">{emp.jabatan}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{emp.noTelp}</td>
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
                  <p className="text-xs text-muted-foreground">{selectedEmployee.id} &middot; {isEditing ? (editData.jabatan as string) || selectedEmployee.jabatan : selectedEmployee.jabatan}</p>
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

            {/* Save success toast */}
            {showSaveSuccess && (
              <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-success-light border border-success/20 text-success text-sm font-medium animate-fade-in">
                <Check className="w-4 h-4" />
                Data pegawai berhasil disimpan
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* ── MODE EDIT ── */}
              {isEditing ? (
                <>
                  <Section title="Data Pribadi" icon={User}>
                    <EditField label="Nama Lengkap" value={selectedEmployee.nama} field="nama" editData={editData} setEditData={setEditData} />
                    <EditField label="No. KTP (NIK)" value={selectedEmployee.noKtp} field="noKtp" editData={editData} setEditData={setEditData} />
                    <EditField label="Jenis Kelamin" value={selectedEmployee.jenisKelamin} field="jenisKelamin" editData={editData} setEditData={setEditData} type="select" options={["Laki-laki", "Perempuan"]} />
                    <EditField label="Agama" value={selectedEmployee.agama} field="agama" editData={editData} setEditData={setEditData} type="select" options={["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"]} />
                    <EditField label="Tempat Lahir" value={selectedEmployee.tempatLahir} field="tempatLahir" editData={editData} setEditData={setEditData} />
                    <EditField label="Tanggal Lahir" value={selectedEmployee.tanggalLahir} field="tanggalLahir" editData={editData} setEditData={setEditData} type="date" />
                    <EditField label="Alamat KTP" value={selectedEmployee.alamatKtp} field="alamatKtp" editData={editData} setEditData={setEditData} type="textarea" full />
                    <EditField label="Alamat Domisili" value={selectedEmployee.alamatDomisili} field="alamatDomisili" editData={editData} setEditData={setEditData} type="textarea" full />
                    <EditField label="No. Telepon (WhatsApp)" value={selectedEmployee.noTelp} field="noTelp" editData={editData} setEditData={setEditData} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Kepegawaian" icon={Briefcase}>
                    <Field label="ID Pegawai" value={selectedEmployee.id} copyable />
                    <EditField label="Jabatan" value={selectedEmployee.jabatan} field="jabatan" editData={editData} setEditData={setEditData} />
                    <EditField label="Tanggal Bergabung" value={selectedEmployee.tanggalBergabung} field="tanggalBergabung" editData={editData} setEditData={setEditData} type="date" />
                    <EditField label="Status" value={selectedEmployee.status} field="status" editData={editData} setEditData={setEditData} type="select" options={["Aktif", "Cuti", "Tidak Aktif"]} />
                    <EditField label="Tanggal Mulai PKWT" value={selectedEmployee.tanggalMulaiPkwt} field="tanggalMulaiPkwt" editData={editData} setEditData={setEditData} type="date" />
                    <EditField label="Tanggal Berakhir PKWT" value={selectedEmployee.tanggalBerakhirPkwt} field="tanggalBerakhirPkwt" editData={editData} setEditData={setEditData} type="date" />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Keluarga" icon={Heart}>
                    <EditField label="Status Pernikahan" value={selectedEmployee.statusPernikahan} field="statusPernikahan" editData={editData} setEditData={setEditData} type="select" options={["Belum Menikah", "Menikah", "Cerai"]} />
                    <EditField label="Nama Pasangan" value={selectedEmployee.namaPasangan} field="namaPasangan" editData={editData} setEditData={setEditData} />
                    <EditField label="Jumlah Anak" value={String(selectedEmployee.jumlahAnak)} field="jumlahAnak" editData={editData} setEditData={setEditData} type="number" />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Rekening & Keuangan" icon={CreditCard}>
                    <EditField label="Bank" value={selectedEmployee.bank} field="bank" editData={editData} setEditData={setEditData} type="select" options={["BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "Danamon", "BSI"]} />
                    <EditField label="No. Rekening" value={selectedEmployee.noRekening} field="noRekening" editData={editData} setEditData={setEditData} />
                    <EditField label="Nama Rekening" value={selectedEmployee.namaRekening} field="namaRekening" editData={editData} setEditData={setEditData} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="BPJS & Jaminan Sosial" icon={Shield}>
                    <EditField label="No. BPJS Kesehatan (JKN)" value={selectedEmployee.noBpjsKesehatan} field="noBpjsKesehatan" editData={editData} setEditData={setEditData} />
                    <EditField label="No. BPJS Ketenagakerjaan (KPJ)" value={selectedEmployee.noBpjsKetenagakerjaan} field="noBpjsKetenagakerjaan" editData={editData} setEditData={setEditData} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Dokumen & Berkas" icon={FileText}>
                    <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                      {["Foto KTP", "Foto Diri", "Foto SIM", "Kartu Keluarga"].map((doc) => (
                        <div key={doc}>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{doc}</label>
                          <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary-light/20 cursor-pointer text-sm text-muted-foreground">
                            <ImageIcon className="w-4 h-4" />
                            <span>Ganti file</span>
                            <input type="file" accept="image/*,.pdf" className="hidden" />
                          </label>
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              ) : (
                /* ── MODE VIEW ── */
                <>
                  <Section title="Data Pribadi" icon={User}>
                    <Field label="Nama Lengkap" value={selectedEmployee.nama} copyable />
                    <Field label="No. KTP (NIK)" value={selectedEmployee.noKtp} copyable />
                    <Field label="Jenis Kelamin" value={selectedEmployee.jenisKelamin} />
                    <Field label="Agama" value={selectedEmployee.agama} />
                    <Field label="Tempat Lahir" value={selectedEmployee.tempatLahir} />
                    <Field label="Tanggal Lahir" value={formatShortDate(selectedEmployee.tanggalLahir)} />
                    <Field label="Alamat KTP" value={selectedEmployee.alamatKtp} full copyable />
                    <Field label="Alamat Domisili" value={selectedEmployee.alamatDomisili} full copyable />
                    <Field label="No. Telepon (WhatsApp)" value={selectedEmployee.noTelp} copyable />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Kepegawaian" icon={Briefcase}>
                    <Field label="ID Pegawai" value={selectedEmployee.id} copyable />
                    <Field label="Jabatan" value={selectedEmployee.jabatan} />
                    <Field label="Tanggal Bergabung" value={formatShortDate(selectedEmployee.tanggalBergabung)} />
                    <Field label="Status" value={<Badge variant={statusVariant[selectedEmployee.status] || "muted"}>{selectedEmployee.status}</Badge>} />
                    <Field label="Mulai PKWT" value={selectedEmployee.tanggalMulaiPkwt ? formatShortDate(selectedEmployee.tanggalMulaiPkwt) : "Pegawai Tetap"} />
                    <Field label="Berakhir PKWT" value={selectedEmployee.tanggalBerakhirPkwt ? formatShortDate(selectedEmployee.tanggalBerakhirPkwt) : "Pegawai Tetap"} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Keluarga" icon={Heart}>
                    <Field label="Status Pernikahan" value={selectedEmployee.statusPernikahan} />
                    <Field label="Nama Pasangan" value={selectedEmployee.namaPasangan} />
                    <Field label="Jumlah Anak" value={`${selectedEmployee.jumlahAnak} orang`} />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Rekening & Keuangan" icon={CreditCard}>
                    <Field label="Bank" value={selectedEmployee.bank} />
                    <Field label="No. Rekening" value={selectedEmployee.noRekening} copyable />
                    <Field label="Nama Rekening" value={selectedEmployee.namaRekening} copyable />
                  </Section>

                  <hr className="border-border" />

                  <Section title="BPJS & Jaminan Sosial" icon={Shield}>
                    <Field label="No. BPJS Kesehatan (JKN)" value={selectedEmployee.noBpjsKesehatan} copyable />
                    <Field label="No. BPJS Ketenagakerjaan (KPJ)" value={selectedEmployee.noBpjsKetenagakerjaan} copyable />
                  </Section>

                  <hr className="border-border" />

                  <Section title="Dokumen & Berkas" icon={FileText}>
                    <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <DocBadge exists={!!selectedEmployee.fotoKtp} label="Foto KTP" />
                      <DocBadge exists={!!selectedEmployee.fotoDiri} label="Foto Diri" />
                      <DocBadge exists={!!selectedEmployee.fotoSim} label="Foto SIM" />
                      <DocBadge exists={!!selectedEmployee.kartuKeluarga} label="Kartu Keluarga" />
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
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddForm(false)} />
          <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-4rem)] flex flex-col animate-scale-in">
            {/* Header */}
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
              <button onClick={() => setShowAddForm(false)} className="p-2 rounded-xl hover:bg-muted text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Data Pribadi */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <User className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Data Pribadi</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Nama Lengkap" required>
                    <input type="text" placeholder="Masukkan nama lengkap" className={inputClass} />
                  </FormField>
                  <FormField label="No. KTP (NIK)" required>
                    <input type="text" placeholder="16 digit NIK" maxLength={16} className={inputClass} />
                  </FormField>
                  <FormField label="Jenis Kelamin" required>
                    <select className={selectClass}>
                      <option value="">Pilih jenis kelamin</option>
                      <option value="Laki-laki">Laki-laki</option>
                      <option value="Perempuan">Perempuan</option>
                    </select>
                  </FormField>
                  <FormField label="Agama" required>
                    <select className={selectClass}>
                      <option value="">Pilih agama</option>
                      <option value="Islam">Islam</option>
                      <option value="Kristen">Kristen</option>
                      <option value="Katolik">Katolik</option>
                      <option value="Hindu">Hindu</option>
                      <option value="Buddha">Buddha</option>
                      <option value="Konghucu">Konghucu</option>
                    </select>
                  </FormField>
                  <FormField label="Tempat Lahir" required>
                    <input type="text" placeholder="Kota kelahiran" className={inputClass} />
                  </FormField>
                  <FormField label="Tanggal Lahir" required>
                    <input type="date" className={inputClass} />
                  </FormField>
                  <FormField label="Alamat KTP" full>
                    <textarea rows={2} placeholder="Alamat sesuai KTP" className={cn(inputClass, "resize-none")} />
                  </FormField>
                  <FormField label="Alamat Domisili" full>
                    <textarea rows={2} placeholder="Alamat tempat tinggal saat ini" className={cn(inputClass, "resize-none")} />
                  </FormField>
                  <FormField label="No. Telepon (WhatsApp)" required>
                    <input type="tel" placeholder="08xx-xxxx-xxxx" className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* Data Kepegawaian */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Briefcase className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Kepegawaian</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="ID Pegawai" required>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Contoh: ID57213"
                        value={newId}
                        onChange={(e) => setNewId(e.target.value)}
                        className={cn(inputClass, "flex-1")}
                      />
                      <button
                        type="button"
                        onClick={generateId}
                        className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary-light text-primary text-xs font-semibold hover:bg-primary hover:text-white whitespace-nowrap"
                        title="Generate ID otomatis"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        Auto
                      </button>
                    </div>
                  </FormField>
                  <FormField label="Jabatan" required>
                    <input type="text" placeholder="Jabatan / posisi" className={inputClass} />
                  </FormField>
                  <FormField label="Tanggal Bergabung" required>
                    <input type="date" className={inputClass} />
                  </FormField>
                  <FormField label="Status Pegawai" required>
                    <select className={selectClass}>
                      <option value="Aktif">Aktif</option>
                      <option value="Cuti">Cuti</option>
                      <option value="Tidak Aktif">Tidak Aktif</option>
                    </select>
                  </FormField>
                  <FormField label="Tanggal Mulai PKWT">
                    <input type="date" className={inputClass} />
                  </FormField>
                  <FormField label="Tanggal Berakhir PKWT">
                    <input type="date" className={inputClass} />
                  </FormField>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">* Kosongkan PKWT jika pegawai tetap (PKWTT)</p>
              </div>

              {/* Data Keluarga */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Heart className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Data Keluarga</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Status Pernikahan" required>
                    <select className={selectClass}>
                      <option value="Belum Menikah">Belum Menikah</option>
                      <option value="Menikah">Menikah</option>
                      <option value="Cerai">Cerai</option>
                    </select>
                  </FormField>
                  <FormField label="Nama Pasangan">
                    <input type="text" placeholder="Nama suami/istri" className={inputClass} />
                  </FormField>
                  <FormField label="Jumlah Anak">
                    <input type="number" min={0} defaultValue={0} className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* Rekening */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <CreditCard className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Rekening & Keuangan</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Bank" required>
                    <select className={selectClass}>
                      <option value="">Pilih bank</option>
                      <option value="BCA">BCA</option>
                      <option value="Mandiri">Mandiri</option>
                      <option value="BNI">BNI</option>
                      <option value="BRI">BRI</option>
                      <option value="CIMB Niaga">CIMB Niaga</option>
                      <option value="Danamon">Danamon</option>
                      <option value="BSI">BSI</option>
                    </select>
                  </FormField>
                  <FormField label="No. Rekening" required>
                    <input type="text" placeholder="Nomor rekening" className={inputClass} />
                  </FormField>
                  <FormField label="Nama Rekening" required>
                    <input type="text" placeholder="Nama pemilik rekening" className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* BPJS */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">BPJS & Jaminan Sosial</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="No. BPJS Kesehatan (JKN)">
                    <input type="text" placeholder="13 digit nomor JKN" className={inputClass} />
                  </FormField>
                  <FormField label="No. BPJS Ketenagakerjaan (KPJ)">
                    <input type="text" placeholder="Nomor KPJ" className={inputClass} />
                  </FormField>
                </div>
              </div>

              {/* Dokumen Upload */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Dokumen & Berkas</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {["Foto KTP", "Foto Diri", "Foto SIM", "Kartu Keluarga"].map((doc) => (
                    <FormField key={doc} label={doc}>
                      <div className="flex items-center gap-2">
                        <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary-light/20 cursor-pointer text-sm text-muted-foreground">
                          <ImageIcon className="w-4 h-4" />
                          <span>Pilih file</span>
                          <input type="file" accept="image/*,.pdf" className="hidden" />
                        </label>
                      </div>
                    </FormField>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" onClick={() => setShowAddForm(false)}>Batal</Button>
              <Button icon={Plus} onClick={() => setShowAddForm(false)}>Simpan Pegawai</Button>
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
    </>
  );
}
