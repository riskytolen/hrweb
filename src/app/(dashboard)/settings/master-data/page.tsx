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
  MapPinned,
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
  RefreshCw,
  Truck,
  Banknote,
  TrendingUp,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import { cn, formatCurrency, generateDivisionColor, toTitleCase, toUpperTrim } from "@/lib/utils";
import Portal from "@/components/ui/Portal";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { logAudit } from "@/lib/audit";
import { supabase, type DbLevel, type DbJabatan, type DbBank, type DbDivision, type DbAttendanceLocation, type DbDivisionLocationAssignment, type DbDivisionSchedule, type DbPointRate, type DbDeliveryStatus, type DbDeliveryZone, type DbAttendancePenaltyRate, type DbLegalSetting, type DbGaVehicleDocumentSetting, type DbGaVehicleVendor, type DbGaVehicleDivision, type DbBackupLiburSetting, type DbGapokSetting } from "@/lib/supabase";

// ─── Types ───
type Level = DbLevel;
type Jabatan = DbJabatan & { levelNama?: string };
type Bank = DbBank;
type Division = DbDivision;
type AttendanceLocation = DbAttendanceLocation & { divisionNames?: string[] };
type DivisionSchedule = DbDivisionSchedule & { divisionNama?: string };
type DeliveryZone = DbDeliveryZone;
type PointRate = DbPointRate & { zoneNama?: string };
type DeliveryStatus = DbDeliveryStatus;
type PenaltyRate = DbAttendancePenaltyRate & { divisionNama?: string };
type VehicleVendor = DbGaVehicleVendor;
type VehicleDivision = DbGaVehicleDivision;

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const selectClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none text-foreground";

function parseCurrencyInput(value: string): number {
  return parseInt(value.replace(/\D/g, ""), 10) || 0;
}

function formatCurrencyInput(value: string): string {
  const amount = parseCurrencyInput(value);
  return amount === 0 ? "" : new Intl.NumberFormat("id-ID").format(amount);
}

// ─── Period helpers (cut-off tanggal 8) ───
const CUT_OFF_DAY = 8;
function getActivePeriodRange(): { start: string; end: string; label: string } {
  const now = new Date();
  // Periode aktif: jika hari ini < tgl 8 → mulai dari tgl 8 bulan lalu, akhir tgl 7 bulan ini.
  // Jika hari ini >= tgl 8 → mulai dari tgl 8 bulan ini, akhir tgl 7 bulan depan.
  const baseMonth = now.getDate() < CUT_OFF_DAY ? now.getMonth() - 1 : now.getMonth();
  const startDate = new Date(now.getFullYear(), baseMonth, CUT_OFF_DAY);
  const endDate = new Date(now.getFullYear(), baseMonth + 1, CUT_OFF_DAY - 1);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  const fmt = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  return { start, end, label: `${fmt(startDate)} – ${fmt(endDate)}` };
}

