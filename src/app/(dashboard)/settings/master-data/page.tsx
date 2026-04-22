"use client";

import { useState, useEffect } from "react";
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
  Landmark,
  Building2,
  MapPin,
  Clock,
  ArrowUpDown,
  GripVertical,
  CircleCheckBig,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import Portal from "@/components/ui/Portal";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { supabase, type DbLevel, type DbJabatan, type DbBank, type DbDivision, type DbDivisionLocation, type DbDivisionSchedule } from "@/lib/supabase";

// ─── Types ───
type Level = DbLevel;
type Jabatan = DbJabatan & { levelNama?: string };
type Bank = DbBank;
type Division = DbDivision;
type DivisionLocation = DbDivisionLocation & { divisionNama?: string };
type DivisionSchedule = DbDivisionSchedule & { divisionNama?: string };

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const selectClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none text-foreground";

// ─── Tabs config ───
const tabs = [
  { key: "level", label: "Level", icon: Layers },
  { key: "jabatan", label: "Jabatan", icon: Briefcase },
  { key: "divisi", label: "Divisi", icon: Building2 },
  { key: "titik-absen", label: "Titik Absen", icon: MapPin },
  { key: "waktu-kerja", label: "Waktu Kerja", icon: Clock },
  { key: "bank", label: "Bank", icon: Landmark },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default function MasterDataPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("level");

  // ─── Level State ───
  const [levelList, setLevelList] = useState<Level[]>([]);
  const [levelSearch, setLevelSearch] = useState("");
  const [showLevelForm, setShowLevelForm] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<number | null>(null);
  const [levelForm, setLevelForm] = useState({ nama: "", urutan: 1, status: "Aktif" });
  // ─── Jabatan State ───
  const [jabatanList, setJabatanList] = useState<Jabatan[]>([]);
  const [jabatanSearch, setJabatanSearch] = useState("");
  const [showJabatanForm, setShowJabatanForm] = useState(false);
  const [editingJabatanId, setEditingJabatanId] = useState<number | null>(null);
  const [jabatanForm, setJabatanForm] = useState({ nama: "", deskripsi: "", level_id: 0, status: "Aktif" });

  // ─── Bank State ───
  const [bankList, setBankList] = useState<Bank[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBankId, setEditingBankId] = useState<number | null>(null);
  const [bankForm, setBankForm] = useState({ nama: "", kode: "", status: "Aktif" });

  // ─── Divisi State ───
  const [divisionList, setDivisionList] = useState<Division[]>([]);
  const [divisionSearch, setDivisionSearch] = useState("");
  const [showDivisionForm, setShowDivisionForm] = useState(false);
  const [editingDivisionId, setEditingDivisionId] = useState<number | null>(null);
  const [divisionForm, setDivisionForm] = useState({ nama: "", deskripsi: "", status: "Aktif" });

  // ─── Titik Absen State ───
  const [locationList, setLocationList] = useState<DivisionLocation[]>([]);
  const [locationSearch, setLocationSearch] = useState("");
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [locationForm, setLocationForm] = useState({ division_id: 0, latitude: "", longitude: "", radius: "100", status: "Aktif" });

  // ─── Waktu Kerja State ───
  const [scheduleList, setScheduleList] = useState<DivisionSchedule[]>([]);
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ division_id: 0, jam_masuk: "08:00", jam_pulang: "17:00", toleransi_menit: "15", status: "Aktif" });

  // ─── Delete Confirm Dialog ───
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "level" | "jabatan" | "divisi" | "titik-absen" | "waktu-kerja" | "bank"; id: number; nama: string } | null>(null);

  const [toast, setToast] = useState<{ show: boolean; title: string; message: string }>({ show: false, title: "", message: "" });
  const [loading, setLoading] = useState(true);

  // ─── Fetch data from Supabase ───
  const fetchLevels = async () => {
    const { data } = await supabase.from("levels").select("*").order("urutan");
    if (data) setLevelList(data);
  };

  const fetchJabatan = async () => {
    const { data } = await supabase.from("jabatan").select("*, levels(nama)").order("nama");
    if (data) {
      setJabatanList(data.map((j) => ({ ...j, levelNama: j.levels?.nama || "-" })));
    }
  };

  const fetchBanks = async () => {
    const { data } = await supabase.from("banks").select("*").order("nama");
    if (data) setBankList(data);
  };

  const fetchDivisions = async () => {
    const { data } = await supabase.from("divisions").select("*").order("nama");
    if (data) setDivisionList(data);
  };

  const fetchLocations = async () => {
    const { data } = await supabase.from("division_locations").select("*, divisions(nama)").order("nama");
    if (data) setLocationList(data.map((l) => ({ ...l, divisionNama: l.divisions?.nama || "-" })));
  };

  const fetchSchedules = async () => {
    const { data } = await supabase.from("division_schedules").select("*, divisions(nama)").order("division_id");
    if (data) setScheduleList(data.map((s) => ({ ...s, divisionNama: s.divisions?.nama || "-" })));
  };

  useEffect(() => {
    Promise.all([fetchLevels(), fetchJabatan(), fetchBanks(), fetchDivisions(), fetchLocations(), fetchSchedules()]).then(() => setLoading(false));
  }, []);

  // Lock body scroll when any modal is open
  useEffect(() => {
    if (showLevelForm || showJabatanForm || showBankForm || showDivisionForm || showLocationForm || showScheduleForm) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [showLevelForm, showJabatanForm, showBankForm, showDivisionForm, showLocationForm, showScheduleForm]);

  const showSuccess = (title: string, message?: string) => {
    setToast({ show: true, title, message: message || "" });
    setTimeout(() => setToast({ show: false, title: "", message: "" }), 3500);
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
  const handleSaveLevel = async () => {
    if (!levelForm.nama.trim()) return;
    if (editingLevelId !== null) {
      await supabase.from("levels").update({ nama: levelForm.nama, urutan: levelForm.urutan, status: levelForm.status }).eq("id", editingLevelId);
      showSuccess("Level Diperbarui", `Data level "${levelForm.nama}" telah disimpan.`);
    } else {
      await supabase.from("levels").insert({ nama: levelForm.nama, urutan: levelForm.urutan, status: levelForm.status });
      showSuccess("Level Ditambahkan", `Level "${levelForm.nama}" berhasil ditambahkan ke sistem.`);
    }
    setShowLevelForm(false);
    fetchLevels();
    fetchJabatan();
  };
  const handleDeleteLevel = async (id: number) => {
    await supabase.from("levels").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Level Dihapus", "Data level telah dihapus dari sistem.");
    fetchLevels();
  };
  const handleToggleLevelStatus = async (id: number) => {
    const level = levelList.find((l) => l.id === id);
    if (!level) return;
    const newStatus = level.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    await supabase.from("levels").update({ status: newStatus }).eq("id", id);
    fetchLevels();
  };

  // ─── Jabatan Handlers ───
  const filteredJabatan = jabatanList.filter((j) =>
    j.nama.toLowerCase().includes(jabatanSearch.toLowerCase()) || (j.levelNama || "").toLowerCase().includes(jabatanSearch.toLowerCase())
  );
  const activeLevels = levelList.filter((l) => l.status === "Aktif").sort((a, b) => a.urutan - b.urutan);

  const handleOpenAddJabatan = () => {
    setJabatanForm({ nama: "", deskripsi: "", level_id: activeLevels[0]?.id || 0, status: "Aktif" });
    setEditingJabatanId(null);
    setShowJabatanForm(true);
  };
  const handleOpenEditJabatan = (j: Jabatan) => {
    setJabatanForm({ nama: j.nama, deskripsi: j.deskripsi || "", level_id: j.level_id || 0, status: j.status });
    setEditingJabatanId(j.id);
    setShowJabatanForm(true);
  };
  const handleSaveJabatan = async () => {
    if (!jabatanForm.nama.trim() || !jabatanForm.level_id) return;
    if (editingJabatanId !== null) {
      await supabase.from("jabatan").update({ nama: jabatanForm.nama, deskripsi: jabatanForm.deskripsi || null, level_id: jabatanForm.level_id, status: jabatanForm.status }).eq("id", editingJabatanId);
      showSuccess("Jabatan Diperbarui", `Data jabatan "${jabatanForm.nama}" telah disimpan.`);
    } else {
      await supabase.from("jabatan").insert({ nama: jabatanForm.nama, deskripsi: jabatanForm.deskripsi || null, level_id: jabatanForm.level_id, status: jabatanForm.status });
      showSuccess("Jabatan Ditambahkan", `Jabatan "${jabatanForm.nama}" berhasil ditambahkan ke sistem.`);
    }
    setShowJabatanForm(false);
    fetchJabatan();
  };
  const handleDeleteJabatan = async (id: number) => {
    await supabase.from("jabatan").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Jabatan Dihapus", "Data jabatan telah dihapus dari sistem.");
    fetchJabatan();
  };
  const handleToggleJabatanStatus = async (id: number) => {
    const jabatan = jabatanList.find((j) => j.id === id);
    if (!jabatan) return;
    const newStatus = jabatan.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    await supabase.from("jabatan").update({ status: newStatus }).eq("id", id);
    fetchJabatan();
  };

  // ─── Divisi Handlers ───
  const filteredDivisions = divisionList.filter((d) =>
    d.nama.toLowerCase().includes(divisionSearch.toLowerCase()) || (d.deskripsi || "").toLowerCase().includes(divisionSearch.toLowerCase())
  );

  const handleOpenAddDivision = () => {
    setDivisionForm({ nama: "", deskripsi: "", status: "Aktif" });
    setEditingDivisionId(null);
    setShowDivisionForm(true);
  };
  const handleOpenEditDivision = (d: Division) => {
    setDivisionForm({ nama: d.nama, deskripsi: d.deskripsi || "", status: d.status });
    setEditingDivisionId(d.id);
    setShowDivisionForm(true);
  };
  const handleSaveDivision = async () => {
    if (!divisionForm.nama.trim()) return;
    if (editingDivisionId !== null) {
      await supabase.from("divisions").update({ nama: divisionForm.nama, deskripsi: divisionForm.deskripsi || null, status: divisionForm.status }).eq("id", editingDivisionId);
      showSuccess("Divisi Diperbarui", `Data divisi "${divisionForm.nama}" telah disimpan.`);
    } else {
      await supabase.from("divisions").insert({ nama: divisionForm.nama, deskripsi: divisionForm.deskripsi || null, status: divisionForm.status });
      showSuccess("Divisi Ditambahkan", `Divisi "${divisionForm.nama}" berhasil ditambahkan ke sistem.`);
    }
    setShowDivisionForm(false);
    fetchDivisions();
  };
  const handleDeleteDivision = async (id: number) => {
    await supabase.from("divisions").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Divisi Dihapus", "Data divisi telah dihapus dari sistem.");
    fetchDivisions();
  };
  const handleToggleDivisionStatus = async (id: number) => {
    const division = divisionList.find((d) => d.id === id);
    if (!division) return;
    const newStatus = division.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    await supabase.from("divisions").update({ status: newStatus }).eq("id", id);
    fetchDivisions();
  };

  // ─── Titik Absen Handlers ───
  const filteredLocations = locationList.filter((l) =>
    (l.divisionNama || "").toLowerCase().includes(locationSearch.toLowerCase())
  );
  const activeDivisions = divisionList.filter((d) => d.status === "Aktif");
  const divisionsWithoutLocation = activeDivisions.filter((d) => !locationList.some((l) => l.division_id === d.id));

  const handleOpenAddLocation = () => {
    setLocationForm({ division_id: divisionsWithoutLocation[0]?.id || 0, latitude: "", longitude: "", radius: "100", status: "Aktif" });
    setEditingLocationId(null);
    setShowLocationForm(true);
  };
  const handleOpenEditLocation = (l: DivisionLocation) => {
    setLocationForm({ division_id: l.division_id, latitude: String(l.latitude), longitude: String(l.longitude), radius: String(l.radius), status: l.status });
    setEditingLocationId(l.id);
    setShowLocationForm(true);
  };
  const handleSaveLocation = async () => {
    if (!locationForm.division_id || !locationForm.latitude || !locationForm.longitude) return;
    const divNama = divisionList.find((d) => d.id === locationForm.division_id)?.nama || "";
    const payload = { division_id: locationForm.division_id, latitude: parseFloat(locationForm.latitude), longitude: parseFloat(locationForm.longitude), radius: parseInt(locationForm.radius) || 100, status: locationForm.status };
    if (editingLocationId !== null) {
      await supabase.from("division_locations").update(payload).eq("id", editingLocationId);
      showSuccess("Titik Absen Diperbarui", `Koordinat divisi "${divNama}" telah disimpan.`);
    } else {
      await supabase.from("division_locations").insert(payload);
      showSuccess("Titik Absen Ditambahkan", `Koordinat divisi "${divNama}" berhasil ditambahkan.`);
    }
    setShowLocationForm(false);
    fetchLocations();
  };
  const handleDeleteLocation = async (id: number) => {
    await supabase.from("division_locations").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Titik Absen Dihapus", "Data lokasi telah dihapus dari sistem.");
    fetchLocations();
  };
  const handleToggleLocationStatus = async (id: number) => {
    const loc = locationList.find((l) => l.id === id);
    if (!loc) return;
    await supabase.from("division_locations").update({ status: loc.status === "Aktif" ? "Tidak Aktif" : "Aktif" }).eq("id", id);
    fetchLocations();
  };

  // ─── Waktu Kerja Handlers ───
  const filteredSchedules = scheduleList.filter((s) =>
    (s.divisionNama || "").toLowerCase().includes(scheduleSearch.toLowerCase())
  );
  // Divisi yang belum punya jadwal (untuk form tambah)
  const divisionsWithoutSchedule = activeDivisions.filter((d) => !scheduleList.some((s) => s.division_id === d.id));

  const handleOpenAddSchedule = () => {
    setScheduleForm({ division_id: divisionsWithoutSchedule[0]?.id || 0, jam_masuk: "08:00", jam_pulang: "17:00", toleransi_menit: "15", status: "Aktif" });
    setEditingScheduleId(null);
    setShowScheduleForm(true);
  };
  const handleOpenEditSchedule = (s: DivisionSchedule) => {
    setScheduleForm({ division_id: s.division_id, jam_masuk: s.jam_masuk.slice(0, 5), jam_pulang: s.jam_pulang.slice(0, 5), toleransi_menit: String(s.toleransi_menit), status: s.status });
    setEditingScheduleId(s.id);
    setShowScheduleForm(true);
  };
  const handleSaveSchedule = async () => {
    if (!scheduleForm.division_id) return;
    const payload = { division_id: scheduleForm.division_id, jam_masuk: scheduleForm.jam_masuk, jam_pulang: scheduleForm.jam_pulang, toleransi_menit: parseInt(scheduleForm.toleransi_menit) || 0, status: scheduleForm.status };
    if (editingScheduleId !== null) {
      await supabase.from("division_schedules").update(payload).eq("id", editingScheduleId);
      showSuccess("Waktu Kerja Diperbarui", "Jadwal kerja telah disimpan.");
    } else {
      await supabase.from("division_schedules").insert(payload);
      showSuccess("Waktu Kerja Ditambahkan", "Jadwal kerja baru berhasil ditambahkan.");
    }
    setShowScheduleForm(false);
    fetchSchedules();
  };
  const handleDeleteSchedule = async (id: number) => {
    await supabase.from("division_schedules").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Waktu Kerja Dihapus", "Jadwal kerja telah dihapus dari sistem.");
    fetchSchedules();
  };
  const handleToggleScheduleStatus = async (id: number) => {
    const sch = scheduleList.find((s) => s.id === id);
    if (!sch) return;
    await supabase.from("division_schedules").update({ status: sch.status === "Aktif" ? "Tidak Aktif" : "Aktif" }).eq("id", id);
    fetchSchedules();
  };

  // ─── Bank Handlers ───
  const filteredBanks = bankList.filter((b) =>
    b.nama.toLowerCase().includes(bankSearch.toLowerCase()) || (b.kode || "").toLowerCase().includes(bankSearch.toLowerCase())
  );

  const handleOpenAddBank = () => {
    setBankForm({ nama: "", kode: "", status: "Aktif" });
    setEditingBankId(null);
    setShowBankForm(true);
  };
  const handleOpenEditBank = (b: Bank) => {
    setBankForm({ nama: b.nama, kode: b.kode || "", status: b.status });
    setEditingBankId(b.id);
    setShowBankForm(true);
  };
  const handleSaveBank = async () => {
    if (!bankForm.nama.trim()) return;
    if (editingBankId !== null) {
      await supabase.from("banks").update({ nama: bankForm.nama, kode: bankForm.kode || null, status: bankForm.status }).eq("id", editingBankId);
      showSuccess("Bank Diperbarui", `Data bank "${bankForm.nama}" telah disimpan.`);
    } else {
      await supabase.from("banks").insert({ nama: bankForm.nama, kode: bankForm.kode || null, status: bankForm.status });
      showSuccess("Bank Ditambahkan", `Bank "${bankForm.nama}" berhasil ditambahkan ke sistem.`);
    }
    setShowBankForm(false);
    fetchBanks();
  };
  const handleDeleteBank = async (id: number) => {
    await supabase.from("banks").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Bank Dihapus", "Data bank telah dihapus dari sistem.");
    fetchBanks();
  };
  const handleToggleBankStatus = async (id: number) => {
    const bank = bankList.find((b) => b.id === id);
    if (!bank) return;
    const newStatus = bank.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    await supabase.from("banks").update({ status: newStatus }).eq("id", id);
    fetchBanks();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Data Master" description="Kelola data referensi Level, Jabatan, Divisi, dan Bank" icon={Database} />

      {toast.show && (
        <Portal>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div className="flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border border-success/20 min-w-[360px] max-w-[480px]">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
                <CircleCheckBig className="w-5 h-5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{toast.title}</p>
                {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
              </div>
              <button
                onClick={() => setToast({ show: false, title: "", message: "" })}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-1 mx-2 h-[2px] bg-border rounded-full overflow-hidden">
              <div className="h-full bg-success rounded-full" style={{ animation: "shrink 3.5s linear forwards" }} />
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ MAIN CARD WITH TABS ═══ */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {/* Tab Bar */}
        <div className="flex items-center border-b border-border bg-muted/30">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            const count = tab.key === "level" ? levelList.length : tab.key === "jabatan" ? jabatanList.length : tab.key === "divisi" ? divisionList.length : tab.key === "titik-absen" ? locationList.length : tab.key === "waktu-kerja" ? scheduleList.length : bankList.length;
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
                  {loading ? (
                    <SkeletonTable rows={5} cols={4} />
                  ) : filteredLevels.length === 0 ? (
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
                          <button onClick={() => setDeleteConfirm({ type: "level", id: level.id, nama: level.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
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
                  {loading ? (
                    <SkeletonTable rows={5} cols={6} />
                  ) : filteredJabatan.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">Tidak ada jabatan ditemukan</td></tr>
                  ) : filteredJabatan.map((jabatan, idx) => (
                    <tr key={jabatan.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{jabatan.nama}</p></td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-[250px] truncate">{jabatan.deskripsi || <span className="italic">-</span>}</td>
                      <td className="px-5 py-3.5"><span className="text-xs font-medium text-accent bg-accent-light px-2 py-1 rounded-md">{jabatan.levelNama}</span></td>
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
                          <button onClick={() => setDeleteConfirm({ type: "jabatan", id: jabatan.id, nama: jabatan.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
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

        {/* ─── TAB: DIVISI ─── */}
        {activeTab === "divisi" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari divisi..." value={divisionSearch} onChange={(e) => setDivisionSearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              <Button icon={Plus} size="sm" onClick={handleOpenAddDivision}>Tambah Divisi</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Divisi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Deskripsi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={5} />
                  ) : filteredDivisions.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada divisi ditemukan</td></tr>
                  ) : filteredDivisions.map((division, idx) => (
                    <tr key={division.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{division.nama}</p></td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-[250px] truncate">{division.deskripsi || <span className="italic">-</span>}</td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => handleToggleDivisionStatus(division.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            division.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", division.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {division.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleOpenEditDivision(division)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setDeleteConfirm({ type: "divisi", id: division.id, nama: division.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
              Menampilkan {filteredDivisions.length} dari {divisionList.length} divisi
            </div>
          </>
        )}

        {/* ─── TAB: TITIK ABSEN ─── */}
        {activeTab === "titik-absen" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari lokasi atau divisi..." value={locationSearch} onChange={(e) => setLocationSearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              <Button icon={Plus} size="sm" onClick={handleOpenAddLocation} disabled={divisionsWithoutLocation.length === 0}>
                {divisionsWithoutLocation.length === 0 ? "Semua Divisi Sudah Ada" : "Tambah Titik Absen"}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Divisi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Koordinat</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Radius</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={6} />
                  ) : filteredLocations.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">Tidak ada titik absen ditemukan</td></tr>
                  ) : filteredLocations.map((loc, idx) => (
                    <tr key={loc.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{loc.divisionNama}</p></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground">{loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}</span></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground">{loc.radius}m</span></td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => handleToggleLocationStatus(loc.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            loc.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", loc.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {loc.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleOpenEditLocation(loc)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setDeleteConfirm({ type: "titik-absen", id: loc.id, nama: loc.divisionNama || "" })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
              Menampilkan {filteredLocations.length} dari {locationList.length} titik absen
            </div>
          </>
        )}

        {/* ─── TAB: WAKTU KERJA ─── */}
        {activeTab === "waktu-kerja" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari divisi..." value={scheduleSearch} onChange={(e) => setScheduleSearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              <Button icon={Plus} size="sm" onClick={handleOpenAddSchedule} disabled={divisionsWithoutSchedule.length === 0}>
                {divisionsWithoutSchedule.length === 0 ? "Semua Divisi Sudah Ada" : "Tambah Jadwal"}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Divisi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Jam Masuk</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Jam Pulang</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Toleransi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={7} />
                  ) : filteredSchedules.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Tidak ada jadwal kerja ditemukan</td></tr>
                  ) : filteredSchedules.map((sch, idx) => (
                    <tr key={sch.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><span className="text-sm font-semibold text-foreground">{sch.divisionNama}</span></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono bg-primary-light text-primary px-2 py-1 rounded-md">{sch.jam_masuk.slice(0, 5)}</span></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded-md">{sch.jam_pulang.slice(0, 5)}</span></td>
                      <td className="px-5 py-3.5"><span className="text-xs text-muted-foreground">{sch.toleransi_menit} menit</span></td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => handleToggleScheduleStatus(sch.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            sch.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", sch.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {sch.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleOpenEditSchedule(sch)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setDeleteConfirm({ type: "waktu-kerja", id: sch.id, nama: sch.divisionNama || "" })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
              Menampilkan {filteredSchedules.length} dari {scheduleList.length} jadwal kerja
            </div>
          </>
        )}

        {/* ─── TAB: BANK ─── */}
        {activeTab === "bank" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari bank atau kode..." value={bankSearch} onChange={(e) => setBankSearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              <Button icon={Plus} size="sm" onClick={handleOpenAddBank}>Tambah Bank</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Bank</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Kode</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={5} />
                  ) : filteredBanks.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada bank ditemukan</td></tr>
                  ) : filteredBanks.map((bank, idx) => (
                    <tr key={bank.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{bank.nama}</p></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{bank.kode || "-"}</span></td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => handleToggleBankStatus(bank.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            bank.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", bank.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {bank.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleOpenEditBank(bank)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setDeleteConfirm({ type: "bank", id: bank.id, nama: bank.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
              Menampilkan {filteredBanks.length} dari {bankList.length} bank
            </div>
          </>
        )}
      </div>

      {/* ═══ LEVEL FORM MODAL ═══ */}
      {showLevelForm && (
        <Portal>
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
        </Portal>
      )}

      {/* ═══ JABATAN FORM MODAL ═══ */}
      {showJabatanForm && (
        <Portal>
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
                  <select value={jabatanForm.level_id} onChange={(e) => setJabatanForm({ ...jabatanForm, level_id: parseInt(e.target.value) })} className={selectClass}>
                    <option value={0} disabled>Pilih level</option>
                    {activeLevels.map((l) => (<option key={l.id} value={l.id}>{l.nama}</option>))}
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
              <Button size="sm" icon={editingJabatanId ? Check : Plus} onClick={handleSaveJabatan} disabled={!jabatanForm.nama.trim() || !jabatanForm.level_id}>
                {editingJabatanId ? "Simpan" : "Tambah Jabatan"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ DIVISI FORM MODAL ═══ */}
      {showDivisionForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDivisionForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingDivisionId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingDivisionId ? "Edit Divisi" : "Tambah Divisi Baru"}</h2>
              </div>
              <button onClick={() => setShowDivisionForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Divisi <span className="text-danger">*</span></label>
                <input type="text" placeholder="Contoh: IT & Development" value={divisionForm.nama} onChange={(e) => setDivisionForm({ ...divisionForm, nama: e.target.value })} className={inputClass} autoFocus />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                <input type="text" placeholder="Deskripsi singkat divisi" value={divisionForm.deskripsi} onChange={(e) => setDivisionForm({ ...divisionForm, deskripsi: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                <select value={divisionForm.status} onChange={(e) => setDivisionForm({ ...divisionForm, status: e.target.value })} className={selectClass}>
                  <option value="Aktif">Aktif</option>
                  <option value="Tidak Aktif">Tidak Aktif</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowDivisionForm(false)}>Batal</Button>
              <Button size="sm" icon={editingDivisionId ? Check : Plus} onClick={handleSaveDivision} disabled={!divisionForm.nama.trim()}>
                {editingDivisionId ? "Simpan" : "Tambah Divisi"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ TITIK ABSEN FORM MODAL ═══ */}
      {showLocationForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLocationForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingLocationId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingLocationId ? "Edit Titik Absen" : "Tambah Titik Absen"}</h2>
              </div>
              <button onClick={() => setShowLocationForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Divisi <span className="text-danger">*</span></label>
                <select value={locationForm.division_id} onChange={(e) => setLocationForm({ ...locationForm, division_id: parseInt(e.target.value) })} className={selectClass} disabled={editingLocationId !== null}>
                  <option value={0} disabled>Pilih divisi</option>
                  {(editingLocationId !== null ? activeDivisions : divisionsWithoutLocation).map((d) => (<option key={d.id} value={d.id}>{d.nama}</option>))}
                </select>
                {editingLocationId !== null && <p className="text-[10px] text-muted-foreground mt-1">Divisi tidak dapat diubah saat edit</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Latitude <span className="text-danger">*</span></label>
                  <input type="text" placeholder="-6.200000" value={locationForm.latitude} onChange={(e) => setLocationForm({ ...locationForm, latitude: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Longitude <span className="text-danger">*</span></label>
                  <input type="text" placeholder="106.816666" value={locationForm.longitude} onChange={(e) => setLocationForm({ ...locationForm, longitude: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Radius (meter)</label>
                  <input type="number" min={1} placeholder="100" value={locationForm.radius} onChange={(e) => setLocationForm({ ...locationForm, radius: e.target.value })} className={inputClass} />
                  <p className="text-[10px] text-muted-foreground mt-1">Jarak toleransi absen dari titik</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <select value={locationForm.status} onChange={(e) => setLocationForm({ ...locationForm, status: e.target.value })} className={selectClass}>
                    <option value="Aktif">Aktif</option>
                    <option value="Tidak Aktif">Tidak Aktif</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowLocationForm(false)}>Batal</Button>
              <Button size="sm" icon={editingLocationId ? Check : Plus} onClick={handleSaveLocation} disabled={!locationForm.division_id || !locationForm.latitude || !locationForm.longitude}>
                {editingLocationId ? "Simpan" : "Tambah Titik Absen"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ WAKTU KERJA FORM MODAL ═══ */}
      {showScheduleForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowScheduleForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingScheduleId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingScheduleId ? "Edit Waktu Kerja" : "Tambah Waktu Kerja"}</h2>
              </div>
              <button onClick={() => setShowScheduleForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Divisi <span className="text-danger">*</span></label>
                <select value={scheduleForm.division_id} onChange={(e) => setScheduleForm({ ...scheduleForm, division_id: parseInt(e.target.value) })} className={selectClass} disabled={editingScheduleId !== null}>
                  <option value={0} disabled>Pilih divisi</option>
                  {(editingScheduleId !== null ? activeDivisions : divisionsWithoutSchedule).map((d) => (<option key={d.id} value={d.id}>{d.nama}</option>))}
                </select>
                {editingScheduleId !== null && <p className="text-[10px] text-muted-foreground mt-1">Divisi tidak dapat diubah saat edit</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jam Masuk <span className="text-danger">*</span></label>
                  <input type="time" value={scheduleForm.jam_masuk} onChange={(e) => setScheduleForm({ ...scheduleForm, jam_masuk: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jam Pulang <span className="text-danger">*</span></label>
                  <input type="time" value={scheduleForm.jam_pulang} onChange={(e) => setScheduleForm({ ...scheduleForm, jam_pulang: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Toleransi Keterlambatan</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} value={scheduleForm.toleransi_menit} onChange={(e) => setScheduleForm({ ...scheduleForm, toleransi_menit: e.target.value })} className={inputClass} />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">menit</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <select value={scheduleForm.status} onChange={(e) => setScheduleForm({ ...scheduleForm, status: e.target.value })} className={selectClass}>
                    <option value="Aktif">Aktif</option>
                    <option value="Tidak Aktif">Tidak Aktif</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowScheduleForm(false)}>Batal</Button>
              <Button size="sm" icon={editingScheduleId ? Check : Plus} onClick={handleSaveSchedule} disabled={!scheduleForm.division_id}>
                {editingScheduleId ? "Simpan" : "Tambah Jadwal"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ BANK FORM MODAL ═══ */}
      {showBankForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBankForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingBankId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingBankId ? "Edit Bank" : "Tambah Bank Baru"}</h2>
              </div>
              <button onClick={() => setShowBankForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Bank <span className="text-danger">*</span></label>
                <input type="text" placeholder="Contoh: BCA" value={bankForm.nama} onChange={(e) => setBankForm({ ...bankForm, nama: e.target.value })} className={inputClass} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Kode Bank</label>
                  <input type="text" placeholder="Contoh: 014" value={bankForm.kode} onChange={(e) => setBankForm({ ...bankForm, kode: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <select value={bankForm.status} onChange={(e) => setBankForm({ ...bankForm, status: e.target.value })} className={selectClass}>
                    <option value="Aktif">Aktif</option>
                    <option value="Tidak Aktif">Tidak Aktif</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowBankForm(false)}>Batal</Button>
              <Button size="sm" icon={editingBankId ? Check : Plus} onClick={handleSaveBank} disabled={!bankForm.nama.trim()}>
                {editingBankId ? "Simpan" : "Tambah Bank"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ DELETE CONFIRM DIALOG ═══ */}
      {deleteConfirm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-7 h-7 text-danger" />
              </div>
              <h3 className="text-base font-bold text-foreground">Hapus {{ level: "Level", jabatan: "Jabatan", divisi: "Divisi", "titik-absen": "Titik Absen", "waktu-kerja": "Waktu Kerja", bank: "Bank" }[deleteConfirm.type]}?</h3>
              <p className="text-sm text-muted-foreground mt-2">
                <span className="font-semibold text-foreground">&ldquo;{deleteConfirm.nama}&rdquo;</span> akan dihapus permanen dan tidak dapat dikembalikan.
              </p>
            </div>
            <div className="flex items-center gap-3 px-6 pb-6">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)}>Batal</Button>
              <Button variant="danger" size="sm" icon={Trash2} className="flex-1" onClick={() => {
                if (deleteConfirm.type === "level") handleDeleteLevel(deleteConfirm.id);
                else if (deleteConfirm.type === "jabatan") handleDeleteJabatan(deleteConfirm.id);
                else if (deleteConfirm.type === "divisi") handleDeleteDivision(deleteConfirm.id);
                else if (deleteConfirm.type === "titik-absen") handleDeleteLocation(deleteConfirm.id);
                else if (deleteConfirm.type === "waktu-kerja") handleDeleteSchedule(deleteConfirm.id);
                else handleDeleteBank(deleteConfirm.id);
              }}>Hapus</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}
