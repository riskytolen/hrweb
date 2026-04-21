"use client";

import { useState } from "react";
import {
  Scale,
  Plus,
  Upload,
  Download,
  Search,
  FileText,
  File,
  Eye,
  Trash2,
  Filter,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Stamp,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { cn, getInitials, formatShortDate } from "@/lib/utils";

interface LegalDocument {
  id: string;
  title: string;
  employeeName: string;
  department: string;
  category: string;
  type: string;
  size: string;
  issuedDate: string;
  expiryDate: string | null;
  status: string;
}

const legalDocuments: LegalDocument[] = [
  {
    id: "LGL-001",
    title: "Kontrak Kerja Tetap",
    employeeName: "Budi Santoso",
    department: "Engineering",
    category: "Kontrak Kerja",
    type: "PDF",
    size: "1.4 MB",
    issuedDate: "2021-03-15",
    expiryDate: null,
    status: "Active",
  },
  {
    id: "LGL-002",
    title: "Kontrak Kerja Tetap",
    employeeName: "Siti Nurhaliza",
    department: "Marketing",
    category: "Kontrak Kerja",
    type: "PDF",
    size: "1.3 MB",
    issuedDate: "2020-07-01",
    expiryDate: null,
    status: "Active",
  },
  {
    id: "LGL-003",
    title: "Perjanjian Kerja Waktu Tertentu (PKWT)",
    employeeName: "Ahmad Fauzi",
    department: "Sales",
    category: "Kontrak Kerja",
    type: "PDF",
    size: "1.1 MB",
    issuedDate: "2024-01-10",
    expiryDate: "2025-01-10",
    status: "Active",
  },
  {
    id: "LGL-004",
    title: "NDA (Non-Disclosure Agreement)",
    employeeName: "Rizky Pratama",
    department: "Engineering",
    category: "Kerahasiaan",
    type: "PDF",
    size: "0.8 MB",
    issuedDate: "2023-02-14",
    expiryDate: null,
    status: "Active",
  },
  {
    id: "LGL-005",
    title: "Surat Peringatan (SP-1)",
    employeeName: "Rina Wulandari",
    department: "Marketing",
    category: "Surat Peringatan",
    type: "PDF",
    size: "0.3 MB",
    issuedDate: "2024-02-20",
    expiryDate: "2024-08-20",
    status: "Active",
  },
  {
    id: "LGL-006",
    title: "Surat Keputusan Promosi",
    employeeName: "Hendra Wijaya",
    department: "Operations",
    category: "SK & Keputusan",
    type: "PDF",
    size: "0.5 MB",
    issuedDate: "2023-06-01",
    expiryDate: null,
    status: "Active",
  },
  {
    id: "LGL-007",
    title: "Perjanjian Kerja Waktu Tertentu (PKWT)",
    employeeName: "Putri Rahayu",
    department: "Design",
    category: "Kontrak Kerja",
    type: "PDF",
    size: "1.2 MB",
    issuedDate: "2023-08-15",
    expiryDate: "2024-08-15",
    status: "Expiring Soon",
  },
  {
    id: "LGL-008",
    title: "Pendaftaran BPJS Ketenagakerjaan",
    employeeName: "Maya Anggraini",
    department: "Finance",
    category: "BPJS & Asuransi",
    type: "PDF",
    size: "0.6 MB",
    issuedDate: "2022-06-01",
    expiryDate: null,
    status: "Active",
  },
  {
    id: "LGL-009",
    title: "Kontrak Kerja Waktu Tertentu (PKWT)",
    employeeName: "Andi Setiawan",
    department: "Engineering",
    category: "Kontrak Kerja",
    type: "PDF",
    size: "1.1 MB",
    issuedDate: "2023-04-01",
    expiryDate: "2024-04-01",
    status: "Expired",
  },
  {
    id: "LGL-010",
    title: "Surat Keputusan Mutasi",
    employeeName: "Fajar Nugroho",
    department: "Sales",
    category: "SK & Keputusan",
    type: "PDF",
    size: "0.4 MB",
    issuedDate: "2024-01-15",
    expiryDate: null,
    status: "Active",
  },
  {
    id: "LGL-011",
    title: "Pendaftaran BPJS Kesehatan",
    employeeName: "Dewi Lestari",
    department: "HR",
    category: "BPJS & Asuransi",
    type: "PDF",
    size: "0.5 MB",
    issuedDate: "2021-09-20",
    expiryDate: null,
    status: "Active",
  },
  {
    id: "LGL-012",
    title: "Surat Resign & Exit Clearance",
    employeeName: "Lina Marlina",
    department: "HR",
    category: "Terminasi",
    type: "PDF",
    size: "0.7 MB",
    issuedDate: "2024-03-01",
    expiryDate: null,
    status: "Completed",
  },
];

const categories = [
  "Semua",
  "Kontrak Kerja",
  "Kerahasiaan",
  "SK & Keputusan",
  "Surat Peringatan",
  "BPJS & Asuransi",
  "Terminasi",
];

const statusVariant: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  Active: "success",
  "Expiring Soon": "warning",
  Expired: "danger",
  Completed: "muted",
  Draft: "info",
};