// ─── Tabs config ───
const tabs = [
  { key: "level", label: "Level", icon: Layers },
  { key: "jabatan", label: "Jabatan", icon: Briefcase },
  { key: "divisi", label: "Divisi", icon: Building2 },
  { key: "titik-absen", label: "Titik Absen", icon: MapPin },
  { key: "waktu-kerja", label: "Waktu Kerja", icon: Clock },
  { key: "denda-telat", label: "Denda Telat", icon: AlertTriangle },
  { key: "nama-titik", label: "Nama Titik", icon: MapPinned },
  { key: "harga-titik", label: "Harga Titik", icon: CircleDollarSign },
  { key: "status-titik", label: "Status Titik", icon: Tag },
  { key: "backup-libur", label: "Backup Libur", icon: CalendarDays },
  { key: "gapok", label: "Gapok", icon: Banknote },
  { key: "bank", label: "Bank", icon: Landmark },
  { key: "kendaraan", label: "Kendaraan", icon: Truck },
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

  // ─── Vendor Kendaraan State ───
  const [vendorKendaraanList, setVendorKendaraanList] = useState<VehicleVendor[]>([]);
  const [vendorKendaraanSearch, setVendorKendaraanSearch] = useState("");
  const [showVendorKendaraanForm, setShowVendorKendaraanForm] = useState(false);
  const [editingVendorKendaraanId, setEditingVendorKendaraanId] = useState<number | null>(null);
  const [vendorKendaraanForm, setVendorKendaraanForm] = useState({ nama: "", deskripsi: "", status: "Aktif" });

  // ─── Divisi Kendaraan State ───
  const [divisiKendaraanList, setDivisiKendaraanList] = useState<VehicleDivision[]>([]);
  const [divisiKendaraanSearch, setDivisiKendaraanSearch] = useState("");
  const [showDivisiKendaraanForm, setShowDivisiKendaraanForm] = useState(false);
  const [editingDivisiKendaraanId, setEditingDivisiKendaraanId] = useState<number | null>(null);
  const [divisiKendaraanForm, setDivisiKendaraanForm] = useState({ nama: "", deskripsi: "", status: "Aktif" });

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
  const [scheduleForm, setScheduleForm] = useState({ division_id: 0, jam_masuk: "08:00", jam_pulang: "17:00", toleransi_menit: "15", awal_absen_menit: "0", overtime_rate_per_hour: "0", status: "Aktif" });
  const [scheduleErrors, setScheduleErrors] = useState<Set<string>>(new Set());

  // ─── Denda Telat State ───
  const [penaltyList, setPenaltyList] = useState<PenaltyRate[]>([]);
  const [penaltySearch, setPenaltySearch] = useState("");
  const [showPenaltyForm, setShowPenaltyForm] = useState(false);
  const [editingPenaltyId, setEditingPenaltyId] = useState<number | null>(null);
  const [penaltyForm, setPenaltyForm] = useState<{ division_ids: number[]; denda_per_menit: string; batas_menit: string; denda_maksimum: string; denda_alpha: string; status: string }>({ division_ids: [], denda_per_menit: "3000", batas_menit: "20", denda_maksimum: "60000", denda_alpha: "100000", status: "Aktif" });

  // ─── Nama Titik (Delivery Zone) State ───
  const [zoneList, setZoneList] = useState<DeliveryZone[]>([]);
  const [zoneSearch, setZoneSearch] = useState("");
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);
  const [zoneForm, setZoneForm] = useState({ nama: "", deskripsi: "", color: "#3b82f6", status: "Aktif" });

  // ─── Harga Titik State ───
  type RateRow = { zone_id: number; zoneNama: string; driverRate: number | null; driverRateId: number | null; helperRate: number | null; helperRateId: number | null };
  const [rateRows, setRateRows] = useState<RateRow[]>([]);
  const [rateSearch, setRateSearch] = useState("");
  const [showRateForm, setShowRateForm] = useState(false);
  const [editingRateZoneId, setEditingRateZoneId] = useState<number | null>(null);
  const [rateForm, setRateForm] = useState({ zone_id: 0, driver_rate: "", helper_rate: "" });

  // ─── Sinkron Harga ke Rekap Titik ───
  type SyncMode = "active" | "all" | "custom";
  const [syncRow, setSyncRow] = useState<RateRow | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>("active");
  const [syncCustomStart, setSyncCustomStart] = useState("");
  const [syncCustomEnd, setSyncCustomEnd] = useState("");
  const [syncPreview, setSyncPreview] = useState<{ driverCount: number; helperCount: number; loading: boolean }>({ driverCount: 0, helperCount: 0, loading: false });
  const [syncRunning, setSyncRunning] = useState(false);

  // ─── Status Titik State ───
  const [dStatusList, setDStatusList] = useState<DeliveryStatus[]>([]);
  const [dStatusSearch, setDStatusSearch] = useState("");
  const [showDStatusForm, setShowDStatusForm] = useState(false);
  const [editingDStatusId, setEditingDStatusId] = useState<number | null>(null);
  const [dStatusForm, setDStatusForm] = useState({ nama: "", kode: "", color: "#6b7280", status: "Aktif" });
  const [backupLiburSetting, setBackupLiburSetting] = useState<DbBackupLiburSetting | null>(null);
  const [showBackupLiburForm, setShowBackupLiburForm] = useState(false);
  const [backupLiburForm, setBackupLiburForm] = useState({ driver_amount: "65000", helper_amount: "45000" });
  const [gapokSetting, setGapokSetting] = useState<DbGapokSetting | null>(null);
  const [showGapokForm, setShowGapokForm] = useState(false);
  const [gapokForm, setGapokForm] = useState({ driver_default_amount: "2000000", helper_default_amount: "1000000", increment_amount: "250000", interval_years: "2.5", notification_days: "90", driver_jabatan_id: "", helper_jabatan_id: "" });
  const [gapokPreview, setGapokPreview] = useState<{ upcoming90: number; overdue: number; totalActive: number; loading: boolean }>({ upcoming90: 0, overdue: 0, totalActive: 0, loading: false });

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
  // Vehicle document settings
  const [vehicleDocSetting, setVehicleDocSetting] = useState<DbGaVehicleDocumentSetting | null>(null);
  const [showVehicleDocSettingForm, setShowVehicleDocSettingForm] = useState(false);
  const [vehicleDocSettingForm, setVehicleDocSettingForm] = useState({
    kir_reminder_days: "30",
    stnk_reminder_days: "30",
    pajak_reminder_days: "30",
    kir_required_default: true,
    stnk_required_default: true,
    pajak_required_default: true,
  });

  // ─── Delete Confirm Dialog ───
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "level" | "jabatan" | "divisi" | "titik-absen" | "waktu-kerja" | "denda-telat" | "nama-titik" | "harga-titik" | "status-titik" | "bank" | "vendor-kendaraan" | "divisi-kendaraan"; id: number; nama: string } | null>(null);

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

  const fetchVendorKendaraan = async () => {
    const { data } = await supabase.from("ga_vehicle_vendors").select("*").order("nama");
    if (data) setVendorKendaraanList(data);
  };

  const fetchDivisiKendaraan = async () => {
    const { data } = await supabase.from("ga_vehicle_divisions").select("*").order("nama");
    if (data) setDivisiKendaraanList(data);
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

  const fetchZones = async () => {
    const { data } = await supabase.from("delivery_zones").select("*").order("nama");
    if (data) setZoneList(data);
  };

  const fetchRates = async () => {
    const { data } = await supabase.from("point_rates").select("*, delivery_zones(id, nama)").order("zone_id");
    if (data) {
      // Group by zone_id into rows with driver + helper
      const map = new Map<number, RateRow>();
      data.forEach((r) => {
        if (!map.has(r.zone_id)) {
          map.set(r.zone_id, { zone_id: r.zone_id, zoneNama: r.delivery_zones?.nama || "-", driverRate: null, driverRateId: null, helperRate: null, helperRateId: null });
        }
        const row = map.get(r.zone_id)!;
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

  const fetchBackupLiburSettings = async () => {
    const { data } = await supabase
      .from("backup_libur_settings")
      .select("*, delivery_statuses(nama, kode, status)")
      .eq("id", 1)
      .maybeSingle();
    if (data) setBackupLiburSetting(data as DbBackupLiburSetting);
  };

  const fetchGapokSetting = async () => {
    const { data } = await supabase
      .from("gapok_settings")
      .select("*, driver_jabatan:jabatan!gapok_settings_driver_jabatan_id_fkey(nama), helper_jabatan:jabatan!gapok_settings_helper_jabatan_id_fkey(nama)")
      .eq("id", 1)
      .maybeSingle();
    if (data) {
      const row = data as unknown as DbGapokSetting & { driver_jabatan?: { nama: string } | null; helper_jabatan?: { nama: string } | null };
      setGapokSetting(row as DbGapokSetting);
    } else {
      const { data: fallback } = await supabase.from("gapok_settings").select("*").eq("id", 1).maybeSingle();
      if (fallback) setGapokSetting(fallback as DbGapokSetting);
    }
  };

  const fetchGapokPreview = async () => {
    setGapokPreview((p) => ({ ...p, loading: true }));
    const today = new Date().toISOString().slice(0, 10);
    const in90 = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const [sched, active] = await Promise.all([
      supabase.from("gapok_increment_events").select("due_date, status"),
      supabase.from("pegawai").select("id", { count: "exact", head: true }).eq("status", "Aktif").in("jabatan_id", gapokSetting ? [gapokSetting.driver_jabatan_id, gapokSetting.helper_jabatan_id].filter(Boolean) as number[] : []),
    ]);
    const rows = (sched.data ?? []) as { due_date: string; status: string }[];
    const overdue = rows.filter((r) => r.status === "Scheduled" && r.due_date <= today).length;
    const upcoming90 = rows.filter((r) => r.status === "Scheduled" && r.due_date > today && r.due_date <= in90).length;
    setGapokPreview({ overdue, upcoming90, totalActive: active.count ?? 0, loading: false });
  };

  const fetchPenalties = async () => {
    const { data } = await supabase.from("attendance_penalty_rates").select("*, divisions(nama)").order("division_id");
    if (data) setPenaltyList(data.map((p) => ({ ...p, divisionNama: p.divisions?.nama || "-" })));
  };

  useEffect(() => {
    Promise.all([fetchLevels(), fetchJabatan(), fetchBanks(), fetchVendorKendaraan(), fetchDivisiKendaraan(), fetchDivisions(), fetchLocations(), fetchSchedules(), fetchZones(), fetchRates(), fetchDStatuses(), fetchBackupLiburSettings(), fetchGapokSetting(), fetchPenalties(), fetchLegalSettings(), fetchCompanySettings(), fetchLeaveSettings(), fetchVehicleDocSettings()]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (gapokSetting) fetchGapokPreview();
  }, [gapokSetting?.id, gapokSetting?.updated_at]);

  // Lock body scroll when any modal is open
  useEffect(() => {
    if (showLevelForm || showJabatanForm || showBankForm || showVendorKendaraanForm || showDivisiKendaraanForm || showDivisionForm || showLocationForm || showScheduleForm || showZoneForm || showRateForm || showDStatusForm || showPenaltyForm || showLegalSettingForm || showCompanyForm || showLeaveSettingForm || showVehicleDocSettingForm || showGapokForm || syncRow !== null) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [showLevelForm, showJabatanForm, showBankForm, showVendorKendaraanForm, showDivisiKendaraanForm, showDivisionForm, showLocationForm, showScheduleForm, showZoneForm, showRateForm, showDStatusForm, showBackupLiburForm, showGapokForm, showLegalSettingForm, showCompanyForm, showLeaveSettingForm, showVehicleDocSettingForm, syncRow]);

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
    setScheduleForm({ division_id: divisionsWithoutSchedule[0]?.id || 0, jam_masuk: "08:00", jam_pulang: "17:00", toleransi_menit: "15", awal_absen_menit: "0", overtime_rate_per_hour: "0", status: "Aktif" });
    setScheduleErrors(new Set());
    setEditingScheduleId(null);
    setShowScheduleForm(true);
  };
  const handleOpenEditSchedule = (s: DivisionSchedule) => {
    setScheduleForm({ division_id: s.division_id, jam_masuk: s.jam_masuk.slice(0, 5), jam_pulang: s.jam_pulang ? s.jam_pulang.slice(0, 5) : "", toleransi_menit: String(s.toleransi_menit), awal_absen_menit: String(s.awal_absen_menit ?? 0), overtime_rate_per_hour: String(s.overtime_rate_per_hour ?? 0), status: s.status });
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
    const awalAbsenParsed = parseInt(scheduleForm.awal_absen_menit);
    const awalAbsenMenit = Number.isFinite(awalAbsenParsed) && awalAbsenParsed >= 0 ? Math.min(awalAbsenParsed, 720) : 0;
    const payload = { division_id: scheduleForm.division_id, jam_masuk: scheduleForm.jam_masuk, jam_pulang: scheduleForm.jam_pulang || null, toleransi_menit: parseInt(scheduleForm.toleransi_menit) || 0, awal_absen_menit: awalAbsenMenit, overtime_rate_per_hour: parseInt(scheduleForm.overtime_rate_per_hour) || 0, status: scheduleForm.status };
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

  // ─── Nama Titik (Delivery Zone) Handlers ───
  const filteredZones = zoneList.filter((z) =>
    z.nama.toLowerCase().includes(zoneSearch.toLowerCase()) || (z.deskripsi || "").toLowerCase().includes(zoneSearch.toLowerCase())
  );
  const activeZones = zoneList.filter((z) => z.status === "Aktif");

  const handleOpenAddZone = () => {
    const autoColor = generateDivisionColor(zoneList.map((z) => z.color));
    setZoneForm({ nama: "", deskripsi: "", color: autoColor, status: "Aktif" });
    setEditingZoneId(null);
    setShowZoneForm(true);
  };
  const handleOpenEditZone = (z: DeliveryZone) => {
    setZoneForm({ nama: z.nama, deskripsi: z.deskripsi || "", color: z.color || "#3b82f6", status: z.status });
    setEditingZoneId(z.id);
    setShowZoneForm(true);
  };
  const handleSaveZone = async () => {
    if (!zoneForm.nama.trim()) return;
    const cleanNama = toTitleCase(zoneForm.nama.trim());
    if (editingZoneId !== null) {
      const oldZone = zoneList.find((z) => z.id === editingZoneId);
      const { error } = await supabase.from("delivery_zones").update({ nama: cleanNama, deskripsi: zoneForm.deskripsi || null, color: zoneForm.color, status: zoneForm.status }).eq("id", editingZoneId);
      if (error) {
        showSuccess("Gagal", error.message);
        return;
      }
      showSuccess("Nama Titik Diperbarui", `Data nama titik "${cleanNama}" telah disimpan.`);
      await logAudit({
        supabase,
        action: "update",
        entityType: "delivery_zones",
        entityId: editingZoneId,
        entityLabel: cleanNama,
        oldData: oldZone ? { nama: oldZone.nama, color: oldZone.color, status: oldZone.status } : null,
        newData: { nama: cleanNama, color: zoneForm.color, status: zoneForm.status },
      });
    } else {
      const { data: inserted, error } = await supabase.from("delivery_zones").insert({ nama: cleanNama, deskripsi: zoneForm.deskripsi || null, color: zoneForm.color, status: zoneForm.status }).select("id").single();
      if (error) {
        showSuccess("Gagal", error.message.includes("duplicate") ? "Nama titik sudah ada." : error.message);
        return;
      }
      showSuccess("Nama Titik Ditambahkan", `Nama titik "${cleanNama}" berhasil ditambahkan.`);
      await logAudit({
        supabase,
        action: "create",
        entityType: "delivery_zones",
        entityId: inserted?.id,
        entityLabel: cleanNama,
        newData: { nama: cleanNama, color: zoneForm.color, status: zoneForm.status },
      });
    }
    setShowZoneForm(false);
    fetchZones();
    fetchRates();
  };
  const handleDeleteZone = async (id: number) => {
    const oldZone = zoneList.find((z) => z.id === id);
    const { error } = await supabase.from("delivery_zones").delete().eq("id", id);
    setDeleteConfirm(null);
    if (error) {
      showSuccess("Gagal Hapus", error.message.includes("foreign key") || error.message.includes("violates")
        ? "Nama titik dipakai pada Harga Titik atau Rekap Titik. Hapus dulu data tersebut."
        : error.message);
      return;
    }
    showSuccess("Nama Titik Dihapus", "Data nama titik telah dihapus dari sistem.");
    if (oldZone) {
      await logAudit({
        supabase,
        action: "delete",
        entityType: "delivery_zones",
        entityId: id,
        entityLabel: oldZone.nama,
        oldData: { nama: oldZone.nama, color: oldZone.color, status: oldZone.status },
      });
    }
    fetchZones();
    fetchRates();
  };
  const handleToggleZoneStatus = async (id: number) => {
    const z = zoneList.find((x) => x.id === id);
    if (!z) return;
    const newStatus = z.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    const { error } = await supabase.from("delivery_zones").update({ status: newStatus }).eq("id", id);
    if (!error) {
      await logAudit({
        supabase,
        action: "status_change",
        entityType: "delivery_zones",
        entityId: id,
        entityLabel: z.nama,
        oldData: { status: z.status },
        newData: { status: newStatus },
      });
    }
    fetchZones();
  };

  // ─── Harga Titik Handlers ───
  const filteredRateRows = rateRows.filter((r) =>
    r.zoneNama.toLowerCase().includes(rateSearch.toLowerCase())
  );
  const zonesWithoutRate = activeZones.filter((z) => !rateRows.some((r) => r.zone_id === z.id));

  const handleOpenAddRate = () => {
    setRateForm({ zone_id: zonesWithoutRate[0]?.id || 0, driver_rate: "", helper_rate: "" });
    setEditingRateZoneId(null);
    setShowRateForm(true);
  };
  const handleOpenEditRate = (row: RateRow) => {
    setRateForm({ zone_id: row.zone_id, driver_rate: row.driverRate !== null ? String(row.driverRate) : "", helper_rate: row.helperRate !== null ? String(row.helperRate) : "" });
    setEditingRateZoneId(row.zone_id);
    setShowRateForm(true);
  };
  const handleSaveRate = async () => {
    if (!rateForm.zone_id) return;
    if (!rateForm.driver_rate && !rateForm.helper_rate) return;
    const zoneNama = zoneList.find((z) => z.id === rateForm.zone_id)?.nama || "";

    // Upsert Driver rate
    let driverChanges: Record<string, unknown> | null = null;
    if (rateForm.driver_rate) {
      const existing = rateRows.find((r) => r.zone_id === rateForm.zone_id);
      const newRate = parseInt(rateForm.driver_rate) || 0;
      if (existing?.driverRateId) {
        const oldRate = existing.driverRate;
        await supabase.from("point_rates").update({ rate_per_point: newRate }).eq("id", existing.driverRateId);
        if (oldRate !== newRate) driverChanges = { role: "Driver", lama: oldRate, baru: newRate };
      } else {
        await supabase.from("point_rates").insert({ zone_id: rateForm.zone_id, role: "Driver", rate_per_point: newRate });
        driverChanges = { role: "Driver", lama: null, baru: newRate };
      }
    }
    // Upsert Helper rate
    let helperChanges: Record<string, unknown> | null = null;
    if (rateForm.helper_rate) {
      const existing = rateRows.find((r) => r.zone_id === rateForm.zone_id);
      const newRate = parseInt(rateForm.helper_rate) || 0;
      if (existing?.helperRateId) {
        const oldRate = existing.helperRate;
        await supabase.from("point_rates").update({ rate_per_point: newRate }).eq("id", existing.helperRateId);
        if (oldRate !== newRate) helperChanges = { role: "Helper", lama: oldRate, baru: newRate };
      } else {
        await supabase.from("point_rates").insert({ zone_id: rateForm.zone_id, role: "Helper", rate_per_point: newRate });
        helperChanges = { role: "Helper", lama: null, baru: newRate };
      }
    }

    showSuccess(editingRateZoneId ? "Harga Titik Diperbarui" : "Harga Titik Ditambahkan", `Tarif titik "${zoneNama}" telah disimpan.`);
    setShowRateForm(false);
    const rateChanges = [driverChanges, helperChanges].filter(Boolean);
    if (rateChanges.length > 0) {
      await logAudit({
        supabase,
        action: editingRateZoneId ? "update" : "create",
        entityType: "point_rates",
        entityId: rateForm.zone_id,
        entityLabel: `Harga titik "${zoneNama}"`,
        metadata: { zone_id: rateForm.zone_id, zone_nama: zoneNama, perubahan: rateChanges },
      });
    }
    fetchRates();
  };
  const handleDeleteRate = async (zoneId: number) => {
    const row = rateRows.find((r) => r.zone_id === zoneId);
    const zoneNama = row?.zoneNama || "";
    if (row?.driverRateId) await supabase.from("point_rates").delete().eq("id", row.driverRateId);
    if (row?.helperRateId) await supabase.from("point_rates").delete().eq("id", row.helperRateId);
    setDeleteConfirm(null);
    showSuccess("Harga Titik Dihapus", "Data tarif titik telah dihapus dari sistem.");
    await logAudit({
      supabase,
      action: "delete",
      entityType: "point_rates",
      entityId: zoneId,
      entityLabel: `Harga titik "${zoneNama}"`,
      oldData: row ? { driverRate: row.driverRate, helperRate: row.helperRate } : null,
    });
    fetchRates();
  };

  // ─── Sinkron Harga ke Rekap Titik ───
  const getSyncRange = (): { start: string | null; end: string | null; label: string } => {
    if (syncMode === "all") return { start: null, end: null, label: "Semua periode" };
    if (syncMode === "active") {
      const p = getActivePeriodRange();
      return { start: p.start, end: p.end, label: `Periode aktif (${p.label})` };
    }
    return {
      start: syncCustomStart || null,
      end: syncCustomEnd || null,
      label: syncCustomStart && syncCustomEnd ? `${syncCustomStart} s/d ${syncCustomEnd}` : "Custom",
    };
  };

  const handleOpenSyncDialog = (row: RateRow) => {
    setSyncRow(row);
    setSyncMode("active");
    setSyncCustomStart("");
    setSyncCustomEnd("");
    setSyncPreview({ driverCount: 0, helperCount: 0, loading: false });
  };

  // Preview otomatis: hitung jumlah baris delivery_points yang akan ter-update
  // saat user ganti mode atau ganti tanggal custom
  useEffect(() => {
    if (!syncRow) return;
    const range = getSyncRange();
    // Custom mode tapi tanggal belum lengkap → skip preview
    if (syncMode === "custom" && (!range.start || !range.end)) {
      setSyncPreview({ driverCount: 0, helperCount: 0, loading: false });
      return;
    }
    let cancelled = false;
    setSyncPreview((p) => ({ ...p, loading: true }));
    (async () => {
      const buildQuery = (role: "Driver" | "Helper") => {
        let q = supabase
          .from("delivery_points")
          .select("id", { count: "exact", head: true })
          .eq("zone_id", syncRow.zone_id)
          .eq("role", role);
        if (range.start) q = q.gte("tanggal", range.start);
        if (range.end) q = q.lte("tanggal", range.end);
        // Hanya hitung yang harganya belum sesuai (efisien & informatif)
        return q;
      };

      const [driverRes, helperRes] = await Promise.all([
        syncRow.driverRate !== null ? buildQuery("Driver") : Promise.resolve({ count: 0 }),
        syncRow.helperRate !== null ? buildQuery("Helper") : Promise.resolve({ count: 0 }),
      ]);
      if (cancelled) return;
      setSyncPreview({
        driverCount: driverRes.count ?? 0,
        helperCount: helperRes.count ?? 0,
        loading: false,
      });
    })();
    return () => { cancelled = true; };
  }, [syncRow, syncMode, syncCustomStart, syncCustomEnd]);

  const handleExecuteSync = async () => {
    if (!syncRow) return;
    const range = getSyncRange();
    if (syncMode === "custom" && (!range.start || !range.end)) {
      showSuccess("Tanggal Belum Lengkap", "Isi tanggal mulai dan akhir.");
      return;
    }
    setSyncRunning(true);

    let driverUpdated = 0;
    let helperUpdated = 0;
    let errMsg: string | null = null;

    try {
      const runUpdate = async (role: "Driver" | "Helper", newRate: number) => {
        let q = supabase
          .from("delivery_points")
          .update({ rate_per_point: newRate }, { count: "exact" })
          .eq("zone_id", syncRow.zone_id)
          .eq("role", role);
        if (range.start) q = q.gte("tanggal", range.start);
        if (range.end) q = q.lte("tanggal", range.end);
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };

      if (syncRow.driverRate !== null) {
        driverUpdated = await runUpdate("Driver", syncRow.driverRate);
      }
      if (syncRow.helperRate !== null) {
        helperUpdated = await runUpdate("Helper", syncRow.helperRate);
      }

      // Audit log: 1 entri ringkas (hindari overload audit_logs untuk batch besar)
      const total = driverUpdated + helperUpdated;
      if (total > 0) {
        await logAudit({
          supabase,
          action: "update",
          entityType: "delivery_points",
          entityId: syncRow.zone_id,
          entityLabel: `Sinkron harga titik "${syncRow.zoneNama}"`,
          metadata: {
            zone_nama: syncRow.zoneNama,
            mode: syncMode,
            range_start: range.start,
            range_end: range.end,
            range_label: range.label,
            sumber: "sync_harga",
            driver_rate_baru: syncRow.driverRate,
            helper_rate_baru: syncRow.helperRate,
            jumlah_driver: driverUpdated,
            jumlah_helper: helperUpdated,
            total_baris: total,
          },
        });
      }
    } catch (e) {
      errMsg = e instanceof Error ? e.message : "Gagal sinkron harga.";
    } finally {
      setSyncRunning(false);
    }

    if (errMsg) {
      showSuccess("Gagal Sinkron", errMsg);
      return;
    }

    const total = driverUpdated + helperUpdated;
    setSyncRow(null);
    if (total === 0) {
      showSuccess("Tidak Ada Perubahan", `Tidak ada entri rekap titik untuk "${syncRow.zoneNama}" pada ${range.label.toLowerCase()}.`);
    } else {
      showSuccess(
        "Harga Tersinkron",
        `${total} entri rekap titik untuk "${syncRow.zoneNama}" diperbarui (Driver: ${driverUpdated}, Helper: ${helperUpdated}).`,
      );
    }
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
    const cleanKode = dStatusForm.kode.toUpperCase();
    const payload = { nama: cleanNama, kode: cleanKode, color: dStatusForm.color, status: dStatusForm.status };
    if (editingDStatusId !== null) {
      const oldStatus = dStatusList.find((s) => s.id === editingDStatusId);
      await supabase.from("delivery_statuses").update(payload).eq("id", editingDStatusId);
      showSuccess("Status Diperbarui", `Status "${cleanNama}" telah disimpan.`);
      await logAudit({
        supabase,
        action: "update",
        entityType: "delivery_statuses",
        entityId: editingDStatusId,
        entityLabel: `${cleanKode} — ${cleanNama}`,
        oldData: oldStatus ? { nama: oldStatus.nama, kode: oldStatus.kode, color: oldStatus.color, status: oldStatus.status } : null,
        newData: payload,
      });
    } else {
      const { data: inserted } = await supabase.from("delivery_statuses").insert(payload).select("id").single();
      showSuccess("Status Ditambahkan", `Status "${cleanNama}" berhasil ditambahkan.`);
      await logAudit({
        supabase,
        action: "create",
        entityType: "delivery_statuses",
        entityId: inserted?.id,
        entityLabel: `${cleanKode} — ${cleanNama}`,
        newData: payload,
      });
    }
    setShowDStatusForm(false);
    fetchDStatuses();
    fetchBackupLiburSettings();
  };
  const handleDeleteDStatus = async (id: number) => {
    if (backupLiburSetting?.delivery_status_id === id) {
      setDeleteConfirm(null);
      showSuccess("Status Dipakai", "Status ini dipakai sebagai sumber insentif Backup Libur dan tidak dapat dihapus.");
      return;
    }
    const oldStatus = dStatusList.find((s) => s.id === id);
    const { error } = await supabase.from("delivery_statuses").delete().eq("id", id);
    setDeleteConfirm(null);
    if (error) {
      showSuccess("Gagal Hapus", error.message);
      return;
    }
    showSuccess("Status Dihapus", "Data status telah dihapus.");
    if (oldStatus) {
      await logAudit({
        supabase,
        action: "delete",
        entityType: "delivery_statuses",
        entityId: id,
        entityLabel: `${oldStatus.kode} — ${oldStatus.nama}`,
        oldData: { nama: oldStatus.nama, kode: oldStatus.kode, color: oldStatus.color, status: oldStatus.status },
      });
    }
    fetchDStatuses();
  };
  const handleToggleDStatusStatus = async (id: number) => {
    const s = dStatusList.find((s) => s.id === id);
    if (!s) return;
    const newStatus = s.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    const { error } = await supabase.from("delivery_statuses").update({ status: newStatus }).eq("id", id);
    if (!error) {
      await logAudit({
        supabase,
        action: "status_change",
        entityType: "delivery_statuses",
        entityId: id,
        entityLabel: `${s.kode} — ${s.nama}`,
        oldData: { status: s.status },
        newData: { status: newStatus },
      });
    }
    fetchDStatuses();
    fetchBackupLiburSettings();
  };

  // ─── Backup Libur Settings Handlers ───
  const handleOpenEditBackupLiburSettings = () => {
    if (!backupLiburSetting) return;
    setBackupLiburForm({
      driver_amount: String(backupLiburSetting.driver_amount),
      helper_amount: String(backupLiburSetting.helper_amount),
    });
    setShowBackupLiburForm(true);
  };

  const handleSaveBackupLiburSettings = async () => {
    if (!canEdit || !backupLiburSetting) return;
    const payload = {
      driver_amount: parseCurrencyInput(backupLiburForm.driver_amount),
      helper_amount: parseCurrencyInput(backupLiburForm.helper_amount),
    };
    const { data, error } = await supabase
      .from("backup_libur_settings")
      .update(payload)
      .eq("id", backupLiburSetting.id)
      .select("*, delivery_statuses(nama, kode, status)")
      .single();

    if (error) {
      showSuccess("Gagal Menyimpan", error.message);
      return;
    }

    await logAudit({
      supabase,
      action: "update",
      entityType: "backup_libur_settings",
      entityId: backupLiburSetting.id,
      entityLabel: "Insentif Backup Libur",
      oldData: {
        driver_amount: backupLiburSetting.driver_amount,
        helper_amount: backupLiburSetting.helper_amount,
        delivery_status_id: backupLiburSetting.delivery_status_id,
      },
      newData: payload,
    });

    setBackupLiburSetting(data as DbBackupLiburSetting);
    setShowBackupLiburForm(false);
    showSuccess("Backup Libur Diperbarui", `Driver ${formatCurrency(payload.driver_amount)}, Helper ${formatCurrency(payload.helper_amount)}.`);
  };

  // ─── Gapok Settings Handlers ───
  const handleOpenEditGapok = () => {
    if (!gapokSetting) return;
    setGapokForm({
      driver_default_amount: String(gapokSetting.driver_default_amount),
      helper_default_amount: String(gapokSetting.helper_default_amount),
      increment_amount: String(gapokSetting.increment_amount),
      interval_years: (gapokSetting.interval_months / 12).toString(),
      notification_days: String(gapokSetting.notification_days),
      driver_jabatan_id: gapokSetting.driver_jabatan_id ? String(gapokSetting.driver_jabatan_id) : "",
      helper_jabatan_id: gapokSetting.helper_jabatan_id ? String(gapokSetting.helper_jabatan_id) : "",
    });
    setShowGapokForm(true);
  };

  const handleSaveGapok = async () => {
    if (!canEdit || !gapokSetting) return;
    const intervalYears = parseFloat(gapokForm.interval_years.replace(",", ".")) || 2.5;
    const intervalMonths = Math.max(1, Math.min(120, Math.round(intervalYears * 12)));
    const payload: Record<string, unknown> = {
      driver_default_amount: parseCurrencyInput(gapokForm.driver_default_amount),
      helper_default_amount: parseCurrencyInput(gapokForm.helper_default_amount),
      increment_amount: parseCurrencyInput(gapokForm.increment_amount),
      interval_months: intervalMonths,
      notification_days: Math.max(1, Math.min(365, parseInt(gapokForm.notification_days) || 90)),
      driver_jabatan_id: gapokForm.driver_jabatan_id ? parseInt(gapokForm.driver_jabatan_id) : null,
      helper_jabatan_id: gapokForm.helper_jabatan_id ? parseInt(gapokForm.helper_jabatan_id) : null,
      updated_at: new Date().toISOString(),
    };
    if (gapokForm.driver_jabatan_id && gapokForm.helper_jabatan_id && gapokForm.driver_jabatan_id === gapokForm.helper_jabatan_id) {
      showSuccess("Gagal Menyimpan", "Jabatan Driver dan Helper tidak boleh sama.");
      return;
    }
    const { data, error } = await supabase.from("gapok_settings").update(payload).eq("id", gapokSetting.id).select("*").single();
    if (error) {
      showSuccess("Gagal Menyimpan", error.message);
      return;
    }
    await logAudit({
      supabase,
      action: "update",
      entityType: "gapok_settings",
      entityId: gapokSetting.id,
      entityLabel: "Pengaturan Gapok",
      oldData: gapokSetting as unknown as Record<string, unknown>,
      newData: payload,
    });
    setGapokSetting(data as DbGapokSetting);
    setShowGapokForm(false);
    showSuccess("Gapok Diperbarui", `Default Driver ${formatCurrency(payload.driver_default_amount as number)}, Helper ${formatCurrency(payload.helper_default_amount as number)}, +${formatCurrency(payload.increment_amount as number)} per ${intervalYears} tahun.`);
    fetchGapokPreview();
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

  // ─── Vendor Kendaraan Handlers ───
  const filteredVendorKendaraan = vendorKendaraanList.filter((v) =>
    v.nama.toLowerCase().includes(vendorKendaraanSearch.toLowerCase()) || (v.deskripsi || "").toLowerCase().includes(vendorKendaraanSearch.toLowerCase())
  );
  const handleOpenAddVendorKendaraan = () => {
    setVendorKendaraanForm({ nama: "", deskripsi: "", status: "Aktif" });
    setEditingVendorKendaraanId(null);
    setShowVendorKendaraanForm(true);
  };
  const handleOpenEditVendorKendaraan = (v: VehicleVendor) => {
    setVendorKendaraanForm({ nama: v.nama, deskripsi: v.deskripsi || "", status: v.status });
    setEditingVendorKendaraanId(v.id);
    setShowVendorKendaraanForm(true);
  };
  const handleSaveVendorKendaraan = async () => {
    if (!vendorKendaraanForm.nama.trim()) return;
    const cleanNama = toUpperTrim(vendorKendaraanForm.nama.trim());
    if (editingVendorKendaraanId !== null) {
      await supabase.from("ga_vehicle_vendors").update({ nama: cleanNama, deskripsi: vendorKendaraanForm.deskripsi.trim() || null, status: vendorKendaraanForm.status }).eq("id", editingVendorKendaraanId);
      showSuccess("Vendor Diperbarui", `Data vendor "${cleanNama}" telah disimpan.`);
    } else {
      await supabase.from("ga_vehicle_vendors").insert({ nama: cleanNama, deskripsi: vendorKendaraanForm.deskripsi.trim() || null, status: vendorKendaraanForm.status });
      showSuccess("Vendor Ditambahkan", `Vendor "${cleanNama}" berhasil ditambahkan.`);
    }
    setShowVendorKendaraanForm(false);
    fetchVendorKendaraan();
  };
  const handleDeleteVendorKendaraan = async (id: number) => {
    await supabase.from("ga_vehicle_vendors").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Vendor Dihapus", "Data vendor telah dihapus.");
    fetchVendorKendaraan();
  };
  const handleToggleVendorKendaraanStatus = async (id: number) => {
    const v = vendorKendaraanList.find((x) => x.id === id);
    if (!v) return;
    await supabase.from("ga_vehicle_vendors").update({ status: v.status === "Aktif" ? "Tidak Aktif" : "Aktif" }).eq("id", id);
    fetchVendorKendaraan();
  };

  // ─── Divisi Kendaraan Handlers ───
  const filteredDivisiKendaraan = divisiKendaraanList.filter((d) =>
    d.nama.toLowerCase().includes(divisiKendaraanSearch.toLowerCase()) || (d.deskripsi || "").toLowerCase().includes(divisiKendaraanSearch.toLowerCase())
  );
  const handleOpenAddDivisiKendaraan = () => {
    setDivisiKendaraanForm({ nama: "", deskripsi: "", status: "Aktif" });
    setEditingDivisiKendaraanId(null);
    setShowDivisiKendaraanForm(true);
  };
  const handleOpenEditDivisiKendaraan = (d: VehicleDivision) => {
    setDivisiKendaraanForm({ nama: d.nama, deskripsi: d.deskripsi || "", status: d.status });
    setEditingDivisiKendaraanId(d.id);
    setShowDivisiKendaraanForm(true);
  };
  const handleSaveDivisiKendaraan = async () => {
    if (!divisiKendaraanForm.nama.trim()) return;
    const cleanNama = toUpperTrim(divisiKendaraanForm.nama.trim());
    if (editingDivisiKendaraanId !== null) {
      await supabase.from("ga_vehicle_divisions").update({ nama: cleanNama, deskripsi: divisiKendaraanForm.deskripsi.trim() || null, status: divisiKendaraanForm.status }).eq("id", editingDivisiKendaraanId);
      showSuccess("Divisi Diperbarui", `Data divisi "${cleanNama}" telah disimpan.`);
    } else {
      await supabase.from("ga_vehicle_divisions").insert({ nama: cleanNama, deskripsi: divisiKendaraanForm.deskripsi.trim() || null, status: divisiKendaraanForm.status });
      showSuccess("Divisi Ditambahkan", `Divisi "${cleanNama}" berhasil ditambahkan.`);
    }
    setShowDivisiKendaraanForm(false);
    fetchDivisiKendaraan();
  };
  const handleDeleteDivisiKendaraan = async (id: number) => {
    await supabase.from("ga_vehicle_divisions").delete().eq("id", id);
    setDeleteConfirm(null);
    showSuccess("Divisi Dihapus", "Data divisi telah dihapus.");
    fetchDivisiKendaraan();
  };
  const handleToggleDivisiKendaraanStatus = async (id: number) => {
    const d = divisiKendaraanList.find((x) => x.id === id);
    if (!d) return;
    await supabase.from("ga_vehicle_divisions").update({ status: d.status === "Aktif" ? "Tidak Aktif" : "Aktif" }).eq("id", id);
    fetchDivisiKendaraan();
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

  // ─── Vehicle Document Settings Handlers ───
  const fetchVehicleDocSettings = async () => {
    const { data } = await supabase.from("ga_vehicle_document_settings").select("*").eq("id", 1).maybeSingle();
    if (data) setVehicleDocSetting(data as DbGaVehicleDocumentSetting);
  };

  const handleOpenEditVehicleDocSettings = () => {
    if (!vehicleDocSetting) return;
    setVehicleDocSettingForm({
      kir_reminder_days: String(vehicleDocSetting.kir_reminder_days),
      stnk_reminder_days: String(vehicleDocSetting.stnk_reminder_days),
      pajak_reminder_days: String(vehicleDocSetting.pajak_reminder_days),
      kir_required_default: vehicleDocSetting.kir_required_default,
      stnk_required_default: vehicleDocSetting.stnk_required_default,
      pajak_required_default: vehicleDocSetting.pajak_required_default,
    });
    setShowVehicleDocSettingForm(true);
  };

  const handleSaveVehicleDocSettings = async () => {
    if (!vehicleDocSetting) return;
    const toDays = (value: string) => Math.max(1, Math.min(365, parseInt(value) || 30));
    const payload = {
      kir_reminder_days: toDays(vehicleDocSettingForm.kir_reminder_days),
      stnk_reminder_days: toDays(vehicleDocSettingForm.stnk_reminder_days),
      pajak_reminder_days: toDays(vehicleDocSettingForm.pajak_reminder_days),
      kir_required_default: vehicleDocSettingForm.kir_required_default,
      stnk_required_default: vehicleDocSettingForm.stnk_required_default,
      pajak_required_default: vehicleDocSettingForm.pajak_required_default,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("ga_vehicle_document_settings").update(payload).eq("id", vehicleDocSetting.id);
    if (error) return;
    await logAudit({
      supabase,
      action: "update",
      entityType: "ga_vehicle_document_settings",
      entityId: vehicleDocSetting.id,
      entityLabel: "Reminder Dokumen Kendaraan",
      oldData: vehicleDocSetting as unknown as Record<string, unknown>,
      newData: payload,
    });
    showSuccess("Pengaturan Dokumen Kendaraan Diperbarui", `Reminder KIR ${payload.kir_reminder_days} hari, STNK ${payload.stnk_reminder_days} hari, Pajak ${payload.pajak_reminder_days} hari.`);
    setShowVehicleDocSettingForm(false);
    fetchVehicleDocSettings();
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
                const count = tab.key === "level" ? levelList.length : tab.key === "jabatan" ? jabatanList.length : tab.key === "divisi" ? divisionList.length : tab.key === "titik-absen" ? locationList.length : tab.key === "waktu-kerja" ? scheduleList.length : tab.key === "denda-telat" ? penaltyList.length : tab.key === "nama-titik" ? zoneList.length : tab.key === "harga-titik" ? rateRows.length : tab.key === "status-titik" ? dStatusList.length : tab.key === "backup-libur" ? 1 : tab.key === "gapok" ? 1 : tab.key === "kendaraan" ? (vendorKendaraanList.length + divisiKendaraanList.length + 1) : tab.key === "legal" ? (legalSettings.length + companySettings.length) : bankList.length;
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
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Awal Absen</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Lembur/Jam</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={9} />
                  ) : filteredSchedules.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-10 text-sm text-muted-foreground">Tidak ada jadwal kerja ditemukan</td></tr>
                  ) : filteredSchedules.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((sch, idx) => (
                    <tr key={sch.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><span className="text-sm font-semibold text-foreground">{sch.divisionNama}</span></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono bg-primary-light text-primary px-2 py-1 rounded-md">{sch.jam_masuk.slice(0, 5)}</span></td>
                      <td className="px-5 py-3.5">{sch.jam_pulang ? <span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded-md">{sch.jam_pulang.slice(0, 5)}</span> : <span className="text-xs text-muted-foreground italic">-</span>}</td>
                      <td className="px-5 py-3.5"><span className="text-xs text-muted-foreground">{sch.toleransi_menit} menit</span></td>
                      <td className="px-5 py-3.5">
                        {(sch.awal_absen_menit ?? 0) > 0
                          ? <span className="text-xs text-muted-foreground">{sch.awal_absen_menit} menit</span>
                          : <span className="text-xs text-muted-foreground italic">-</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {(sch.overtime_rate_per_hour ?? 0) > 0
                          ? <span className="text-xs font-semibold text-foreground tabular-nums">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(sch.overtime_rate_per_hour)}</span>
                          : <span className="text-xs text-muted-foreground italic">-</span>}
                      </td>
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

        {/* ─── TAB: NAMA TITIK ─── */}
        {activeTab === "nama-titik" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari nama titik..." value={zoneSearch} onChange={(e) => { setZoneSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddZone}>Tambah Nama Titik</Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Titik</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Deskripsi</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={5} cols={5} />
                  ) : filteredZones.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Belum ada nama titik. Tambah dulu sebelum mengatur Harga Titik.</td></tr>
                  ) : filteredZones.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((zone, idx) => (
                    <tr key={zone.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: zone.color || "#3b82f6" }} />
                          <p className="text-sm font-semibold text-foreground">{zone.nama}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-[250px] truncate">{zone.deskripsi || <span className="italic">-</span>}</td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => handleToggleZoneStatus(zone.id)}
                          className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                            zone.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", zone.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                          {zone.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && <button onClick={() => handleOpenEditZone(zone)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "nama-titik", id: zone.id, nama: zone.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={masterPage} totalItems={filteredZones.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
          </>
        )}

        {/* ─── TAB: HARGA TITIK ─── */}
        {activeTab === "harga-titik" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari nama titik..." value={rateSearch} onChange={(e) => { setRateSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddRate} disabled={zonesWithoutRate.length === 0}>
                {activeZones.length === 0 ? "Belum Ada Nama Titik" : zonesWithoutRate.length === 0 ? "Semua Titik Sudah Ada" : "Tambah Harga Titik"}
              </Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Titik</th>
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
                    <tr key={row.zone_id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3.5"><span className="text-sm font-semibold text-foreground">{row.zoneNama}</span></td>
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
                          {canEdit && <button onClick={() => handleOpenEditRate(row)} title="Edit harga" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => handleOpenSyncDialog(row)} title="Sinkron harga ke rekap titik" className="p-1.5 rounded-lg hover:bg-accent-light text-muted-foreground hover:text-accent"><RefreshCw className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "harga-titik", id: row.zone_id, nama: row.zoneNama })} title="Hapus harga" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
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

        {/* ─── TAB: BACKUP LIBUR ─── */}
        {activeTab === "backup-libur" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Insentif Backup Libur</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Tambahan payroll dari Rekap Titik berstatus Backup Libur, dihitung sekali per pegawai, tanggal, dan role.</p>
              </div>
              {canEdit && <Button variant="outline" size="sm" icon={Pencil} onClick={handleOpenEditBackupLiburSettings}>Edit Nominal</Button>}
            </div>
            <div className="p-5 space-y-4">
              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                </div>
              ) : backupLiburSetting ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-border p-4 bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-foreground">Status Sumber</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Rekap Titik yang memicu tambahan.</p>
                        </div>
                        <Tag className="w-4 h-4 text-primary" />
                      </div>
                      <div className="mt-4 space-y-2">
                        <p className="text-lg font-bold text-foreground">{backupLiburSetting.delivery_statuses?.nama || "Backup Libur"}</p>
                        <span className="inline-flex text-[10px] font-mono text-muted-foreground bg-card border border-border px-2 py-0.5 rounded">{backupLiburSetting.delivery_statuses?.kode || "BKP-LB"}</span>
                      </div>
                    </div>
                    {[
                      { label: "Driver", amount: backupLiburSetting.driver_amount, tone: "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-500/10" },
                      { label: "Helper", amount: backupLiburSetting.helper_amount, tone: "text-orange-700 bg-orange-50 dark:text-orange-300 dark:bg-orange-500/10" },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-border p-4 bg-muted/20">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-foreground">{item.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Nominal per hari-role Backup Libur.</p>
                          </div>
                          <CircleDollarSign className="w-4 h-4 text-primary" />
                        </div>
                        <div className={cn("mt-4 rounded-xl px-3 py-2 inline-block", item.tone)}>
                          <p className="text-lg font-bold tabular-nums">{formatCurrency(item.amount)}</p>
                          <p className="text-[10px]">per pegawai/tanggal/role</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                    Perubahan nominal berlaku untuk Worksheet yang dihitung atau di-refresh setelah perubahan. Slip Draft dan Final tidak berubah otomatis.
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground text-center">
                  Pengaturan Backup Libur belum tersedia. Jalankan migrasi database terlebih dahulu.
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── TAB: GAPOK ─── */}
        {activeTab === "gapok" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Gaji Pokok (Gapok)</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Default gapok pegawai baru Driver/Helper dan kenaikan berkala per kelipatan masa kerja.</p>
              </div>
              {canEdit && <Button variant="outline" size="sm" icon={Pencil} onClick={handleOpenEditGapok}>Edit Pengaturan</Button>}
            </div>
            <div className="p-5 space-y-4">
              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                </div>
              ) : gapokSetting ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-2xl border border-border p-4 bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-foreground">Driver Default</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Gapok awal pegawai baru.</p>
                        </div>
                        <Banknote className="w-4 h-4 text-primary" />
                      </div>
                      <div className="mt-4 rounded-xl px-3 py-2 inline-block bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300">
                        <p className="text-lg font-bold tabular-nums">{formatCurrency(gapokSetting.driver_default_amount)}</p>
                        <p className="text-[10px]">{jabatanList.find((j) => j.id === gapokSetting.driver_jabatan_id)?.nama || "Driver"}</p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border p-4 bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-foreground">Helper Default</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Gapok awal pegawai baru.</p>
                        </div>
                        <Banknote className="w-4 h-4 text-primary" />
                      </div>
                      <div className="mt-4 rounded-xl px-3 py-2 inline-block bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300">
                        <p className="text-lg font-bold tabular-nums">{formatCurrency(gapokSetting.helper_default_amount)}</p>
                        <p className="text-[10px]">{jabatanList.find((j) => j.id === gapokSetting.helper_jabatan_id)?.nama || "Helper"}</p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border p-4 bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-foreground">Kenaikan Berkala</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Per kelipatan masa kerja.</p>
                        </div>
                        <TrendingUp className="w-4 h-4 text-primary" />
                      </div>
                      <div className="mt-4 rounded-xl px-3 py-2 inline-block bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        <p className="text-lg font-bold tabular-nums">+{formatCurrency(gapokSetting.increment_amount)}</p>
                        <p className="text-[10px]">per {(gapokSetting.interval_months / 12).toFixed(1).replace(/\.0$/, "")} tahun ({gapokSetting.interval_months} bln)</p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border p-4 bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-foreground">Notifikasi</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Jendela upcoming di HRM.</p>
                        </div>
                        <CalendarDays className="w-4 h-4 text-primary" />
                      </div>
                      <div className="mt-4 rounded-xl px-3 py-2 inline-block bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300">
                        <p className="text-lg font-bold tabular-nums">{gapokSetting.notification_days} hari</p>
                        <p className="text-[10px]">efektif {gapokSetting.effective_from}</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-border p-4 bg-card flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-warning" /></div>
                      <div><p className="text-xs text-muted-foreground">Jatuh Tempo / Terlambat</p><p className="text-lg font-bold text-foreground">{gapokPreview.loading ? "-" : gapokPreview.overdue}</p></div>
                    </div>
                    <div className="rounded-2xl border border-border p-4 bg-card flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><Clock className="w-5 h-5 text-primary" /></div>
                      <div><p className="text-xs text-muted-foreground">Akan Datang {gapokSetting.notification_days} Hari</p><p className="text-lg font-bold text-foreground">{gapokPreview.loading ? "-" : gapokPreview.upcoming90}</p></div>
                    </div>
                    <div className="rounded-2xl border border-border p-4 bg-card flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center"><Briefcase className="w-5 h-5 text-success" /></div>
                      <div><p className="text-xs text-muted-foreground">Pegawai Aktif Eligible</p><p className="text-lg font-bold text-foreground">{gapokPreview.loading ? "-" : gapokPreview.totalActive}</p></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                    Kenaikan diterapkan otomatis setiap hari 00:10 WIB oleh sistem (cron). Manual “Proses Sekarang” tersedia di HRM → Kenaikan Gapok. Perubahan nominal/interval akan menjadwalkan ulang event yang masih Scheduled; histori Applied tidak berubah.
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground text-center">
                  Pengaturan Gapok belum tersedia. Jalankan migrasi database terlebih dahulu.
                </div>
              )}
            </div>
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

        {/* ═══ TAB: KENDARAAN ═══ */}
        {activeTab === "kendaraan" && (
          <>
            {/* ─── Section: Vendor Kendaraan ─── */}
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Vendor Kendaraan</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Daftar vendor / perusahaan penyedia kendaraan.</p>
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddVendorKendaraan}>Tambah Vendor</Button>}
            </div>
            <div className="px-5 py-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56 mb-3">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari vendor..." value={vendorKendaraanSearch} onChange={(e) => { setVendorKendaraanSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nama Vendor</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Deskripsi</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Status</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {loading ? (
                      <SkeletonTable rows={5} cols={5} />
                    ) : filteredVendorKendaraan.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada vendor ditemukan</td></tr>
                    ) : filteredVendorKendaraan.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((v, idx) => (
                      <tr key={v.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{v.nama}</p></td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-[250px] truncate">{v.deskripsi || <span className="italic">-</span>}</td>
                        <td className="px-5 py-3.5">
                          <button onClick={() => handleToggleVendorKendaraanStatus(v.id)}
                            className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                              v.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                            <div className={cn("w-1.5 h-1.5 rounded-full", v.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                            {v.status}
                          </button>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-center gap-1">
                            {canEdit && <button onClick={() => handleOpenEditVendorKendaraan(v)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                            {canEdit && <button onClick={() => setDeleteConfirm({ type: "vendor-kendaraan", id: v.id, nama: v.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination currentPage={masterPage} totalItems={filteredVendorKendaraan.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
            </div>

            {/* ─── Section: Divisi Kendaraan ─── */}
            <div className="px-5 py-3 border-b border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Divisi Kendaraan</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Daftar divisi operasional untuk kendaraan.</p>
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={handleOpenAddDivisiKendaraan}>Tambah Divisi</Button>}
            </div>
            <div className="px-5 py-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-56 mb-3">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari divisi kendaraan..." value={divisiKendaraanSearch} onChange={(e) => { setDivisiKendaraanSearch(e.target.value); setMasterPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
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
                    ) : filteredDivisiKendaraan.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada divisi ditemukan</td></tr>
                    ) : filteredDivisiKendaraan.slice((masterPage - 1) * MASTER_PAGE_SIZE, masterPage * MASTER_PAGE_SIZE).map((d, idx) => (
                      <tr key={d.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{d.nama}</p></td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-[250px] truncate">{d.deskripsi || <span className="italic">-</span>}</td>
                        <td className="px-5 py-3.5">
                          <button onClick={() => handleToggleDivisiKendaraanStatus(d.id)}
                            className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                              d.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                            <div className={cn("w-1.5 h-1.5 rounded-full", d.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                            {d.status}
                          </button>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-center gap-1">
                            {canEdit && <button onClick={() => handleOpenEditDivisiKendaraan(d)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                            {canEdit && <button onClick={() => setDeleteConfirm({ type: "divisi-kendaraan", id: d.id, nama: d.nama })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination currentPage={masterPage} totalItems={filteredDivisiKendaraan.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPage} />
            </div>

            {/* ─── Section: Pengaturan Dokumen ─── */}
            <div className="px-5 py-3 border-b border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Pengaturan Dokumen</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Reminder KIR, STNK, dan pajak untuk modul Data Mobil.</p>
              </div>
              {canEdit && <Button variant="outline" size="sm" icon={Pencil} onClick={handleOpenEditVehicleDocSettings}>Edit Pengaturan</Button>}
            </div>
            <div className="p-5">
              {vehicleDocSetting ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { label: "KIR", reminder: vehicleDocSetting.kir_reminder_days, required: vehicleDocSetting.kir_required_default, desc: "Reminder masa berlaku KIR" },
                    { label: "STNK", reminder: vehicleDocSetting.stnk_reminder_days, required: vehicleDocSetting.stnk_required_default, desc: "Reminder masa berlaku STNK" },
                    { label: "Pajak", reminder: vehicleDocSetting.pajak_reminder_days, required: vehicleDocSetting.pajak_required_default, desc: "Reminder jatuh tempo pajak dari STNK" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-border p-4 bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-foreground">{item.label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</p>
                        </div>
                        <Truck className="w-4 h-4 text-primary" />
                      </div>
                      <div className="mt-4 flex items-center gap-3 flex-wrap">
                        <div className="bg-primary/10 text-primary rounded-xl px-3 py-2">
                          <p className="text-lg font-bold">{item.reminder} hari</p>
                          <p className="text-[10px]">sebelum expired</p>
                        </div>
                        <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full", item.required ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{item.required ? "Default Wajib" : "Default Tidak Wajib"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Memuat pengaturan dokumen kendaraan...</p>
              )}
            </div>
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

      {/* ═══ BACKUP LIBUR SETTINGS FORM MODAL ═══ */}
      {showBackupLiburForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBackupLiburForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CalendarDays className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-bold text-foreground">Edit Backup Libur</h2>
              </div>
              <button onClick={() => setShowBackupLiburForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nominal Driver <span className="text-danger">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatCurrencyInput(backupLiburForm.driver_amount)}
                    onChange={(e) => setBackupLiburForm({ ...backupLiburForm, driver_amount: String(parseCurrencyInput(e.target.value)) })}
                    className={cn(inputClass, "pl-9 text-right tabular-nums")}
                    placeholder="65.000"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nominal Helper <span className="text-danger">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatCurrencyInput(backupLiburForm.helper_amount)}
                    onChange={(e) => setBackupLiburForm({ ...backupLiburForm, helper_amount: String(parseCurrencyInput(e.target.value)) })}
                    className={cn(inputClass, "pl-9 text-right tabular-nums")}
                    placeholder="45.000"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-[10px] text-muted-foreground">
                Dihitung sekali per pegawai, tanggal, dan role pada Rekap Titik yang memakai status {backupLiburSetting?.delivery_statuses?.nama || "Backup Libur"}.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
              <Button variant="outline" size="sm" onClick={() => setShowBackupLiburForm(false)}>Batal</Button>
              <Button size="sm" icon={Check} onClick={handleSaveBackupLiburSettings}>Simpan</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ GAPOK SETTINGS FORM MODAL ═══ */}
      {showGapokForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowGapokForm(false)} />
          <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30 sticky top-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Banknote className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-bold text-foreground">Edit Pengaturan Gapok</h2>
              </div>
              <button onClick={() => setShowGapokForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jabatan Driver <span className="text-danger">*</span></label>
                  <select value={gapokForm.driver_jabatan_id} onChange={(e) => setGapokForm({ ...gapokForm, driver_jabatan_id: e.target.value })} className={selectClass}>
                    <option value="">Pilih jabatan</option>
                    {jabatanList.map((j) => <option key={j.id} value={String(j.id)}>{j.nama}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nominal Default Driver <span className="text-danger">*</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                    <input type="text" inputMode="numeric" value={formatCurrencyInput(gapokForm.driver_default_amount)} onChange={(e) => setGapokForm({ ...gapokForm, driver_default_amount: String(parseCurrencyInput(e.target.value)) })} className={cn(inputClass, "pl-9 text-right tabular-nums")} placeholder="2.000.000" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jabatan Helper <span className="text-danger">*</span></label>
                  <select value={gapokForm.helper_jabatan_id} onChange={(e) => setGapokForm({ ...gapokForm, helper_jabatan_id: e.target.value })} className={selectClass}>
                    <option value="">Pilih jabatan</option>
                    {jabatanList.map((j) => <option key={j.id} value={String(j.id)}>{j.nama}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nominal Default Helper <span className="text-danger">*</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                    <input type="text" inputMode="numeric" value={formatCurrencyInput(gapokForm.helper_default_amount)} onChange={(e) => setGapokForm({ ...gapokForm, helper_default_amount: String(parseCurrencyInput(e.target.value)) })} className={cn(inputClass, "pl-9 text-right tabular-nums")} placeholder="1.000.000" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Kenaikan per Kelipatan <span className="text-danger">*</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                    <input type="text" inputMode="numeric" value={formatCurrencyInput(gapokForm.increment_amount)} onChange={(e) => setGapokForm({ ...gapokForm, increment_amount: String(parseCurrencyInput(e.target.value)) })} className={cn(inputClass, "pl-9 text-right tabular-nums")} placeholder="250.000" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Interval Kelipatan (tahun) <span className="text-danger">*</span></label>
                  <input type="text" inputMode="decimal" value={gapokForm.interval_years} onChange={(e) => setGapokForm({ ...gapokForm, interval_years: e.target.value })} className={inputClass} placeholder="2.5" />
                  <p className="text-[10px] text-muted-foreground mt-1">{(parseFloat(gapokForm.interval_years.replace(",","."))||0)*12} bulan</p>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Jendela Notifikasi (hari) <span className="text-danger">*</span></label>
                <input type="number" min={1} max={365} value={gapokForm.notification_days} onChange={(e) => setGapokForm({ ...gapokForm, notification_days: e.target.value })} className={inputClass} placeholder="90" />
                <p className="text-[10px] text-muted-foreground mt-1">Pegawai dengan jatuh tempo dalam X hari akan tampil di HRM → Kenaikan Gapok dan notifikasi Dashboard.</p>
              </div>
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-[10px] text-amber-800 dark:text-amber-200">
                Mengubah jabatan, nominal, atau interval akan menjadwal ulang event Scheduled. Histori Applied tidak diubah. Pegawai baru Aktif dengan gapok 0 akan otomatis memakai nominal default sesuai jabatannya.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20 sticky bottom-0">
              <Button variant="outline" size="sm" onClick={() => setShowGapokForm(false)}>Batal</Button>
              <Button size="sm" icon={Check} onClick={handleSaveGapok}>Simpan</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ VEHICLE DOCUMENT SETTINGS FORM MODAL ═══ */}
      {showVehicleDocSettingForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowVehicleDocSettingForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Truck className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-bold text-foreground">Edit Dokumen Kendaraan</h2>
              </div>
              <button onClick={() => setShowVehicleDocSettingForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { key: "kir_reminder_days", label: "Reminder KIR" },
                { key: "stnk_reminder_days", label: "Reminder STNK" },
                { key: "pajak_reminder_days", label: "Reminder Pajak" },
              ].map((item) => (
                <div key={item.key}>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">{item.label} (hari) <span className="text-danger">*</span></label>
                  <input type="number" min={1} max={365} value={vehicleDocSettingForm[item.key as keyof typeof vehicleDocSettingForm] as string}
                    onChange={(e) => setVehicleDocSettingForm({ ...vehicleDocSettingForm, [item.key]: e.target.value })}
                    className={inputClass} placeholder="30" />
                </div>
              ))}
              <div className="rounded-xl border border-border p-3 bg-muted/20">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Default Dokumen Wajib untuk Unit Baru</p>
                <div className="space-y-2">
                  {[
                    { key: "kir_required_default", label: "KIR wajib secara default" },
                    { key: "stnk_required_default", label: "STNK wajib secara default" },
                    { key: "pajak_required_default", label: "Pajak wajib secara default" },
                  ].map((item) => (
                    <label key={item.key} className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={vehicleDocSettingForm[item.key as keyof typeof vehicleDocSettingForm] as boolean}
                        onChange={(e) => setVehicleDocSettingForm({ ...vehicleDocSettingForm, [item.key]: e.target.checked })}
                        className="rounded border-border text-primary focus:ring-primary" />
                      <span className="text-xs font-semibold text-foreground">{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Pajak tidak memiliki upload file terpisah. Tanggal pajak diambil dari data STNK kendaraan.</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
              <Button variant="outline" size="sm" onClick={() => setShowVehicleDocSettingForm(false)}>Batal</Button>
              <Button size="sm" icon={Check} onClick={handleSaveVehicleDocSettings}>Simpan</Button>
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
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Mulai Bisa Absen (Awal)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={720}
                    value={scheduleForm.awal_absen_menit}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, awal_absen_menit: e.target.value })}
                    className={inputClass}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">menit sebelum jam masuk</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {(() => {
                    const n = parseInt(scheduleForm.awal_absen_menit) || 0;
                    if (n <= 0) return "Set 0 untuk menonaktifkan. Pegawai bisa absen kapan saja sebelum jam masuk.";
                    const [hh, mm] = (scheduleForm.jam_masuk || "08:00").split(":").map((v) => parseInt(v) || 0);
                    const total = hh * 60 + mm - n;
                    if (total < 0) return `Window terlalu besar (>${hh * 60 + mm} menit dari tengah malam).`;
                    const eh = Math.floor(total / 60);
                    const em = total % 60;
                    const earliest = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
                    return `Pegawai bisa mulai absen pukul ${earliest} (${n} menit sebelum jam masuk ${scheduleForm.jam_masuk}).`;
                  })()}
                </p>
              </div>

              {/* Biaya Lembur per Jam (opsional) */}
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Biaya Lembur per Jam <span className="text-muted-foreground font-normal">(opsional)</span></label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">Rp</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={scheduleForm.overtime_rate_per_hour}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, overtime_rate_per_hour: e.target.value })}
                    className={inputClass}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/ jam</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {(() => {
                    const n = parseInt(scheduleForm.overtime_rate_per_hour) || 0;
                    if (n <= 0) return "Set 0 untuk menonaktifkan lembur. Pegawai divisi ini tidak bisa ajukan lembur.";
                    return `Pegawai divisi ini boleh ajukan lembur. Rate ${new Intl.NumberFormat("id-ID").format(n)}/jam akan di-snapshot ke pengajuan saat disetujui.`;
                  })()}
                </p>
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

      {/* ═══ NAMA TITIK FORM MODAL ═══ */}
      {showZoneForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowZoneForm(false)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingZoneId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingZoneId ? "Edit Nama Titik" : "Tambah Nama Titik Baru"}</h2>
              </div>
              <button onClick={() => setShowZoneForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Titik <span className="text-danger">*</span></label>
                  <input type="text" placeholder="Contoh: Cp Suka, Rkf Aeon" value={zoneForm.nama} onChange={(e) => setZoneForm({ ...zoneForm, nama: e.target.value })} className={inputClass} autoFocus />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Warna</label>
                  <input type="color" value={zoneForm.color} onChange={(e) => setZoneForm({ ...zoneForm, color: e.target.value })}
                    className="w-10 h-10 rounded-xl border border-border cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                <input type="text" placeholder="Deskripsi singkat (opsional)" value={zoneForm.deskripsi} onChange={(e) => setZoneForm({ ...zoneForm, deskripsi: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                <Select
                  value={zoneForm.status}
                  onChange={(val) => setZoneForm({ ...zoneForm, status: val })}
                  options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Nama Titik dipakai pada Harga Titik dan Rekap Titik. Tidak terkait dengan Divisi (yang dipakai untuk absensi).
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowZoneForm(false)}>Batal</Button>
              <Button size="sm" icon={editingZoneId ? Check : Plus} onClick={handleSaveZone} disabled={!zoneForm.nama.trim()}>
                {editingZoneId ? "Simpan" : "Tambah Nama Titik"}
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
                  {editingRateZoneId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingRateZoneId ? "Edit Harga Titik" : "Tambah Harga Titik"}</h2>
              </div>
              <button onClick={() => setShowRateForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Titik <span className="text-danger">*</span></label>
                {editingRateZoneId !== null ? (
                  <div className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-muted-foreground cursor-not-allowed">
                    {zoneList.find((z) => z.id === rateForm.zone_id)?.nama || "-"}
                  </div>
                ) : (
                  <Select
                    value={String(rateForm.zone_id)}
                    onChange={(val) => setRateForm({ ...rateForm, zone_id: parseInt(val) })}
                    options={zonesWithoutRate.map((z) => ({ value: String(z.id), label: z.nama }))}
                    placeholder={activeZones.length === 0 ? "Belum ada nama titik" : "Pilih nama titik"}
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
              <p className="text-[10px] text-muted-foreground">Isi minimal salah satu harga. Kosongkan jika role tersebut tidak berlaku untuk titik ini.</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowRateForm(false)}>Batal</Button>
              <Button size="sm" icon={editingRateZoneId ? Check : Plus} onClick={handleSaveRate} disabled={!rateForm.zone_id || (!rateForm.driver_rate && !rateForm.helper_rate)}>
                {editingRateZoneId ? "Simpan" : "Tambah"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ SINKRON HARGA TITIK MODAL ═══ */}
      {syncRow && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !syncRunning && setSyncRow(null)} />
          <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center flex-shrink-0">
                  <RefreshCw className="w-4 h-4 text-accent" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-foreground truncate">Sinkron Harga ke Rekap Titik</h2>
                  <p className="text-[10px] text-muted-foreground truncate">{syncRow.zoneNama}</p>
                </div>
              </div>
              <button onClick={() => !syncRunning && setSyncRow(null)} disabled={syncRunning} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-50 flex-shrink-0"><X className="w-4 h-4" /></button>
            </div>

            {/* Body (scrollable) */}
            <div className="px-5 py-4 space-y-3.5 flex-1 overflow-y-auto">
              {/* Harga baru — inline compact */}
              <div className="flex items-center gap-2 text-xs">
                {syncRow.driverRate !== null && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    Driver Rp {syncRow.driverRate.toLocaleString("id-ID")}
                  </span>
                )}
                {syncRow.helperRate !== null && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-500/10 text-orange-600 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                    Helper Rp {syncRow.helperRate.toLocaleString("id-ID")}
                  </span>
                )}
              </div>

              {/* Pilih periode */}
              <div>
                <label className="text-[11px] font-semibold text-foreground mb-1.5 block">Periode yang akan diperbarui</label>
                <div className="space-y-1.5">
                  <label className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors", syncMode === "active" ? "border-primary bg-primary-light/40" : "border-border hover:bg-muted/30")}>
                    <input type="radio" name="syncMode" checked={syncMode === "active"} onChange={() => setSyncMode("active")} className="accent-primary" disabled={syncRunning} />
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">Periode aktif</p>
                      <p className="text-[10px] text-muted-foreground truncate">{getActivePeriodRange().label}</p>
                    </div>
                  </label>
                  <label className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors", syncMode === "all" ? "border-primary bg-primary-light/40" : "border-border hover:bg-muted/30")}>
                    <input type="radio" name="syncMode" checked={syncMode === "all"} onChange={() => setSyncMode("all")} className="accent-primary" disabled={syncRunning} />
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">Semua periode</p>
                      <p className="text-[10px] text-warning truncate">Termasuk data lama</p>
                    </div>
                  </label>
                  <label className={cn("flex flex-col gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors", syncMode === "custom" ? "border-primary bg-primary-light/40" : "border-border hover:bg-muted/30")}>
                    <div className="flex items-center gap-2.5">
                      <input type="radio" name="syncMode" checked={syncMode === "custom"} onChange={() => setSyncMode("custom")} className="accent-primary" disabled={syncRunning} />
                      <p className="text-xs font-semibold text-foreground">Custom tanggal</p>
                    </div>
                    {syncMode === "custom" && (
                      <div className="grid grid-cols-2 gap-2 pl-6">
                        <input
                          type="date"
                          value={syncCustomStart}
                          onChange={(e) => setSyncCustomStart(e.target.value)}
                          disabled={syncRunning}
                          className={cn(inputClass, "py-1.5 text-xs disabled:opacity-50")}
                        />
                        <input
                          type="date"
                          value={syncCustomEnd}
                          onChange={(e) => setSyncCustomEnd(e.target.value)}
                          disabled={syncRunning}
                          className={cn(inputClass, "py-1.5 text-xs disabled:opacity-50")}
                        />
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {/* Preview ringkas */}
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning-light/40 border border-warning/30">
                <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-[11px] flex-1 min-w-0">
                  {syncPreview.loading ? (
                    <span className="text-muted-foreground">Menghitung preview...</span>
                  ) : syncMode === "custom" && (!syncCustomStart || !syncCustomEnd) ? (
                    <span className="text-muted-foreground">Isi tanggal mulai dan akhir untuk melihat preview.</span>
                  ) : (
                    <span className="text-foreground">
                      <strong>{syncPreview.driverCount + syncPreview.helperCount} entri</strong> akan diperbarui
                      {(syncPreview.driverCount > 0 || syncPreview.helperCount > 0) && <> · {syncPreview.driverCount} Driver, {syncPreview.helperCount} Helper</>}.
                      <span className="block text-[10px] text-muted-foreground mt-0.5">Pendapatan pegawai pada periode ini akan ikut berubah.</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30 rounded-b-2xl flex-shrink-0">
              <Button variant="outline" size="sm" onClick={() => setSyncRow(null)} disabled={syncRunning}>Batal</Button>
              <Button
                size="sm"
                icon={RefreshCw}
                onClick={handleExecuteSync}
                disabled={
                  syncRunning ||
                  syncPreview.loading ||
                  (syncMode === "custom" && (!syncCustomStart || !syncCustomEnd)) ||
                  (syncPreview.driverCount + syncPreview.helperCount === 0)
                }
              >
                {syncRunning ? "Memproses..." : "Sinkron Sekarang"}
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

      {/* ═══ VENDOR KENDARAAN FORM MODAL ═══ */}
      {showVendorKendaraanForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowVendorKendaraanForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingVendorKendaraanId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingVendorKendaraanId ? "Edit Vendor" : "Tambah Vendor Baru"}</h2>
              </div>
              <button onClick={() => setShowVendorKendaraanForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Vendor <span className="text-danger">*</span></label>
                <input type="text" placeholder="Contoh: CV. Maju Jaya" value={vendorKendaraanForm.nama} onChange={(e) => setVendorKendaraanForm({ ...vendorKendaraanForm, nama: e.target.value })} className={inputClass} autoFocus />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                <input type="text" placeholder="Deskripsi singkat vendor" value={vendorKendaraanForm.deskripsi} onChange={(e) => setVendorKendaraanForm({ ...vendorKendaraanForm, deskripsi: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                <Select
                  value={vendorKendaraanForm.status}
                  onChange={(val) => setVendorKendaraanForm({ ...vendorKendaraanForm, status: val })}
                  options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowVendorKendaraanForm(false)}>Batal</Button>
              <Button size="sm" icon={editingVendorKendaraanId ? Check : Plus} onClick={handleSaveVendorKendaraan} disabled={!vendorKendaraanForm.nama.trim()}>
                {editingVendorKendaraanId ? "Simpan" : "Tambah Vendor"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ═══ DIVISI KENDARAAN FORM MODAL ═══ */}
      {showDivisiKendaraanForm && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDivisiKendaraanForm(false)} />
          <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  {editingDivisiKendaraanId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h2 className="text-sm font-bold text-foreground">{editingDivisiKendaraanId ? "Edit Divisi" : "Tambah Divisi Baru"}</h2>
              </div>
              <button onClick={() => setShowDivisiKendaraanForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Divisi <span className="text-danger">*</span></label>
                <input type="text" placeholder="Contoh: Distribusi" value={divisiKendaraanForm.nama} onChange={(e) => setDivisiKendaraanForm({ ...divisiKendaraanForm, nama: e.target.value })} className={inputClass} autoFocus />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                <input type="text" placeholder="Deskripsi singkat divisi" value={divisiKendaraanForm.deskripsi} onChange={(e) => setDivisiKendaraanForm({ ...divisiKendaraanForm, deskripsi: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                <Select
                  value={divisiKendaraanForm.status}
                  onChange={(val) => setDivisiKendaraanForm({ ...divisiKendaraanForm, status: val })}
                  options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setShowDivisiKendaraanForm(false)}>Batal</Button>
              <Button size="sm" icon={editingDivisiKendaraanId ? Check : Plus} onClick={handleSaveDivisiKendaraan} disabled={!divisiKendaraanForm.nama.trim()}>
                {editingDivisiKendaraanId ? "Simpan" : "Tambah Divisi"}
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
              <h3 className="text-base font-bold text-foreground">Hapus {{ level: "Level", jabatan: "Jabatan", divisi: "Divisi", "titik-absen": "Titik Absen", "waktu-kerja": "Waktu Kerja", "denda-telat": "Denda Telat", "nama-titik": "Nama Titik", "harga-titik": "Harga Titik", "status-titik": "Status Titik", bank: "Bank", "vendor-kendaraan": "Vendor Kendaraan", "divisi-kendaraan": "Divisi Kendaraan" }[deleteConfirm.type]}?</h3>
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
                else if (deleteConfirm.type === "nama-titik") handleDeleteZone(deleteConfirm.id);
                else if (deleteConfirm.type === "harga-titik") handleDeleteRate(deleteConfirm.id);
                else if (deleteConfirm.type === "status-titik") handleDeleteDStatus(deleteConfirm.id);
                else if (deleteConfirm.type === "vendor-kendaraan") handleDeleteVendorKendaraan(deleteConfirm.id);
                else if (deleteConfirm.type === "divisi-kendaraan") handleDeleteDivisiKendaraan(deleteConfirm.id);
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
