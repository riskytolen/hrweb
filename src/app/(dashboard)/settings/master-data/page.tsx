"use client";

import { useState, useEffect, useRef } from "react";
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
  CircleDollarSign,
  Tag,
  ArrowUpDown,
  GripVertical,
  CircleCheckBig,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Scale,
  CalendarDays,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import { cn, generateDivisionColor, toTitleCase, toUpperTrim } from "@/lib/utils";
import Portal from "@/components/ui/Portal";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { supabase, type DbLevel, type DbJabatan, type DbBank, type DbDivision, type DbAttendanceLocation, type DbDivisionLocationAssignment, type DbDivisionSchedule, type DbPointRate, type DbDeliveryStatus, type DbAttendancePenaltyRate, type DbLegalSetting } from "@/lib/supabase";

// ─── Types ───
type Level = DbLevel;
type Jabatan = DbJabatan & { levelNama?: string };
type Bank = DbBank;
type Division = DbDivision;
type AttendanceLocation = DbAttendanceLocation & { divisionNames?: string[] };
type DivisionSchedule = DbDivisionSchedule & { divisionNama?: string };
type PointRate = DbPointRate & { divisionNama?: string };
type DeliveryStatus = DbDeliveryStatus;
type PenaltyRate = DbAttendancePenaltyRate & { divisionNama?: string };

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const selectClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none text-foreground";