export default function LegalPage() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");

  const filtered = legalDocuments.filter((doc) => {
    const matchSearch =
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.employeeName.toLowerCase().includes(search.toLowerCase());
    const matchCategory =
      selectedCategory === "Semua" || doc.category === selectedCategory;
    return matchSearch && matchCategory;
  });

  const activeCount = legalDocuments.filter((d) => d.status === "Active").length;
  const expiringCount = legalDocuments.filter((d) => d.status === "Expiring Soon").length;
  const expiredCount = legalDocuments.filter((d) => d.status === "Expired").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Legal & Administrasi"
        description="Kelola dokumen legal, kontrak kerja, dan administrasi kepegawaian"
        icon={Scale}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={Download} size="sm">
              Export
            </Button>
            <Button icon={Plus} size="sm">
              Buat Dokumen
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary-light flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Dokumen</p>
              <p className="text-xl font-bold text-foreground">{legalDocuments.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success-light flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Aktif</p>
              <p className="text-xl font-bold text-success">{activeCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-warning-light flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Segera Berakhir</p>
              <p className="text-xl font-bold text-warning">{expiringCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-danger-light flex items-center justify-center">
              <Clock className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Kadaluarsa</p>
              <p className="text-xl font-bold text-danger">{expiredCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Alert Banner */}
      {(expiringCount > 0 || expiredCount > 0) && (
        <div className="bg-warning-light/50 border border-warning/20 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">Perhatian</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Terdapat {expiringCount} dokumen yang segera berakhir dan {expiredCount} dokumen yang sudah kadaluarsa. Segera lakukan perpanjangan atau pembaruan.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari dokumen atau nama pegawai..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap",
                  selectedCategory === cat
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {cat}
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
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Dokumen</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Kategori</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tanggal Terbit</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Masa Berlaku</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((doc) => (
                <tr key={doc.id} className="hover:bg-muted/30 cursor-pointer">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center">
                        <Stamp className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{doc.title}</p>
                        <p className="text-xs text-muted-foreground">{doc.id} &middot; {doc.type} &middot; {doc.size}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-[10px] font-bold">
                        {getInitials(doc.employeeName)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{doc.employeeName}</p>
                        <p className="text-[10px] text-muted-foreground">{doc.department}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-md">
                      {doc.category}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-muted-foreground">
                    {formatShortDate(doc.issuedDate)}
                  </td>
                  <td className="px-5 py-4 text-sm">
                    {doc.expiryDate ? (
                      <span className={cn(
                        "font-medium",
                        doc.status === "Expired" ? "text-danger" :
                        doc.status === "Expiring Soon" ? "text-warning" : "text-foreground"
                      )}>
                        {formatShortDate(doc.expiryDate)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Tidak terbatas</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant={statusVariant[doc.status] || "muted"}>
                      {doc.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center gap-1">
                      <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary" title="Lihat">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary" title="Unduh">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-danger" title="Hapus">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          Menampilkan {filtered.length} dari {legalDocuments.length} dokumen
        </div>
      </div>
    </div>
  );
}
