"use client";

import { useState } from "react";
import {
  Database,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Check,
  Layers,
  Briefcase,
  ArrowUpDown,
  GripVertical,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";

// ─── Types ───
interface Level {
  id: number;
  nama: string;
  urutan: number;
  status: "Aktif" | "Tidak Aktif";
}

interface Jabatan {
  id: number;
  nama: string;
  deskripsi: string;
  level: string;
  status: "Aktif" | "Tidak Aktif";
}

// ─── Initial Data ───
const initialLevels: Level[] = [
  { id: 1, nama: "Intern", urutan: 1, status: "Aktif" },
  { id: 2, nama: "Junior", urutan: 2, status: "Aktif" },
  { id: 3, nama: "Staff", urutan: 3, status: "Aktif" },
  { id: 4, nama: "Senior", urutan: 4, status: "Aktif" },
  { id: 5, nama: "Lead", urutan: 5, status: "Aktif" },
  { id: 6, nama: "Manager", urutan: 6, status: "Aktif" },
  { id: 7, nama: "Director", urutan: 7, status: "Aktif" },
];

const initialJabatan: Jabatan[] = [
  { id: 1, nama: "Senior Software Engineer", deskripsi: "Pengembang perangkat lunak senior", level: "Senior", status: "Aktif" },
  { id: 2, nama: "Marketing Manager", deskripsi: "Manajer divisi pemasaran", level: "Manager", status: "Aktif" },
  { id: 3, nama: "Sales Executive", deskripsi: "Eksekutif penjualan", level: "Staff", status: "Aktif" },
  { id: 4, nama: "HR Specialist", deskripsi: "Spesialis sumber daya manusia", level: "Staff", status: "Aktif" },
  { id: 5, nama: "Frontend Developer", deskripsi: "Pengembang antarmuka pengguna", level: "Junior", status: "Aktif" },
  { id: 6, nama: "Financial Analyst", deskripsi: "Analis keuangan perusahaan", level: "Staff", status: "Aktif" },
  { id: 7, nama: "Operations Manager", deskripsi: "Manajer operasional", level: "Manager", status: "Aktif" },
  { id: 8, nama: "UI/UX Designer", deskripsi: "Desainer antarmuka dan pengalaman pengguna", level: "Staff", status: "Aktif" },
  { id: 9, nama: "Backend Developer", deskripsi: "Pengembang sisi server", level: "Junior", status: "Aktif" },
  { id: 10, nama: "Content Strategist", deskripsi: "Perencana strategi konten", level: "Staff", status: "Aktif" },
  { id: 11, nama: "Account Manager", deskripsi: "Pengelola akun klien", level: "Staff", status: "Aktif" },
  { id: 12, nama: "Recruitment Lead", deskripsi: "Pimpinan tim rekrutmen", level: "Lead", status: "Tidak Aktif" },
];

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const selectClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none text-foreground";

// ─── Tabs config ───
const tabs = [
  { key: "level", label: "Level", icon: Layers },
  { key: "jabatan", label: "Jabatan", icon: Briefcase },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default function MasterDataPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("level");

  // ─── Level State ───
  const [levelList, setLevelList] = useState<Level[]>(initialLevels);
  const [levelSearch, setLevelSearch] = useState("");
  const [showLevelForm, setShowLevelForm] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<number | null>(null);
  const [levelForm, setLevelForm] = useState({ nama: "", urutan: 1, status: "Aktif" });
  const [deleteLevelConfirm, setDeleteLevelConfirm] = useState<number | null>(null);

  // ─── Jabatan State ───
  const [jabatanList, setJabatanList] = useState<Jabatan[]>(initialJabatan);
  const [jabatanSearch, setJabatanSearch] = useState("");
  const [showJabatanForm, setShowJabatanForm] = useState(false);
  const [editingJabatanId, setEditingJabatanId] = useState<number | null>(null);
  const [jabatanForm, setJabatanForm] = useState({ nama: "", deskripsi: "", level: "Staff", status: "Aktif" });
  const [deleteJabatanConfirm, setDeleteJabatanConfirm] = useState<number | null>(null);

  const [successMsg, setSuccessMsg] = useState("");

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 2500);
  };

  // ─── Level Handlers ───
  const filteredLevels = levelList
    .filter((l) => l.nama.toLowerCase().includes(levelSearch.toLowerCase()))
    .sort((a, b) => a.urutan - b.urutan);

  const handleOpenAddLevel = () => {
    const maxUrutan = levelList.length > 0 ? Math.max(...levelList.map((l) => l.urutan)) : 0;
    setLevelForm({ nama: "", urutan: maxUrutan + 1, status: "Aktif" });
    setEditingLevelId(null);
    setShowLevelForm(true);
  };
  const handleOpenEditLevel = (l: Level) => {
    setLevelForm({ nama: l.nama, urutan: l.urutan, status: l.status });
    setEditingLevelId(l.id);
    setShowLevelForm(true);
  };
  const handleSaveLevel = () => {
    if (!levelForm.nama.trim()) return;
    if (editingLevelId !== null) {
      setLevelList((p) => p.map((l) => l.id === editingLevelId ? { ...l, nama: levelForm.nama, urutan: levelForm.urutan, status: levelForm.status as Level["status"] } : l));
      showSuccess("Level berhasil diperbarui");
    } else {
      const newId = Math.max(0, ...levelList.map((l) => l.id)) + 1;
      setLevelList((p) => [...p, { id: newId, nama: levelForm.nama, urutan: levelForm.urutan, status: levelForm.status as Level["status"] }]);
      showSuccess("Level baru berhasil ditambahkan");
    }
    setShowLevelForm(false);
  };
  const handleDeleteLevel = (id: number) => { setLevelList((p) => p.filter((l) => l.id !== id)); setDeleteLevelConfirm(null); showSuccess("Level berhasil dihapus"); };
  const handleToggleLevelStatus = (id: number) => { setLevelList((p) => p.map((l) => l.id === id ? { ...l, status: l.status === "Aktif" ? "Tidak Aktif" : "Aktif" } : l)); };

  // ─── Jabatan Handlers ───
  const filteredJabatan = jabatanList.filter((j) =>
    j.nama.toLowerCase().includes(jabatanSearch.toLowerCase()) || j.level.toLowerCase().includes(jabatanSearch.toLowerCase())
  );
  const activeLevelNames = levelList.filter((l) => l.status === "Aktif").sort((a, b) => a.urutan - b.urutan).map((l) => l.nama);

  const handleOpenAddJabatan = () => {
    setJabatanForm({ nama: "", deskripsi: "", level: activeLevelNames[0] || "Staff", status: "Aktif" });
    setEditingJabatanId(null);
    setShowJabatanForm(true);
  };
  const handleOpenEditJabatan = (j: Jabatan) => {
    setJabatanForm({ nama: j.nama, deskripsi: j.deskripsi, level: j.level, status: j.status });
    setEditingJabatanId(j.id);
    setShowJabatanForm(true);
  };
  const handleSaveJabatan = () => {
    if (!jabatanForm.nama.trim()) return;
    if (editingJabatanId !== null) {
      setJabatanList((p) => p.map((j) => j.id === editingJabatanId ? { ...j, nama: jabatanForm.nama, deskripsi: jabatanForm.deskripsi, level: jabatanForm.level, status: jabatanForm.status as Jabatan["status"] } : j));
      showSuccess("Jabatan berhasil diperbarui");
    } else {
      const newId = Math.max(0, ...jabatanList.map((j) => j.id)) + 1;
      setJabatanList((p) => [...p, { id: newId, nama: jabatanForm.nama, deskripsi: jabatanForm.deskripsi, level: jabatanForm.level, status: jabatanForm.status as Jabatan["status"] }]);
      showSuccess("Jabatan baru berhasil ditambahkan");
    }
    setShowJabatanForm(false);
  };
  const handleDeleteJabatan = (id: number) => { setJabatanList((p) => p.filter((j) => j.id !== id)); setDeleteJabatanConfirm(null); showSuccess("Jabatan berhasil dihapus"); };
  const handleToggleJabatanStatus = (id: number) => { setJabatanList((p) => p.map((j) => j.id === id ? { ...j, status: j.status === "Aktif" ? "Tidak Aktif" : "Aktif" } : j)); };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Data Master" description="Kelola data referensi Level dan Jabatan" icon={Database} />

      {successMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success-light border border-success/20 text-success text-sm font-medium animate-fade-in">
          <Check className="w-4 h-4" />{successMsg}
        </div>
      )}

      {/* ═══ MAIN CARD WITH TABS ═══ */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {/* Tab Bar */}
        <div className="flex items-center border-b border-border bg-muted/30">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            const count = tab.key === "level" ? levelList.length : jabatanList.length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 -mb-px",
                  isActive
                    ? "border-primary text-primary bg-card"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                  isActive ? "bg-primary-light text-primary" : "bg-muted text-muted-foreground"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ─── TAB: LEVEL ─── */}
        {activeTab === "level" && (
          <>
            {/* Toolbar */}
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari level..." value={levelSearch} onChange={(e) => setLevelSearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              <Button icon={Plus} size="sm" onClick={handleOpenAddLevel}>Tambah Level</Button>
            </div>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">
                      <div className="flex items-center gap-1"><ArrowUpDown className="w-3 h-3" />Urutan</div>
                    </th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Level</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredLevels.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-10 text-sm text-muted-foreground">Tidak ada level ditemukan</td></tr>
                  ) : filteredLevels.map((level) => (
                    <tr key={level.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <GripVertical className="w-3 h-3 text-muted-foreground/40" />
                          <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{level.urutan}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3"><p className="text-sm font-semibold text-foreground">{level.nama}</p></td>
                      <td className="px-5 py-3">
                        <button onClick={() => handleToggleLevelStatus(level.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            level.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", level.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {level.status}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleOpenEditLevel(level)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          {deleteLevelConfirm === level.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDeleteLevel(level.id)} className="p-1.5 rounded-lg bg-danger text-white text-[10px] font-semibold px-2">Hapus</button>
                              <button onClick={() => setDeleteLevelConfirm(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteLevelConfirm(level.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
              {filteredLevels.length} level &middot; Diurutkan berdasarkan hierarki
            </div>
          </>
        )}

        {/* ─── TAB: JABATAN ─── */}
        {activeTab === "jabatan" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari jabatan atau level..." value={jabatanSearch} onChange={(e) => setJabatanSearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              <Button icon={Plus} size="sm" onClick={handleOpenAddJabatan}>Tambah Jabatan</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Jabatan</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Deskripsi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Level</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredJabatan.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">Tidak ada jabatan ditemukan</td></tr>
                  ) : filteredJabatan.map((jabatan, idx) => (
                    <tr key={jabatan.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{jabatan.nama}</p></td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-[250px] truncate">{jabatan.deskripsi || <span className="italic">-</span>}</td>
                      <td className="px-5 py-3.5"><span className="text-xs font-medium text-accent bg-accent-light px-2 py-1 rounded-md">{jabatan.level}</span></td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => handleToggleJabatanStatus(jabatan.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            jabatan.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", jabatan.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {jabatan.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleOpenEditJabatan(jabatan)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          {deleteJabatanConfirm === jabatan.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDeleteJabatan(jabatan.id)} className="p-1.5 rounded-lg bg-danger text-white text-[10px] font-semibold px-2">Hapus</button>
                              <button onClick={() => setDeleteJabatanConfirm(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteJabatanConfirm(jabatan.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
              Menampilkan {filteredJabatan.length} dari {jabatanList.length} jabatan
            </div>
          </>
        )}
      </div>

      {/* ═══ LEVEL FORM MODAL ═══ */}
      {showLevelForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLevelForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center">
                  {editingLevelId ? <Pencil className="w-4 h-4 text-accent" /> : <Plus className="w-4 h-4 text-accent" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingLevelId ? "Edit Level" : "Tambah Level Baru"}</h2>
              </div>
              <button onClick={() => setShowLevelForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Level <span className="text-danger">*</span></label>
                <input type="text" placeholder="Contoh: Supervisor" value={levelForm.nama} onChange={(e) => setLevelForm({ ...levelForm, nama: e.target.value })} className={inputClass} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Urutan Hierarki <span className="text-danger">*</span></label>
                  <input type="number" min={1} value={levelForm.urutan} onChange={(e) => setLevelForm({ ...levelForm, urutan: parseInt(e.target.value) || 1 })} className={inputClass} />
                  <p className="text-[10px] text-muted-foreground mt-1">1 = paling rendah</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <select value={levelForm.status} onChange={(e) => setLevelForm({ ...levelForm, status: e.target.value })} className={selectClass}>
                    <option value="Aktif">Aktif</option>
                    <option value="Tidak Aktif">Tidak Aktif</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowLevelForm(false)}>Batal</Button>
              <Button size="sm" icon={editingLevelId ? Check : Plus} onClick={handleSaveLevel} disabled={!levelForm.nama.trim()}>
                {editingLevelId ? "Simpan" : "Tambah Level"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ JABATAN FORM MODAL ═══ */}
      {showJabatanForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowJabatanForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingJabatanId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingJabatanId ? "Edit Jabatan" : "Tambah Jabatan Baru"}</h2>
              </div>
              <button onClick={() => setShowJabatanForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Jabatan <span className="text-danger">*</span></label>
                <input type="text" placeholder="Contoh: Senior Software Engineer" value={jabatanForm.nama} onChange={(e) => setJabatanForm({ ...jabatanForm, nama: e.target.value })} className={inputClass} autoFocus />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                <input type="text" placeholder="Deskripsi singkat jabatan" value={jabatanForm.deskripsi} onChange={(e) => setJabatanForm({ ...jabatanForm, deskripsi: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Level <span className="text-danger">*</span></label>
                  <select value={jabatanForm.level} onChange={(e) => setJabatanForm({ ...jabatanForm, level: e.target.value })} className={selectClass}>
                    {activeLevelNames.map((l) => (<option key={l} value={l}>{l}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <select value={jabatanForm.status} onChange={(e) => setJabatanForm({ ...jabatanForm, status: e.target.value })} className={selectClass}>
                    <option value="Aktif">Aktif</option>
                    <option value="Tidak Aktif">Tidak Aktif</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowJabatanForm(false)}>Batal</Button>
              <Button size="sm" icon={editingJabatanId ? Check : Plus} onClick={handleSaveJabatan} disabled={!jabatanForm.nama.trim()}>
                {editingJabatanId ? "Simpan" : "Tambah Jabatan"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