// ─── Tabs config ───
const tabs = [
  { key: "level", label: "Level", icon: Layers },
  { key: "jabatan", label: "Jabatan", icon: Briefcase },
  { key: "divisi", label: "Divisi", icon: Building2 },
  { key: "titik-absen", label: "Titik Absen", icon: MapPin },
  { key: "waktu-kerja", label: "Waktu Kerja", icon: Clock },
  { key: "denda-telat", label: "Denda Telat", icon: AlertTriangle },
  { key: "harga-titik", label: "Harga Titik", icon: CircleDollarSign },
  { key: "status-titik", label: "Status Titik", icon: Tag },
  { key: "bank", label: "Bank", icon: Landmark },
  { key: "legal", label: "Legal", icon: Scale },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const MASTER_PAGE_SIZE = 10;

export default function MasterDataPage() {
  const { isSuperAdmin, getPermissionLevel } = useAuth();
  const permLevel = isSuperAdmin ? "edit" as const : getPermissionLevel("settings");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const [activeTab, setActiveTab] = useState<TabKey>("level");
  const [masterPage, setMasterPage] = useState(1);

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
  const [divisionForm, setDivisionForm] = useState({ nama: "", deskripsi: "", color: "#3b82f6", status: "Aktif" });

  // ─── Titik Absen State ───
  const [locationList, setLocationList] = useState<AttendanceLocation[]>([]);
  const [locationSearch, setLocationSearch] = useState("");
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [locationForm, setLocationForm] = useState({ nama: "", latitude: "", longitude: "", radius: "100", division_ids: [] as number[], status: "Aktif" });
  const [locationDivSearch, setLocationDivSearch] = useState("");

  // ─── Waktu Kerja State ───
  const [scheduleList, setScheduleList] = useState<DivisionSchedule[]>([]);
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ division_id: 0, jam_masuk: "08:00", jam_pulang: "17:00", toleransi_menit: "15", status: "Aktif" });
  const [scheduleErrors, setScheduleErrors] = useState<Set<string>>(new Set());

  // ─── Denda Telat State ───
  const [penaltyList, setPenaltyList] = useState<PenaltyRate[]>([]);
  const [penaltySearch, setPenaltySearch] = useState("");
  const [showPenaltyForm, setShowPenaltyForm] = useState(false);
  const [editingPenaltyId, setEditingPenaltyId] = useState<number | null>(null);
  const [penaltyForm, setPenaltyForm] = useState<{ division_ids: number[]; denda_per_menit: string; batas_menit: string; denda_maksimum: string; denda_alpha: string; status: string }>({ division_ids: [], denda_per_menit: "3000", batas_menit: "20", denda_maksimum: "60000", denda_alpha: "100000", status: "Aktif" });

  // ─── Harga Titik State ───
  type RateRow = { division_id: number; divisionNama: string; driverRate: number | null; driverRateId: number | null; helperRate: number | null; helperRateId: number | null };
  const [rateRows, setRateRows] = useState<RateRow[]>([]);
  const [rateSearch, setRateSearch] = useState("");
  const [showRateForm, setShowRateForm] = useState(false);
  const [editingRateDivId, setEditingRateDivId] = useState<number | null>(null);
  const [rateForm, setRateForm] = useState({ division_id: 0, driver_rate: "", helper_rate: "" });

  // ─── Status Titik State ───
  const [dStatusList, setDStatusList] = useState<DeliveryStatus[]>([]);
  const [dStatusSearch, setDStatusSearch] = useState("");
  const [showDStatusForm, setShowDStatusForm] = useState(false);
  const [editingDStatusId, setEditingDStatusId] = useState<number | null>(null);
  const [dStatusForm, setDStatusForm] = useState({ nama: "", kode: "", color: "#6b7280", status: "Aktif" });

  // ─── Legal Settings State ───
  const [legalSettings, setLegalSettings] = useState<DbLegalSetting[]>([]);
  const [editingLegalSettingId, setEditingLegalSettingId] = useState<number | null>(null);
  const [legalSettingForm, setLegalSettingForm] = useState({ masa_berlaku_bulan: "", keterangan: "" });
  const [showLegalSettingForm, setShowLegalSettingForm] = useState(false);
  // Company settings
  type CompanySetting = { id: number; kode: string; nilai: string; label: string; kategori: string };
  const [companySettings, setCompanySettings] = useState<CompanySetting[]>([]);
  const [editingCompanyId, setEditingCompanyId] = useState<number | null>(null);
  const [companyForm, setCompanyForm] = useState({ nilai: "" });
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  // Leave settings
  type LeaveSetting = { id: number; kuota_cuti_tahunan: number; maks_hari_per_pengajuan: number; tahun_berlaku: number; prorata: boolean; keterangan: string | null };
  const [leaveSetting, setLeaveSetting] = useState<LeaveSetting | null>(null);
  const [showLeaveSettingForm, setShowLeaveSettingForm] = useState(false);
  const [leaveSettingForm, setLeaveSettingForm] = useState({ kuota_cuti_tahunan: "12", maks_hari_per_pengajuan: "3", prorata: true });

  // ─── Delete Confirm Dialog ───
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "level" | "jabatan" | "divisi" | "titik-absen" | "waktu-kerja" | "denda-telat" | "harga-titik" | "status-titik" | "bank"; id: number; nama: string } | null>(null);

  const [toast, setToast] = useState<{ show: boolean; title: string; message: string }>({ show: false, title: "", message: "" });
  const [loading, setLoading] = useState(true);
  const tabScrollRef = useRef<HTMLDivElement>(null);

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
    const { data: locs } = await supabase.from("attendance_locations").select("*").order("nama");
    const { data: assigns } = await supabase.from("division_location_assignments").select("*, divisions(nama)");
    if (locs) {
      setLocationList(locs.map((l) => ({
        ...l,
        divisionNames: (assigns || []).filter((a) => a.location_id === l.id).map((a) => a.divisions?.nama || "-"),
      })));
    }
  };

  const fetchSchedules = async () => {
    const { data } = await supabase.from("division_schedules").select("*, divisions(nama)").order("division_id");
    if (data) setScheduleList(data.map((s) => ({ ...s, divisionNama: s.divisions?.nama || "-" })));
  };

  const fetchRates = async () => {
    const { data } = await supabase.from("point_rates").select("*, divisions(nama)").order("division_id");
    if (data) {
      // Group by division_id into rows with driver + helper
      const map = new Map<number, RateRow>();
      data.forEach((r) => {
        if (!map.has(r.division_id)) {
          map.set(r.division_id, { division_id: r.division_id, divisionNama: r.divisions?.nama || "-", driverRate: null, driverRateId: null, helperRate: null, helperRateId: null });
        }
        const row = map.get(r.division_id)!;
        if (r.role === "Driver") { row.driverRate = r.rate_per_point; row.driverRateId = r.id; }
        else { row.helperRate = r.rate_per_point; row.helperRateId = r.id; }
      });
      setRateRows(Array.from(map.values()));
    }
  };

  const fetchDStatuses = async () => {
    const { data } = await supabase.from("delivery_statuses").select("*").order("nama");
    if (data) setDStatusList(data);
  };

  const fetchPenalties = async () => {
    const { data } = await supabase.from("attendance_penalty_rates").select("*, divisions(nama)").order("division_id");
    if (data) setPenaltyList(data.map((p) => ({ ...p, divisionNama: p.divisions?.nama || "-" })));
  };

  useEffect(() => {
    Promise.all([fetchLevels(), fetchJabatan(), fetchBanks(), fetchDivisions(), fetchLocations(), fetchSchedules(), fetchRates(), fetchDStatuses(), fetchPenalties(), fetchLegalSettings(), fetchCompanySettings(), fetchLeaveSettings()]).then(() => setLoading(false));
  }, []);

  // Lock body scroll when any modal is open
  useEffect(() => {
    if (showLevelForm || showJabatanForm || showBankForm || showDivisionForm || showLocationForm || showScheduleForm || showRateForm || showDStatusForm || showPenaltyForm || showLegalSettingForm || showCompanyForm || showLeaveSettingForm) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [showLevelForm, showJabatanForm, showBankForm, showDivisionForm, showLocationForm, showScheduleForm, showRateForm, showDStatusForm]);

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
    const cleanNama = toTitleCase(levelForm.nama.trim());
    if (editingLevelId !== null) {
      await supabase.from("levels").update({ nama: cleanNama, urutan: levelForm.urutan, status: levelForm.status }).eq("id", editingLevelId);
      showSuccess("Level Diperbarui", `Data level "${cleanNama}" telah disimpan.`);
    } else {
      await supabase.from("levels").insert({ nama: cleanNama, urutan: levelForm.urutan, status: levelForm.status });
      showSuccess("Level Ditambahkan", `Level "${cleanNama}" berhasil ditambahkan ke sistem.`);
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
    const cleanNama = toTitleCase(jabatanForm.nama.trim());
    if (editingJabatanId !== null) {
      await supabase.from("jabatan").update({ nama: cleanNama, deskripsi: jabatanForm.deskripsi || null, level_id: jabatanForm.level_id, status: jabatanForm.status }).eq("id", editingJabatanId);
      showSuccess("Jabatan Diperbarui", `Data jabatan "${cleanNama}" telah disimpan.`);
    } else {
      await supabase.from("jabatan").insert({ nama: cleanNama, deskripsi: jabatanForm.deskripsi || null, level_id: jabatanForm.level_id, status: jabatanForm.status });
      showSuccess("Jabatan Ditambahkan", `Jabatan "${cleanNama}" berhasil ditambahkan ke sistem.`);
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
    const autoColor = generateDivisionColor(divisionList.map((d) => d.color));
    setDivisionForm({ nama: "", deskripsi: "", color: autoColor, status: "Aktif" });
    setEditingDivisionId(null);
    setShowDivisionForm(true);
  };
  const handleOpenEditDivision = (d: Division) => {
    setDivisionForm({ nama: d.nama, deskripsi: d.deskripsi || "", color: d.color || "#3b82f6", status: d.status });
    setEditingDivisionId(d.id);
    setShowDivisionForm(true);
  };
  const handleSaveDivision = async () => {
    if (!divisionForm.nama.trim()) return;
    const cleanNama = toTitleCase(divisionForm.nama.trim());
    if (editingDivisionId !== null) {
      await supabase.from("divisions").update({ nama: cleanNama, deskripsi: divisionForm.deskripsi || null, color: divisionForm.color, status: divisionForm.status }).eq("id", editingDivisionId);
      showSuccess("Divisi Diperbarui", `Data divisi "${cleanNama}" telah disimpan.`);
    } else {
      await supabase.from("divisions").insert({ nama: cleanNama, deskripsi: divisionForm.deskripsi || null, color: divisionForm.color, status: divisionForm.status });
      showSuccess("Divisi Ditambahkan", `Divisi "${cleanNama}" berhasil ditambahkan ke sistem.`);
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
    l.nama.toLowerCase().includes(locationSearch.toLowerCase()) ||
    (l.divisionNames || []).some((d) => d.toLowerCase().includes(locationSearch.toLowerCase()))
  );
  const activeDivisions = divisionList.filter((d) => d.status === "Aktif");

  const handleOpenAddLocation = () => {
    setLocationForm({ nama: "", latitude: "", longitude: "", radius: "100", division_ids: [], status: "Aktif" });
    setLocationDivSearch("");
    setEditingLocationId(null);
    setShowLocationForm(true);
  };
  const handleOpenEditLocation = async (l: AttendanceLocation) => {
    const { data: assigns } = await supabase.from("division_location_assignments").select("division_id").eq("location_id", l.id);
    setLocationForm({ nama: l.nama, latitude: String(l.latitude), longitude: String(l.longitude), radius: String(l.radius), division_ids: assigns?.map((a) => a.division_id) || [], status: l.status });
    setLocationDivSearch("");
    setEditingLocationId(l.id);
    setShowLocationForm(true);
  };
  const handleSaveLocation = async () => {
    if (!locationForm.nama.trim() || !locationForm.latitude || !locationForm.longitude) return;
    const cleanNama = toTitleCase(locationForm.nama.trim());
    const locPayload = { nama: cleanNama, latitude: parseFloat(locationForm.latitude), longitude: parseFloat(locationForm.longitude), radius: parseInt(locationForm.radius) || 100, status: locationForm.status };

    let locationId = editingLocationId;
    if (editingLocationId !== null) {
      await supabase.from("attendance_locations").update(locPayload).eq("id", editingLocationId);
    } else {
      const { data } = await supabase.from("attendance_locations").insert(locPayload).select("id").single();
      locationId = data?.id || null;
    }

    if (locationId) {
      // Sync division assignments: hapus semua lalu insert ulang
      await supabase.from("division_location_assignments").delete().eq("location_id", locationId);
      if (locationForm.division_ids.length > 0) {
        await supabase.from("division_location_assignments").insert(
          locationForm.division_ids.map((did) => ({ division_id: did, location_id: locationId }))
        );
      }
    }

    showSuccess(editingLocationId ? "Titik Absen Diperbarui" : "Titik Absen Ditambahkan", `Lokasi "${locationForm.nama}" telah disimpan.`);
    setShowLocationForm(false);
    fetchLocations();
  };
  const handleDeleteLocation = async (id: number) => {
    await supabase.from("attendance_locations").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Titik Absen Dihapus", "Data lokasi telah dihapus dari sistem.");
    fetchLocations();
  };
  const handleToggleLocationStatus = async (id: number) => {
    const loc = locationList.find((l) => l.id === id);
    if (!loc) return;
    await supabase.from("attendance_locations").update({ status: loc.status === "Aktif" ? "Tidak Aktif" : "Aktif" }).eq("id", id);
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
    setScheduleErrors(new Set());
    setEditingScheduleId(null);
    setShowScheduleForm(true);
  };
  const handleOpenEditSchedule = (s: DivisionSchedule) => {
    setScheduleForm({ division_id: s.division_id, jam_masuk: s.jam_masuk.slice(0, 5), jam_pulang: s.jam_pulang ? s.jam_pulang.slice(0, 5) : "", toleransi_menit: String(s.toleransi_menit), status: s.status });
    setScheduleErrors(new Set());
    setEditingScheduleId(s.id);
    setShowScheduleForm(true);
  };
  const handleSaveSchedule = async () => {
    // Validasi mandatory
    const errs = new Set<string>();
    if (!scheduleForm.division_id) errs.add("division_id");
    if (!scheduleForm.jam_masuk) errs.add("jam_masuk");
    if (errs.size > 0) {
      setScheduleErrors(errs);
      return;
    }
    setScheduleErrors(new Set());
    const payload = { division_id: scheduleForm.division_id, jam_masuk: scheduleForm.jam_masuk, jam_pulang: scheduleForm.jam_pulang || null, toleransi_menit: parseInt(scheduleForm.toleransi_menit) || 0, status: scheduleForm.status };
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

  // ─── Denda Telat Handlers ───
  const filteredPenalties = penaltyList.filter((p) =>
    (p.divisionNama || "").toLowerCase().includes(penaltySearch.toLowerCase())
  );
  const divisionsWithoutPenalty = activeDivisions.filter((d) => !penaltyList.some((p) => p.division_id === d.id));

  const handleOpenAddPenalty = () => {
    setPenaltyForm({ division_ids: divisionsWithoutPenalty.length > 0 ? [divisionsWithoutPenalty[0].id] : [], denda_per_menit: "3000", batas_menit: "20", denda_maksimum: "60000", denda_alpha: "100000", status: "Aktif" });
    setEditingPenaltyId(null);
    setShowPenaltyForm(true);
  };

  const handleOpenEditPenalty = (p: PenaltyRate) => {
    setPenaltyForm({ division_ids: [p.division_id], denda_per_menit: String(p.denda_per_menit), batas_menit: String(p.batas_menit), denda_maksimum: String(p.denda_maksimum), denda_alpha: String(p.denda_alpha), status: p.status });
    setEditingPenaltyId(p.id);
    setShowPenaltyForm(true);
  };

  const handleSavePenalty = async () => {
    if (penaltyForm.division_ids.length === 0) return;
    
    if (editingPenaltyId) {
      const payload = {
        division_id: penaltyForm.division_ids[0],
        denda_per_menit: parseInt(penaltyForm.denda_per_menit) || 3000,
        batas_menit: parseInt(penaltyForm.batas_menit) || 20,
        denda_maksimum: parseInt(penaltyForm.denda_maksimum) || 60000,
        denda_alpha: parseInt(penaltyForm.denda_alpha) || 100000,
        status: penaltyForm.status,
      };
      await supabase.from("attendance_penalty_rates").update(payload).eq("id", editingPenaltyId);
      showSuccess("Denda Diperbarui", "Data denda telat telah disimpan.");
    } else {
      const payloads = penaltyForm.division_ids.map(divId => ({
        division_id: divId,
        denda_per_menit: parseInt(penaltyForm.denda_per_menit) || 3000,
        batas_menit: parseInt(penaltyForm.batas_menit) || 20,
        denda_maksimum: parseInt(penaltyForm.denda_maksimum) || 60000,
        denda_alpha: parseInt(penaltyForm.denda_alpha) || 100000,
        status: penaltyForm.status,
      }));
      await supabase.from("attendance_penalty_rates").insert(payloads);
      showSuccess("Denda Ditambahkan", `Denda telat untuk ${penaltyForm.division_ids.length} divisi telah ditambahkan.`);
    }
    setShowPenaltyForm(false);
    fetchPenalties();
  };

  const handleDeletePenalty = async (id: number) => {
    await supabase.from("attendance_penalty_rates").delete().eq("id", id);
    setDeleteConfirm(null);
    fetchPenalties();
    setToast({ show: true, title: "Denda Dihapus", message: "" });
  };

  const handleTogglePenaltyStatus = async (id: number) => {
    const p = penaltyList.find((x) => x.id === id);
    if (!p) return;
    await supabase.from("attendance_penalty_rates").update({ status: p.status === "Aktif" ? "Tidak Aktif" : "Aktif" }).eq("id", id);
    fetchPenalties();
  };

  // ─── Harga Titik Handlers ───
  const filteredRateRows = rateRows.filter((r) =>
    r.divisionNama.toLowerCase().includes(rateSearch.toLowerCase())
  );
  const divisionsWithoutRate = activeDivisions.filter((d) => !rateRows.some((r) => r.division_id === d.id));

  const handleOpenAddRate = () => {
    setRateForm({ division_id: divisionsWithoutRate[0]?.id || 0, driver_rate: "", helper_rate: "" });
    setEditingRateDivId(null);
    setShowRateForm(true);
  };
  const handleOpenEditRate = (row: RateRow) => {
    setRateForm({ division_id: row.division_id, driver_rate: row.driverRate !== null ? String(row.driverRate) : "", helper_rate: row.helperRate !== null ? String(row.helperRate) : "" });
    setEditingRateDivId(row.division_id);
    setShowRateForm(true);
  };
  const handleSaveRate = async () => {
    if (!rateForm.division_id) return;
    if (!rateForm.driver_rate && !rateForm.helper_rate) return;
    const divNama = divisionList.find((d) => d.id === rateForm.division_id)?.nama || "";

    // Upsert Driver rate
    if (rateForm.driver_rate) {
      const existing = rateRows.find((r) => r.division_id === rateForm.division_id);
      if (existing?.driverRateId) {
        await supabase.from("point_rates").update({ rate_per_point: parseInt(rateForm.driver_rate) || 0 }).eq("id", existing.driverRateId);
      } else {
        await supabase.from("point_rates").insert({ division_id: rateForm.division_id, role: "Driver", rate_per_point: parseInt(rateForm.driver_rate) || 0 });
      }
    }
    // Upsert Helper rate
    if (rateForm.helper_rate) {
      const existing = rateRows.find((r) => r.division_id === rateForm.division_id);
      if (existing?.helperRateId) {
        await supabase.from("point_rates").update({ rate_per_point: parseInt(rateForm.helper_rate) || 0 }).eq("id", existing.helperRateId);
      } else {
        await supabase.from("point_rates").insert({ division_id: rateForm.division_id, role: "Helper", rate_per_point: parseInt(rateForm.helper_rate) || 0 });
      }
    }

    showSuccess(editingRateDivId ? "Harga Titik Diperbarui" : "Harga Titik Ditambahkan", `Tarif divisi "${divNama}" telah disimpan.`);
    setShowRateForm(false);
    fetchRates();
  };
  const handleDeleteRate = async (id: number) => {
    // Delete both driver & helper rates for this division
    const row = rateRows.find((r) => r.division_id === id);
    if (row?.driverRateId) await supabase.from("point_rates").delete().eq("id", row.driverRateId);
    if (row?.helperRateId) await supabase.from("point_rates").delete().eq("id", row.helperRateId);
    setDeleteConfirm(null);
    showSuccess("Harga Titik Dihapus", "Data tarif divisi telah dihapus dari sistem.");
    fetchRates();
  };

  // ─── Status Titik Handlers ───
  const filteredDStatuses = dStatusList.filter((s) => s.nama.toLowerCase().includes(dStatusSearch.toLowerCase()) || s.kode.toLowerCase().includes(dStatusSearch.toLowerCase()));

  const handleOpenAddDStatus = () => {
    setDStatusForm({ nama: "", kode: "", color: "#6b7280", status: "Aktif" });
    setEditingDStatusId(null);
    setShowDStatusForm(true);
  };
  const handleOpenEditDStatus = (s: DeliveryStatus) => {
    setDStatusForm({ nama: s.nama, kode: s.kode, color: s.color || "#6b7280", status: s.status });
    setEditingDStatusId(s.id);
    setShowDStatusForm(true);
  };
  const handleSaveDStatus = async () => {
    if (!dStatusForm.nama.trim() || !dStatusForm.kode.trim()) return;
    const cleanNama = toTitleCase(dStatusForm.nama.trim());
    const payload = { nama: cleanNama, kode: dStatusForm.kode.toUpperCase(), color: dStatusForm.color, status: dStatusForm.status };
    if (editingDStatusId !== null) {
      await supabase.from("delivery_statuses").update(payload).eq("id", editingDStatusId);
      showSuccess("Status Diperbarui", `Status "${cleanNama}" telah disimpan.`);
    } else {
      await supabase.from("delivery_statuses").insert(payload);
      showSuccess("Status Ditambahkan", `Status "${cleanNama}" berhasil ditambahkan.`);
    }
    setShowDStatusForm(false);
    fetchDStatuses();
  };
  const handleDeleteDStatus = async (id: number) => {
    await supabase.from("delivery_statuses").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Status Dihapus", "Data status telah dihapus.");
    fetchDStatuses();
  };
  const handleToggleDStatusStatus = async (id: number) => {
    const s = dStatusList.find((s) => s.id === id);
    if (!s) return;
    await supabase.from("delivery_statuses").update({ status: s.status === "Aktif" ? "Tidak Aktif" : "Aktif" }).eq("id", id);
    fetchDStatuses();
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
    const cleanNama = toUpperTrim(bankForm.nama.trim());
    if (editingBankId !== null) {
      await supabase.from("banks").update({ nama: cleanNama, kode: bankForm.kode || null, status: bankForm.status }).eq("id", editingBankId);
      showSuccess("Bank Diperbarui", `Data bank "${cleanNama}" telah disimpan.`);
    } else {
      await supabase.from("banks").insert({ nama: cleanNama, kode: bankForm.kode || null, status: bankForm.status });
      showSuccess("Bank Ditambahkan", `Bank "${cleanNama}" berhasil ditambahkan ke sistem.`);
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

  // ─── Masa Berlaku Legal Handlers ───
  const fetchLegalSettings = async () => {
    const { data } = await supabase.from("legal_settings").select("*").order("id");
    if (data) setLegalSettings(data);
  };

  const handleOpenEditLegalSetting = (s: DbLegalSetting) => {
    setLegalSettingForm({ masa_berlaku_bulan: String(s.masa_berlaku_bulan), keterangan: s.keterangan || "" });
    setEditingLegalSettingId(s.id);
    setShowLegalSettingForm(true);
  };

  const handleSaveLegalSetting = async () => {
    if (!editingLegalSettingId) return;
    const bulan = parseInt(legalSettingForm.masa_berlaku_bulan) || 1;
    await supabase.from("legal_settings").update({
      masa_berlaku_bulan: bulan,
      keterangan: legalSettingForm.keterangan.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", editingLegalSettingId);
    showSuccess("Pengaturan Diperbarui", `Masa berlaku berhasil diubah menjadi ${bulan} bulan.`);
    setShowLegalSettingForm(false);
    fetchLegalSettings();
  };

  // ─── Company Settings Handlers ───
  const fetchCompanySettings = async () => {
    const { data } = await supabase.from("company_settings").select("*").order("id");
    if (data) setCompanySettings(data);
  };

  const handleOpenEditCompany = (s: CompanySetting) => {
    setCompanyForm({ nilai: s.nilai });
    setEditingCompanyId(s.id);
    setShowCompanyForm(true);
  };

  const handleSaveCompany = async () => {
    if (!editingCompanyId) return;
    await supabase.from("company_settings").update({
      nilai: companyForm.nilai.trim(),
      updated_at: new Date().toISOString(),
    }).eq("id", editingCompanyId);
    showSuccess("Pengaturan Diperbarui", "Data perusahaan berhasil disimpan.");
    setShowCompanyForm(false);
    fetchCompanySettings();
  };

  // ─── Leave Settings Handlers ───
  const fetchLeaveSettings = async () => {
    const { data } = await supabase.from("leave_settings").select("*").order("id", { ascending: false }).limit(1).single();
    if (data) setLeaveSetting(data);
  };

  const handleOpenEditLeave = () => {
    if (!leaveSetting) return;
    setLeaveSettingForm({ kuota_cuti_tahunan: String(leaveSetting.kuota_cuti_tahunan), maks_hari_per_pengajuan: String(leaveSetting.maks_hari_per_pengajuan), prorata: leaveSetting.prorata });
    setShowLeaveSettingForm(true);
  };

  const handleSaveLeave = async () => {
    if (!leaveSetting) return;
    const kuota = parseInt(leaveSettingForm.kuota_cuti_tahunan) || 12;
    const maks = parseInt(leaveSettingForm.maks_hari_per_pengajuan) || 3;
    await supabase.from("leave_settings").update({
      kuota_cuti_tahunan: kuota,
      maks_hari_per_pengajuan: maks,
      prorata: leaveSettingForm.prorata,
      updated_at: new Date().toISOString(),
    }).eq("id", leaveSetting.id);
    showSuccess("Pengaturan Cuti Diperbarui", `Kuota: ${kuota} hari/tahun, Maks per pengajuan: ${maks} hari.`);
    setShowLeaveSettingForm(false);
    fetchLeaveSettings();
  };

  return (
    <RouteGuard permission="settings">
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
        <div className="relative border-b border-border bg-muted/30">
          <button onClick={() => tabScrollRef.current?.scrollBy({ left: -200, behavior: "smooth" })}
            className="absolute left-0 top-0 bottom-0 z-10 w-8 flex items-center justify-center bg-gradient-to-r from-muted/80 to-transparent text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div ref={tabScrollRef} className="overflow-x-auto scrollbar-none mx-8">
            <div className="flex items-center min-w-max">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.key;
                const Icon = tab.icon;
                const count = tab.key === "level" ? levelList.length : tab.key === "jabatan" ? jabatanList.length : tab.key === "divisi" ? divisionList.length : tab.key === "titik-absen" ? locationList.length : tab.key === "waktu-kerja" ? scheduleList.length : tab.key === "denda-telat" ? penaltyList.length : tab.key === "harga-titik" ? rateRows.length : tab.key === "status-titik" ? dStatusList.length : tab.key === "legal" ? (legalSettings.length + companySettings.length) : bankList.length;
                return (
                  <button
                    key={tab.key}
                    onClick={() => { setActiveTab(tab.key); setMasterPage(1); }}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 -mb-px whitespace-nowrap flex-shrink-0 transition-colors",
                      isActive
                        ? "border-primary text-primary bg-card"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                    <span className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded-md",
                      isActive ? "bg-primary-light text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={() => tabScrollRef.current?.scrollBy({ left: 200, behavior: "smooth" })}
            className="absolute right-0 top-0 bottom-0 z-10 w-8 flex items-center justify-center bg-gradient-to-l from-muted/80 to-transparent text-muted-foreground hover:text-foreground">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* ─── TAB: LEVEL ─── */}
        {activeTab === "level" && (
          <>
            {/* Toolbar */}
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari level..." value={levelSearch} onChange={(e) => { setLevelSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddLevel}>Tambah Level</Button>}
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
                  ) : filteredLevels.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((level) => (
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
                          {canEdit && <button onClick={() => handleOpenEditLevel(level)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "level", id: level.id, nama: level.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredLevels.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: JABATAN ─── */}
        {activeTab === "jabatan" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari jabatan atau level..." value={jabatanSearch} onChange={(e) => { setJabatanSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddJabatan}>Tambah Jabatan</Button>}
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
                  ) : filteredJabatan.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((jabatan, idx) => (
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
                          {canEdit && <button onClick={() => handleOpenEditJabatan(jabatan)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "jabatan", id: jabatan.id, nama: jabatan.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredJabatan.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: DIVISI ─── */}
        {activeTab === "divisi" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari divisi..." value={divisionSearch} onChange={(e) => { setDivisionSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddDivision}>Tambah Divisi</Button>}
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
                  ) : filteredDivisions.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((division, idx) => (
                    <tr key={division.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: division.color || "#3b82f6" }} />
                          <p className="text-sm font-semibold text-foreground">{division.nama}</p>
                        </div>
                      </td>
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
                          {canEdit && <button onClick={() => handleOpenEditDivision(division)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "divisi", id: division.id, nama: division.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredDivisions.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: TITIK ABSEN ─── */}
        {activeTab === "titik-absen" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari lokasi atau divisi..." value={locationSearch} onChange={(e) => { setLocationSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddLocation}>Tambah Lokasi</Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Lokasi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Divisi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Koordinat</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Radius</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={7} />
                  ) : filteredLocations.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Tidak ada titik absen ditemukan</td></tr>
                  ) : filteredLocations.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((loc, idx) => (
                    <tr key={loc.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{loc.nama}</p></td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {(loc.divisionNames || []).length > 0 ? loc.divisionNames!.map((d, i) => (
                            <span key={i} className="text-[11px] font-medium text-accent bg-accent-light px-2 py-0.5 rounded-md">{d}</span>
                          )) : <span className="text-xs text-muted-foreground italic">-</span>}
                        </div>
                      </td>
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
                          {canEdit && <button onClick={() => handleOpenEditLocation(loc)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "titik-absen", id: loc.id, nama: loc.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredLocations.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: WAKTU KERJA ─── */}
        {activeTab === "waktu-kerja" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari divisi..." value={scheduleSearch} onChange={(e) => { setScheduleSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddSchedule} disabled={divisionsWithoutSchedule.length === 0}>
                {divisionsWithoutSchedule.length === 0 ? "Semua Divisi Sudah Ada" : "Tambah Jadwal"}
              </Button>}
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
                  ) : filteredSchedules.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((sch, idx) => (
                    <tr key={sch.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><span className="text-sm font-semibold text-foreground">{sch.divisionNama}</span></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono bg-primary-light text-primary px-2 py-1 rounded-md">{sch.jam_masuk.slice(0, 5)}</span></td>
                      <td className="px-5 py-3.5">{sch.jam_pulang ? <span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded-md">{sch.jam_pulang.slice(0, 5)}</span> : <span className="text-xs text-muted-foreground italic">-</span>}</td>
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
                          {canEdit && <button onClick={() => handleOpenEditSchedule(sch)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "waktu-kerja", id: sch.id, nama: sch.divisionNama || "" })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredSchedules.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: DENDA TELAT ─── */}
        {activeTab === "denda-telat" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari divisi..." value={penaltySearch} onChange={(e) => { setPenaltySearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddPenalty} disabled={divisionsWithoutPenalty.length === 0}>Tambah Denda</Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-10">#</th>
                    <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Divisi</th>
                    <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-32">Denda/Menit</th>
                    <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Batas Menit</th>
                    <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-36">Denda Maksimum</th>
                    <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-32">Denda Alpha</th>
                    <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Status</th>
                    <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-24">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? <SkeletonTable rows={4} cols={8} /> : filteredPenalties.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">Belum ada data denda</td></tr>
                  ) : filteredPenalties.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((p, idx) => (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 text-xs text-muted-foreground">{(masterPage - 1) * MASTER_PAGE_SIZE + idx + 1}</td>
                      <td className="px-5 py-3 text-sm font-semibold text-foreground">{p.divisionNama}</td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-foreground">Rp {p.denda_per_menit.toLocaleString("id-ID")}</td>
                      <td className="px-5 py-3 text-center text-sm text-foreground">{p.batas_menit} menit</td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-foreground">Rp {p.denda_maksimum.toLocaleString("id-ID")}</td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-foreground">Rp {p.denda_alpha.toLocaleString("id-ID")}</td>
                      <td className="px-5 py-3 text-center">
                        <button onClick={() => handleTogglePenaltyStatus(p.id)}
                          className={cn("text-[10px] font-bold px-2 py-1 rounded-md cursor-pointer", p.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          {p.status}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && <button onClick={() => handleOpenEditPenalty(p)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "denda-telat", id: p.id, nama: p.divisionNama || "-" })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredPenalties.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: HARGA TITIK ─── */}
        {activeTab === "harga-titik" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari divisi..." value={rateSearch} onChange={(e) => { setRateSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddRate} disabled={divisionsWithoutRate.length === 0}>
                {divisionsWithoutRate.length === 0 ? "Semua Divisi Sudah Ada" : "Tambah Harga Titik"}
              </Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Divisi</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">
                      <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />Driver / Titik</span>
                    </th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">
                      <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" />Helper / Titik</span>
                    </th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={5} />
                  ) : filteredRateRows.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data harga titik ditemukan</td></tr>
                  ) : filteredRateRows.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((row, idx) => (
                    <tr key={row.division_id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><span className="text-sm font-semibold text-foreground">{row.divisionNama}</span></td>
                      <td className="px-5 py-3.5 text-right">
                        {row.driverRate !== null
                          ? <span className="text-sm font-bold text-blue-600">Rp {row.driverRate.toLocaleString("id-ID")}</span>
                          : <span className="text-xs text-muted-foreground italic">Belum diatur</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {row.helperRate !== null
                          ? <span className="text-sm font-bold text-orange-600">Rp {row.helperRate.toLocaleString("id-ID")}</span>
                          : <span className="text-xs text-muted-foreground italic">Belum diatur</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && <button onClick={() => handleOpenEditRate(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "harga-titik", id: row.division_id, nama: row.divisionNama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredRateRows.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: STATUS TITIK ─── */}
        {activeTab === "status-titik" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari status..." value={dStatusSearch} onChange={(e) => { setDStatusSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddDStatus}>Tambah Status</Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Status</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-24">Kode</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aktif</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={3} cols={5} />
                  ) : filteredDStatuses.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada status ditemukan</td></tr>
                  ) : filteredDStatuses.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((s, idx) => (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                          <span className="text-sm font-semibold text-foreground">{s.nama}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{s.kode}</span></td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => handleToggleDStatusStatus(s.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            s.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", s.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {s.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && <button onClick={() => handleOpenEditDStatus(s)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "status-titik", id: s.id, nama: s.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredDStatuses.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: BANK ─── */}
        {activeTab === "bank" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari bank atau kode..." value={bankSearch} onChange={(e) => { setBankSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddBank}>Tambah Bank</Button>}
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
                  ) : filteredBanks.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((bank, idx) => (
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
                          {canEdit && <button onClick={() => handleOpenEditBank(bank)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "bank", id: bank.id, nama: bank.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredBanks.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ═══ TAB: LEGAL ═══ */}
        {activeTab === "legal" && (
          <>
            {/* Section: Masa Berlaku */}
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Masa Berlaku Dokumen</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Pengaturan ini digunakan saat membuat dokumen baru di menu Legal & Administrasi.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Jenis Dokumen</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-40">Masa Berlaku</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Keterangan</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={4} cols={5} />
                  ) : legalSettings.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-foreground">{s.label}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{s.kode}</p>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span className="text-sm font-bold text-primary bg-primary/10 px-3 py-1 rounded-lg">{s.masa_berlaku_bulan} bulan</span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{s.keterangan || "-"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center">
                          {canEdit && <button onClick={() => handleOpenEditLegalSetting(s)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Section: Info Perusahaan */}
            <div className="px-5 py-3 border-b border-t border-border mt-2">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Info Perusahaan & Penandatangan</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Data ini digunakan untuk generate surat PKWT dan SP.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-48">Pengaturan</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nilai</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={8} cols={4} />
                  ) : companySettings.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-foreground">{s.label}</p>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-foreground">{s.nilai || <span className="italic text-muted-foreground">Belum diisi</span>}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center">
                          {canEdit && <button onClick={() => handleOpenEditCompany(s)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Section: Kuota Cuti */}
            <div className="px-5 py-3 border-b border-t border-border mt-2">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Kuota Cuti Tahunan</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Pengaturan kuota cuti untuk semua pegawai. Reset setiap tahun.</p>
            </div>
            <div className="px-5 py-4">
              {leaveSetting ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-3 bg-primary/[0.06] border border-primary/20 rounded-xl px-4 py-3">
                    <CalendarDays className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-lg font-bold text-primary">{leaveSetting.kuota_cuti_tahunan} hari</p>
                      <p className="text-[10px] text-muted-foreground">per tahun</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-warning/[0.06] border border-warning/20 rounded-xl px-4 py-3">
                    <Clock className="w-5 h-5 text-warning" />
                    <div>
                      <p className="text-lg font-bold text-warning">{leaveSetting.maks_hari_per_pengajuan} hari</p>
                      <p className="text-[10px] text-muted-foreground">maks per pengajuan</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-4 py-3">
                    <div className={cn("w-2 h-2 rounded-full", leaveSetting.prorata ? "bg-success" : "bg-muted-foreground")} />
                    <p className="text-xs text-foreground">{leaveSetting.prorata ? "Prorata untuk pegawai baru" : "Tidak prorata"}</p>
                  </div>
                  {canEdit && (
                    <Button variant="outline" size="sm" icon={Pencil} onClick={handleOpenEditLeave}>Edit</Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Memuat...</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ═══ COMPANY SETTINGS FORM MODAL ═══ */}
      {showCompanyForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCompanyForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Pencil className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-bold text-foreground">Edit {companySettings.find((s) => s.id === editingCompanyId)?.label || ""}</h2>
              </div>
              <button onClick={() => setShowCompanyForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">{companySettings.find((s) => s.id === editingCompanyId)?.label || "Nilai"}</label>
                {(companySettings.find((s) => s.id === editingCompanyId)?.kode === "alamat") ? (
                  <textarea rows={3} value={companyForm.nilai}
                    onChange={(e) => setCompanyForm({ nilai: e.target.value })}
                    className={cn(inputClass, "resize-none")} placeholder="Isi nilai..." />
                ) : (
                  <input type="text" value={companyForm.nilai}
                    onChange={(e) => setCompanyForm({ nilai: e.target.value })}
                    className={inputClass} placeholder="Isi nilai..." autoFocus />
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
              <Button variant="outline" size="sm" onClick={() => setShowCompanyForm(false)}>Batal</Button>
              <Button size="sm" icon={Check} onClick={handleSaveCompany}>Simpan</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ LEAVE SETTINGS FORM MODAL ═══ */}
      {showLeaveSettingForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLeaveSettingForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CalendarDays className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-bold text-foreground">Edit Kuota Cuti</h2>
              </div>
              <button onClick={() => setShowLeaveSettingForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Kuota Cuti Tahunan (hari) <span className="text-danger">*</span></label>
                <input type="number" min={1} max={30} value={leaveSettingForm.kuota_cuti_tahunan}
                  onChange={(e) => setLeaveSettingForm({ ...leaveSettingForm, kuota_cuti_tahunan: e.target.value })}
                  className={inputClass} placeholder="12" />
                <p className="text-[10px] text-muted-foreground mt-1">Jumlah hari cuti yang diberikan per tahun untuk semua pegawai</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Maks Hari Per Pengajuan <span className="text-danger">*</span></label>
                <input type="number" min={1} max={30} value={leaveSettingForm.maks_hari_per_pengajuan}
                  onChange={(e) => setLeaveSettingForm({ ...leaveSettingForm, maks_hari_per_pengajuan: e.target.value })}
                  className={inputClass} placeholder="3" />
                <p className="text-[10px] text-muted-foreground mt-1">Batas maksimal hari cuti dalam satu kali pengajuan</p>
              </div>
              <div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={leaveSettingForm.prorata}
                    onChange={(e) => setLeaveSettingForm({ ...leaveSettingForm, prorata: e.target.checked })}
                    className="rounded border-border text-primary focus:ring-primary" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">Prorata untuk pegawai baru</p>
                    <p className="text-[10px] text-muted-foreground">Kuota dihitung proporsional berdasarkan bulan bergabung</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
              <Button variant="outline" size="sm" onClick={() => setShowLeaveSettingForm(false)}>Batal</Button>
              <Button size="sm" icon={Check} onClick={handleSaveLeave}>Simpan</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ MASA BERLAKU FORM MODAL ═══ */}
      {showLegalSettingForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLegalSettingForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Scale className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-bold text-foreground">Edit Masa Berlaku</h2>
              </div>
              <button onClick={() => setShowLegalSettingForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Jenis Dokumen</label>
                <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-foreground">
                  {legalSettings.find((s) => s.id === editingLegalSettingId)?.label || "-"}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Masa Berlaku (bulan) <span className="text-danger">*</span></label>
                <input type="number" min={1} max={60} value={legalSettingForm.masa_berlaku_bulan}
                  onChange={(e) => setLegalSettingForm({ ...legalSettingForm, masa_berlaku_bulan: e.target.value })}
                  className={inputClass} placeholder="12" />
                <p className="text-[10px] text-muted-foreground mt-1">Contoh: 12 = 1 tahun, 6 = 6 bulan</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Keterangan</label>
                <input type="text" value={legalSettingForm.keterangan}
                  onChange={(e) => setLegalSettingForm({ ...legalSettingForm, keterangan: e.target.value })}
                  className={inputClass} placeholder="Keterangan opsional" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
              <Button variant="outline" size="sm" onClick={() => setShowLegalSettingForm(false)}>Batal</Button>
              <Button size="sm" icon={Check} onClick={handleSaveLegalSetting}>Simpan</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ LEVEL FORM MODAL ═══ */}
      {showLevelForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLevelForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
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
                  <Select
                    value={levelForm.status}
                    onChange={(val) => setLevelForm({ ...levelForm, status: val })}
                    options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                  />
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
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
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
                  <Select
                    value={String(jabatanForm.level_id)}
                    onChange={(val) => setJabatanForm({ ...jabatanForm, level_id: parseInt(val) })}
                    options={activeLevels.map((l) => ({ value: String(l.id), label: l.nama }))}
                    placeholder="Pilih level"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <Select
                    value={jabatanForm.status}
                    onChange={(val) => setJabatanForm({ ...jabatanForm, status: val })}
                    options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                  />
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
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
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
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Divisi <span className="text-danger">*</span></label>
                  <input type="text" placeholder="Contoh: IT & Development" value={divisionForm.nama} onChange={(e) => setDivisionForm({ ...divisionForm, nama: e.target.value })} className={inputClass} autoFocus />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Warna</label>
                  <div className="relative">
                    <input
                      type="color"
                      value={divisionForm.color}
                      onChange={(e) => setDivisionForm({ ...divisionForm, color: e.target.value })}
                      className="w-10 h-10 rounded-xl border border-border cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                <input type="text" placeholder="Deskripsi singkat divisi" value={divisionForm.deskripsi} onChange={(e) => setDivisionForm({ ...divisionForm, deskripsi: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                <Select
                  value={divisionForm.status}
                  onChange={(val) => setDivisionForm({ ...divisionForm, status: val })}
                  options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                />
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
           <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingLocationId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingLocationId ? "Edit Titik Absen" : "Tambah Titik Absen"}</h2>
              </div>
              <button onClick={() => setShowLocationForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Lokasi <span className="text-danger">*</span></label>
                <input type="text" placeholder="Contoh: Kantor Pusat Jakarta" value={locationForm.nama} onChange={(e) => setLocationForm({ ...locationForm, nama: e.target.value })} className={inputClass} autoFocus />
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
                  <Select
                    value={locationForm.status}
                    onChange={(val) => setLocationForm({ ...locationForm, status: val })}
                    options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-foreground">Divisi yang Menggunakan Lokasi Ini</label>
                  {locationForm.division_ids.length > 0 && (
                    <span className="text-[10px] font-bold text-primary bg-primary-light px-2 py-0.5 rounded-md">{locationForm.division_ids.length} dipilih</span>
                  )}
                </div>
                <div className="border border-border rounded-xl overflow-hidden">
                  {activeDivisions.length > 5 && (
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                      <Search className="w-3.5 h-3.5 text-muted-foreground" />
                      <input type="text" placeholder="Cari divisi..." value={locationDivSearch} onChange={(e) => setLocationDivSearch(e.target.value)}
                        className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/50 text-foreground" />
                    </div>
                  )}
                  {activeDivisions.length > 1 && (
                    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/50">
                      <button type="button" onClick={() => setLocationForm((prev) => ({ ...prev, division_ids: activeDivisions.map((d) => d.id) }))} className="text-[10px] font-medium text-primary hover:underline">Pilih Semua</button>
                      <button type="button" onClick={() => setLocationForm((prev) => ({ ...prev, division_ids: [] }))} className="text-[10px] font-medium text-muted-foreground hover:underline">Hapus Semua</button>
                    </div>
                  )}
                  <div className="max-h-44 overflow-y-auto overscroll-contain p-1.5 space-y-0.5">
                    {activeDivisions.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic px-2 py-3 text-center">Tidak ada divisi aktif</p>
                    ) : (() => {
                      const filtered = activeDivisions.filter((d) => d.nama.toLowerCase().includes(locationDivSearch.toLowerCase()));
                      // Tampilkan yang tercentang di atas
                      const sorted = [...filtered].sort((a, b) => {
                        const aChecked = locationForm.division_ids.includes(a.id) ? 0 : 1;
                        const bChecked = locationForm.division_ids.includes(b.id) ? 0 : 1;
                        return aChecked - bChecked;
                      });
                      return sorted.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic px-2 py-3 text-center">Tidak ditemukan</p>
                      ) : sorted.map((d) => (
                        <label key={d.id} className={cn("flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors", locationForm.division_ids.includes(d.id) ? "bg-primary-light/50" : "hover:bg-muted/50")}>
                          <input
                            type="checkbox"
                            checked={locationForm.division_ids.includes(d.id)}
                            onChange={(e) => {
                              setLocationForm((prev) => ({
                                ...prev,
                                division_ids: e.target.checked
                                  ? [...prev.division_ids, d.id]
                                  : prev.division_ids.filter((id) => id !== d.id),
                              }));
                            }}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 accent-primary"
                          />
                          <span className={cn("text-sm", locationForm.division_ids.includes(d.id) ? "text-primary font-medium" : "text-foreground")}>{d.nama}</span>
                        </label>
                      ));
                    })()}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Satu lokasi bisa dipakai banyak divisi.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30 rounded-b-2xl flex-shrink-0">
              <Button variant="outline" size="sm" onClick={() => setShowLocationForm(false)}>Batal</Button>
              <Button size="sm" icon={editingLocationId ? Check : Plus} onClick={handleSaveLocation} disabled={!locationForm.nama.trim() || !locationForm.latitude || !locationForm.longitude}>
                {editingLocationId ? "Simpan" : "Tambah Lokasi"}
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
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
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
              {scheduleErrors.size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                  <X className="w-3.5 h-3.5 flex-shrink-0" />
                  Harap lengkapi field yang wajib diisi
                </div>
              )}
              <div>
                <label className={cn("text-xs font-semibold mb-1.5 block", scheduleErrors.has("division_id") ? "text-danger" : "text-foreground")}>Divisi <span className="text-danger">*</span></label>
                {editingScheduleId !== null ? (
                  <div className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-muted-foreground cursor-not-allowed">
                    {activeDivisions.find((d) => d.id === scheduleForm.division_id)?.nama || "-"}
                  </div>
                ) : (
                  <Select
                    value={String(scheduleForm.division_id)}
                    onChange={(val) => { setScheduleForm({ ...scheduleForm, division_id: parseInt(val) }); setScheduleErrors((prev) => { const n = new Set(prev); n.delete("division_id"); return n; }); }}
                    options={divisionsWithoutSchedule.map((d) => ({ value: String(d.id), label: d.nama }))}
                    placeholder="Pilih divisi"
                    hasError={scheduleErrors.has("division_id")}
                  />
                )}
                {editingScheduleId !== null && <p className="text-[10px] text-muted-foreground mt-1">Divisi tidak dapat diubah saat edit</p>}
                {scheduleErrors.has("division_id") && <p className="text-[10px] text-danger mt-1">Divisi wajib dipilih</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={cn("text-xs font-semibold mb-1.5 block", scheduleErrors.has("jam_masuk") ? "text-danger" : "text-foreground")}>Jam Masuk <span className="text-danger">*</span></label>
                  <input type="time" value={scheduleForm.jam_masuk} onChange={(e) => { setScheduleForm({ ...scheduleForm, jam_masuk: e.target.value }); setScheduleErrors((prev) => { const n = new Set(prev); n.delete("jam_masuk"); return n; }); }} className={cn(inputClass, scheduleErrors.has("jam_masuk") && "border-danger ring-2 ring-danger/20")} />
                  {scheduleErrors.has("jam_masuk") && <p className="text-[10px] text-danger mt-1">Jam masuk wajib diisi</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jam Pulang</label>
                  <input type="time" value={scheduleForm.jam_pulang} onChange={(e) => setScheduleForm({ ...scheduleForm, jam_pulang: e.target.value })} className={inputClass} />
                  <p className="text-[10px] text-muted-foreground mt-1">Opsional</p>
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
                  <Select
                    value={scheduleForm.status}
                    onChange={(val) => setScheduleForm({ ...scheduleForm, status: val })}
                    options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowScheduleForm(false)}>Batal</Button>
              <Button size="sm" icon={editingScheduleId ? Check : Plus} onClick={handleSaveSchedule}>
                {editingScheduleId ? "Simpan" : "Tambah Jadwal"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ HARGA TITIK FORM MODAL ═══ */}
      {showRateForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowRateForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingRateDivId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingRateDivId ? "Edit Harga Titik" : "Tambah Harga Titik"}</h2>
              </div>
              <button onClick={() => setShowRateForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Divisi <span className="text-danger">*</span></label>
                {editingRateDivId !== null ? (
                  <div className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-muted-foreground cursor-not-allowed">
                    {divisionList.find((d) => d.id === rateForm.division_id)?.nama || "-"}
                  </div>
                ) : (
                  <Select
                    value={String(rateForm.division_id)}
                    onChange={(val) => setRateForm({ ...rateForm, division_id: parseInt(val) })}
                    options={divisionsWithoutRate.map((d) => ({ value: String(d.id), label: d.nama }))}
                    placeholder="Pilih divisi"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />Harga Driver / Titik</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                    <input type="number" min={0} placeholder="15000" value={rateForm.driver_rate} onChange={(e) => setRateForm({ ...rateForm, driver_rate: e.target.value })} className={cn(inputClass, "pl-9")} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" />Harga Helper / Titik</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                    <input type="number" min={0} placeholder="10000" value={rateForm.helper_rate} onChange={(e) => setRateForm({ ...rateForm, helper_rate: e.target.value })} className={cn(inputClass, "pl-9")} />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Isi minimal salah satu harga. Kosongkan jika posisi tersebut tidak berlaku untuk divisi ini.</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowRateForm(false)}>Batal</Button>
              <Button size="sm" icon={editingRateDivId ? Check : Plus} onClick={handleSaveRate} disabled={!rateForm.division_id || (!rateForm.driver_rate && !rateForm.helper_rate)}>
                {editingRateDivId ? "Simpan" : "Tambah"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ STATUS TITIK FORM MODAL ═══ */}
      {showDStatusForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDStatusForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingDStatusId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingDStatusId ? "Edit Status" : "Tambah Status Baru"}</h2>
              </div>
              <button onClick={() => setShowDStatusForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Status <span className="text-danger">*</span></label>
                  <input type="text" placeholder="Contoh: Standby" value={dStatusForm.nama} onChange={(e) => setDStatusForm({ ...dStatusForm, nama: e.target.value })} className={inputClass} autoFocus />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Warna</label>
                  <input type="color" value={dStatusForm.color} onChange={(e) => setDStatusForm({ ...dStatusForm, color: e.target.value })}
                    className="w-10 h-10 rounded-xl border border-border cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Kode <span className="text-danger">*</span></label>
                  <input type="text" placeholder="Contoh: STB" maxLength={10} value={dStatusForm.kode} onChange={(e) => setDStatusForm({ ...dStatusForm, kode: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <Select value={dStatusForm.status} onChange={(val) => setDStatusForm({ ...dStatusForm, status: val })} options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowDStatusForm(false)}>Batal</Button>
              <Button size="sm" icon={editingDStatusId ? Check : Plus} onClick={handleSaveDStatus} disabled={!dStatusForm.nama.trim() || !dStatusForm.kode.trim()}>
                {editingDStatusId ? "Simpan" : "Tambah Status"}
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
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
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
                  <Select
                    value={bankForm.status}
                    onChange={(val) => setBankForm({ ...bankForm, status: val })}
                    options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                  />
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

      {/* ═══ DENDA TELAT FORM MODAL ═══ */}
      {showPenaltyForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPenaltyForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                  {editingPenaltyId ? <Pencil className="w-4 h-4 text-warning" /> : <Plus className="w-4 h-4 text-warning" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingPenaltyId ? "Edit Denda Telat" : "Tambah Denda Telat"}</h2>
              </div>
              <button onClick={() => setShowPenaltyForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Divisi</label>
                  {editingPenaltyId ? (
                    <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-foreground">
                      {penaltyList.find((p) => p.id === editingPenaltyId)?.divisionNama || "-"}
                    </div>
                  ) : (
                    <div className="border border-border rounded-xl bg-card overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" 
                            checked={penaltyForm.division_ids.length === divisionsWithoutPenalty.length && divisionsWithoutPenalty.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) setPenaltyForm({ ...penaltyForm, division_ids: divisionsWithoutPenalty.map(d => d.id) });
                              else setPenaltyForm({ ...penaltyForm, division_ids: [] });
                            }}
                            className="rounded border-border text-primary focus:ring-primary"
                          />
                          <span className="text-xs font-semibold text-foreground">Pilih Semua ({divisionsWithoutPenalty.length})</span>
                        </label>
                      </div>
                      <div className="max-h-40 overflow-y-auto p-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {divisionsWithoutPenalty.map(d => (
                          <label key={d.id} className={cn("flex items-center gap-2 p-2 rounded-lg cursor-pointer border transition-colors", 
                            penaltyForm.division_ids.includes(d.id) ? "border-primary bg-primary/[0.05]" : "border-transparent hover:bg-muted/50"
                          )}>
                            <input type="checkbox"
                              checked={penaltyForm.division_ids.includes(d.id)}
                              onChange={(e) => {
                                const newIds = e.target.checked 
                                  ? [...penaltyForm.division_ids, d.id]
                                  : penaltyForm.division_ids.filter(id => id !== d.id);
                                setPenaltyForm({ ...penaltyForm, division_ids: newIds });
                              }}
                              className="rounded border-border text-primary focus:ring-primary"
                            />
                            <span className="text-xs text-foreground truncate">{d.nama}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Denda Per Menit</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">Rp</span>
                  <input type="number" min={0} value={penaltyForm.denda_per_menit} onChange={(e) => setPenaltyForm({ ...penaltyForm, denda_per_menit: e.target.value })}
                    className={cn(inputClass, "pl-10")} placeholder="3000" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Denda per menit keterlambatan dalam batas waktu</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Batas Menit</label>
                <div className="relative">
                  <input type="number" min={1} value={penaltyForm.batas_menit} onChange={(e) => setPenaltyForm({ ...penaltyForm, batas_menit: e.target.value })}
                    className={inputClass} placeholder="20" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Jika telat melebihi batas ini, denda menjadi flat (denda maksimum)</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Denda Maksimum</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">Rp</span>
                  <input type="number" min={0} value={penaltyForm.denda_maksimum} onChange={(e) => setPenaltyForm({ ...penaltyForm, denda_maksimum: e.target.value })}
                    className={cn(inputClass, "pl-10")} placeholder="60000" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Denda flat jika telat melebihi batas menit</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Denda Alpha</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">Rp</span>
                  <input type="number" min={0} value={penaltyForm.denda_alpha} onChange={(e) => setPenaltyForm({ ...penaltyForm, denda_alpha: e.target.value })}
                    className={cn(inputClass, "pl-10")} placeholder="100000" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Denda flat untuk tidak hadir tanpa keterangan (Alpha)</p>
              </div>
              {/* Preview */}
              <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Preview Perhitungan</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Telat 5 menit</span>
                  <span className="font-semibold text-foreground">Rp {(5 * (parseInt(penaltyForm.denda_per_menit) || 0)).toLocaleString("id-ID")}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Telat {penaltyForm.batas_menit || 20} menit</span>
                  <span className="font-semibold text-foreground">Rp {((parseInt(penaltyForm.batas_menit) || 20) * (parseInt(penaltyForm.denda_per_menit) || 0)).toLocaleString("id-ID")}</span>
                </div>
                <div className="flex items-center justify-between text-xs border-t border-border pt-1.5">
                  <span className="text-muted-foreground">Telat &gt; {penaltyForm.batas_menit || 20} menit</span>
                  <span className="font-semibold text-warning">Rp {(parseInt(penaltyForm.denda_maksimum) || 0).toLocaleString("id-ID")} (flat)</span>
                </div>
                <div className="flex items-center justify-between text-xs border-t border-border pt-1.5">
                  <span className="text-muted-foreground">Alpha (tidak hadir)</span>
                  <span className="font-semibold text-danger">Rp {(parseInt(penaltyForm.denda_alpha) || 0).toLocaleString("id-ID")} (flat)</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={() => setShowPenaltyForm(false)}>Batal</Button>
              <Button size="sm" icon={editingPenaltyId ? Check : Plus} onClick={handleSavePenalty} disabled={penaltyForm.division_ids.length === 0 && !editingPenaltyId}>
                {editingPenaltyId ? "Simpan" : `Tambah (${penaltyForm.division_ids.length})`}
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
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-7 h-7 text-danger" />
              </div>
              <h3 className="text-base font-bold text-foreground">Hapus {{ level: "Level", jabatan: "Jabatan", divisi: "Divisi", "titik-absen": "Titik Absen", "waktu-kerja": "Waktu Kerja", "denda-telat": "Denda Telat", "harga-titik": "Harga Titik", "status-titik": "Status Titik", bank: "Bank" }[deleteConfirm.type]}?</h3>
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
                else if (deleteConfirm.type === "denda-telat") handleDeletePenalty(deleteConfirm.id);
                else if (deleteConfirm.type === "harga-titik") handleDeleteRate(deleteConfirm.id);
                else if (deleteConfirm.type === "status-titik") handleDeleteDStatus(deleteConfirm.id);
                else handleDeleteBank(deleteConfirm.id);
              }}>Hapus</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
    </RouteGuard>
  );
}
