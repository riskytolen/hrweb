"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Store,
  Thermometer,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LOGGER_TRIP_EXPORT_EXCEL_HEADERS,
  LOGGER_TRIP_EXPORT_PDF_HEADERS,
  PROFILE_TRIP_EXPORT_EXCEL_HEADERS,
  PROFILE_TRIP_EXPORT_PDF_HEADERS,
  loggerTripExportFileStamp,
  toLoggerTripExcelRow,
  toLoggerTripPdfRow,
  toProfileTripExcelRow,
  toProfileTripPdfRow,
  type ProfileTripExportRow,
} from "@/lib/tms-logger-export";
import {
  computeSlaCompliance,
  formatSlaCompliance,
  formatSlaDelta,
  slaKindLabel,
  slaStatusLabel,
} from "@/lib/tms-sla";
import RouteGuard from "@/components/RouteGuard";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import TmsClientSelector, { TMS_CLIENT_CHANGED_EVENT, readTmsClientParam } from "./TmsClientSelector";
import TripLoggerProfileView, {
  type ProfileInfoView,
  type ProfileMetaView,
  type ProfileRunView,
  type ProfileStopView,
} from "./TripLoggerProfileView";

/* ─── Tipe data ─── */

type TempStatus = "NORMAL" | "WASPADA" | "TINGGI";
type VisitStateFilter = "ALL" | "ONGOING" | "COMPLETED" | "INCOMPLETE" | "PENDING";
type SlaStateFilter = "ALL" | "ON_TIME" | "LATE" | "PENDING" | "UNSET";

interface TripLogRow {
  id: string;
  taskId: string;
  taskNumber: string | null;
  taskStatus: string | null;
  unit: string | null;
  driver: string | null;
  routeSequence: number;
  pointType: string | null;
  store: string | null;
  address: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  temperatureC: number | null;
  groupName: string | null;
  slaProfileCode: string | null;
  slaKind: string | null;
  slaTargetAt: string | null;
  slaStatus: string | null;
  slaDeltaSeconds: number | null;
}

interface SlaCounts {
  onTime: number;
  late: number;
  pending: number;
  unset: number;
  unevaluated: number;
}

interface SlaProfileOption {
  id: string;
  code: string;
  groupName: string | null;
}

type LoggerMode = "profile" | "list";

interface ProfileListResponse {
  data?: {
    profile: ProfileInfoView;
    stops: ProfileStopView[];
    runs: ProfileRunView[];
  };
  error?: string;
  meta?: ProfileMetaView | null;
}

interface VisitCounts {
  completed: number;
  ongoing: number;
  incomplete: number;
  pending: number;
}

interface ListResponse {
  data?: TripLogRow[];
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    counts?: VisitCounts | null;
    sla?: SlaCounts | null;
    lastSyncedAt?: string | null;
  };
}

const VISIT_FILTERS: { key: VisitStateFilter; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "ONGOING", label: "Di lokasi" },
  { key: "COMPLETED", label: "Selesai" },
  { key: "INCOMPLETE", label: "Waktu tak lengkap" },
  { key: "PENDING", label: "Belum dikunjungi" },
];

const SLA_FILTERS: { key: SlaStateFilter; label: string }[] = [
  { key: "ALL", label: "Semua SLA" },
  { key: "ON_TIME", label: "Tepat Waktu" },
  { key: "LATE", label: "Terlambat" },
  { key: "PENDING", label: "Belum Tiba" },
  { key: "UNSET", label: "SLA Belum Diatur" },
];

const PAGE_SIZE = 15;

/* ─── Helper ─── */

function jakartaDate(offsetDays = 0): string {
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
}

function getTempStatus(tempC: number): TempStatus {
  if (tempC > -5) return "TINGGI";
  if (tempC > -12) return "WASPADA";
  return "NORMAL";
}

function formatTime(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(parsed));
}

function formatDate(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(parsed));
}

function formatDateTimeShort(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(parsed),
  );
}

function durationSeconds(enteredAt: string | null, exitedAt: string | null): number | null {
  if (!enteredAt || !exitedAt) return null;
  const diff = Date.parse(exitedAt) - Date.parse(enteredAt);
  if (Number.isNaN(diff) || diff < 0) return null;
  return Math.round(diff / 1000);
}

function ongoingSeconds(enteredAt: string | null, nowMs: number): number | null {
  if (!enteredAt) return null;
  const start = Date.parse(enteredAt);
  if (Number.isNaN(start) || nowMs < start) return null;
  return Math.floor((nowMs - start) / 1000);
}

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return "–";
  if (totalSeconds < 60) return `${totalSeconds} dtk`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

function formatTemp(tempC: number | null): string {
  if (tempC === null) return "–";
  return `${tempC.toFixed(1).replace(".", ",")}°C`;
}

function KpiCard({
  icon: Icon,
  tileClass,
  label,
  value,
  sub,
}: {
  icon: typeof Truck;
  tileClass: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white", tileClass)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block text-2xl font-extrabold tabular-nums text-foreground">{value}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

function TempBadge({ tempC }: { tempC: number | null }) {
  if (tempC === null) return <span className="text-xs text-muted-foreground">–</span>;
  const status = getTempStatus(tempC);
  return (
    <Badge variant={status === "NORMAL" ? "success" : status === "WASPADA" ? "warning" : "danger"}>
      <Thermometer className="h-3 w-3" />
      {formatTemp(tempC)}
    </Badge>
  );
}

function VisitStateBadge({ row }: { row: TripLogRow }) {
  if (row.enteredAt && row.exitedAt) {
    return durationSeconds(row.enteredAt, row.exitedAt) === null ? (
      <Badge variant="warning">Waktu tak lengkap</Badge>
    ) : (
      <Badge variant="success">Selesai</Badge>
    );
  }
  if (row.enteredAt) return <Badge variant="info">Di lokasi</Badge>;
  if (row.exitedAt) return <Badge variant="warning">Waktu tak lengkap</Badge>;
  return <Badge variant="muted">Belum dikunjungi</Badge>;
}

function SlaBadge({ row }: { row: TripLogRow }) {
  if (!row.slaStatus) return <span className="text-xs text-muted-foreground">–</span>;
  const variant =
    row.slaStatus === "ON_TIME"
      ? "success"
      : row.slaStatus === "LATE"
        ? "danger"
        : row.slaStatus === "PENDING"
          ? "info"
          : "warning";
  return (
    <Badge variant={variant}>
      {slaStatusLabel(
        row.slaStatus as "ON_TIME" | "LATE" | "PENDING" | "UNSET",
        row.slaKind === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL",
      )}
    </Badge>
  );
}

function formatSlaTarget(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(parsed));
}

/* ─── Halaman ─── */

export default function TripLoggerPage() {
  const [rows, setRows] = useState<TripLogRow[]>([]);
  const [counts, setCounts] = useState<VisitCounts | null>(null);
  const [slaCounts, setSlaCounts] = useState<SlaCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [visitState, setVisitState] = useState<VisitStateFilter>("ALL");
  const [slaState, setSlaState] = useState<SlaStateFilter>("ALL");
  const [slaProfile, setSlaProfile] = useState("");
  const [slaProfiles, setSlaProfiles] = useState<SlaProfileOption[]>([]);
  // Mode tampilan: "profile" = logger per rute SLA (default), "list" = semua kunjungan.
  const [mode, setMode] = useState<LoggerMode>("profile");
  const [profileId, setProfileId] = useState("");
  const [profile, setProfile] = useState<ProfileInfoView | null>(null);
  const [profileStops, setProfileStops] = useState<ProfileStopView[]>([]);
  const [profileRuns, setProfileRuns] = useState<ProfileRunView[]>([]);
  const [profileMeta, setProfileMeta] = useState<ProfileMetaView | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSearch, setProfileSearch] = useState("");
  const [appliedProfileSearch, setAppliedProfileSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(() => jakartaDate(-6));
  const [dateTo, setDateTo] = useState(() => jakartaDate(0));
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [clientTick, setClientTick] = useState(0);

  useEffect(() => {
    const onClientChanged = () => {
      setPage(1);
      setSlaProfile("");
      setProfileId("");
      setProfileSearch("");
      setAppliedProfileSearch("");
      setClientTick((tick) => tick + 1);
    };
    window.addEventListener(TMS_CLIENT_CHANGED_EVENT, onClientChanged);
    return () => window.removeEventListener(TMS_CLIENT_CHANGED_EVENT, onClientChanged);
  }, []);

  // Parameter list dipakai bersama tabel dan export agar isi file
  // selalu konsisten dengan filter yang sedang aktif.
  const buildListParams = useCallback(
    (pageNum: number, limitNum: number) => {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(limitNum),
        dateFrom,
        dateTo,
      });
      if (visitState !== "ALL") params.set("visitState", visitState);
      if (slaState !== "ALL") params.set("sla", slaState);
      if (slaProfile) params.set("slaProfile", slaProfile);
      if (appliedSearch) params.set("search", appliedSearch);
      const clientParam = readTmsClientParam();
      if (clientParam) params.set("client", clientParam);
      return params;
    },
    [appliedSearch, dateFrom, dateTo, slaProfile, slaState, visitState],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildListParams(page, PAGE_SIZE);

      const response = await fetch(`/api/tms/logger-trips?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as ListResponse;
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal memuat Logger Trips.");
        // Reset agar tidak tampil error + sisa angka/list dari filter sebelumnya.
        setRows([]);
        setTotal(0);
        setCounts(null);
        setSlaCounts(null);
        return;
      }
      setRows(Array.isArray(payload.data) ? payload.data : []);
      setCounts(payload.meta?.counts ?? null);
      setSlaCounts(payload.meta?.sla ?? null);
      setTotal(payload.meta?.total ?? 0);
      setLastSyncedAt(payload.meta?.lastSyncedAt ?? null);
    } catch {
      setError("Gagal memuat Logger Trips.");
      setRows([]);
      setTotal(0);
      setCounts(null);
      setSlaCounts(null);
    } finally {
      setLoading(false);
    }
  }, [buildListParams, page]);

  // Daftar profil SLA dalam scope client aktif untuk filter profil.
  // Memakai endpoint operasional Logger (bukan /api/tms/sla-profiles yang
  // khusus Pengaturan SLA internal) agar akun client ikut mendapat daftar.
  const [slaProfilesError, setSlaProfilesError] = useState<string | null>(null);
  const [slaProfilesLoading, setSlaProfilesLoading] = useState(false);
  const loadSlaProfiles = useCallback(async () => {
    setSlaProfilesError(null);
    setSlaProfilesLoading(true);
    try {
      const params = new URLSearchParams();
      const clientParam = readTmsClientParam();
      if (clientParam) params.set("client", clientParam);
      const query = params.toString();
      const response = await fetch(`/api/tms/logger-trips/profiles${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { data?: SlaProfileOption[]; error?: string };
      if (!response.ok || payload.error || !Array.isArray(payload.data)) {
        throw new Error(payload.error ?? "Gagal memuat profil SLA.");
      }
      const list = payload.data;
      setSlaProfiles(list);
      // Profil terpilih yang hilang dari daftar baru ikut direset.
      setProfileId((prev) => (prev && list.some((p) => p.id === prev) ? prev : ""));
      return;
    } catch (err) {
      // Kegagalan request TIDAK disamarkan sebagai "belum ada profil".
      setSlaProfilesError(err instanceof Error ? err.message : "Gagal memuat profil SLA.");
    } finally {
      setSlaProfilesLoading(false);
    }
    setSlaProfiles([]);
  }, []);

  useEffect(() => {
    // clientTick memicu muat ulang saat pilihan client berubah.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSlaProfiles();
  }, [loadSlaProfiles, clientTick]);

  // Logger per profil: perjalanan dikelompokkan per FO + tanggal layanan,
  // titik berurutan sesuai route_order SLA.
  const loadProfileRuns = useCallback(
    async (pid: string) => {
      if (!pid) return;
      setProfileLoading(true);
      setProfileError(null);
      try {
        const params = new URLSearchParams({ profileId: pid, dateFrom, dateTo });
        if (appliedProfileSearch) params.set("search", appliedProfileSearch);
        const clientParam = readTmsClientParam();
        if (clientParam) params.set("client", clientParam);
        const response = await fetch(`/api/tms/logger-trips/by-profile?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as ProfileListResponse;
        if (!response.ok || payload.error || !payload.data) {
          throw new Error(payload.error ?? "Gagal memuat logger profil.");
        }
        setProfile(payload.data.profile);
        setProfileStops(Array.isArray(payload.data.stops) ? payload.data.stops : []);
        setProfileRuns(Array.isArray(payload.data.runs) ? payload.data.runs : []);
        setProfileMeta(payload.meta ?? null);
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : "Gagal memuat logger profil.");
        setProfile(null);
        setProfileStops([]);
        setProfileRuns([]);
        setProfileMeta(null);
      } finally {
        setProfileLoading(false);
      }
    },
    [appliedProfileSearch, dateFrom, dateTo],
  );

  // Default ke profil pertama bila daftar profil tersedia.
  useEffect(() => {
    if (mode !== "profile" || profileId || slaProfiles.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileId(slaProfiles[0].id);
  }, [mode, profileId, slaProfiles]);

  useEffect(() => {
    if (mode !== "profile" || !profileId) return;
    // clientTick memicu muat ulang saat pilihan client berubah.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfileRuns(profileId);
  }, [mode, profileId, loadProfileRuns, clientTick]);

  // Baris datar export mode profil: satu baris per titik per perjalanan.
  const buildProfileExportRows = useCallback((): ProfileTripExportRow[] => {
    const rows: ProfileTripExportRow[] = [];
    for (const run of profileRuns) {
      for (const stop of profileStops) {
        const visit = run.stopVisits[stop.id] ?? null;
        rows.push({
          serviceDate: run.serviceDate,
          taskNumber: run.taskNumber,
          unit: run.unit,
          driver: run.driver,
          routeOrder: stop.routeOrder,
          storeName: stop.storeName,
          slaKind: visit?.slaKind ?? (stop.kind === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL"),
          scheduleTarget: stop.targetTime,
          slaTargetAt: visit?.slaTargetAt ?? null,
          enteredAt: visit?.enteredAt ?? null,
          exitedAt: visit?.exitedAt ?? null,
          slaStatus: visit ? (visit.slaStatus ?? "UNSET") : "PENDING",
          slaDeltaSeconds: visit?.slaDeltaSeconds ?? null,
          temperatureC: visit?.temperatureC ?? null,
        });
      }
    }
    return rows;
  }, [profileRuns, profileStops]);

  const exportProfileXlsx = useCallback(async () => {
    setExporting("xlsx");
    try {
      const rows = buildProfileExportRows();
      const code = profile?.code ?? "profil";
      const stamp = loggerTripExportFileStamp();
      const meta: string[][] = [
        [`Logger ${code}`],
        ["Periode", `${dateFrom} s/d ${dateTo}`],
        ["Perjalanan", String(profileRuns.length)],
        ...(appliedProfileSearch ? [["Pencarian", appliedProfileSearch]] : []),
        ["Total titik", String(rows.length)],
        [],
      ];
      const headerIndex = meta.length;
      const sheetRows: string[][] = [
        ...meta,
        [...PROFILE_TRIP_EXPORT_EXCEL_HEADERS],
        ...rows.map((row, index) => toProfileTripExcelRow(row, index)),
      ];
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
      sheet["!cols"] = [
        { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 22 },
        { wch: 8 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 20 },
        { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 10 },
      ];
      const lastRow = sheetRows.length - 1;
      const lastCol = PROFILE_TRIP_EXPORT_EXCEL_HEADERS.length - 1;
      sheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({ s: { r: headerIndex, c: 0 }, e: { r: lastRow, c: lastCol } }),
      };
      XLSX.utils.book_append_sheet(workbook, sheet, code.slice(0, 28));
      XLSX.writeFile(workbook, `logger-${code}-${dateFrom}_${dateTo}-${stamp}.xlsx`);
    } catch {
      setProfileError("Gagal mengekspor Excel. Coba lagi.");
    } finally {
      setExporting(null);
    }
  }, [appliedProfileSearch, buildProfileExportRows, dateFrom, dateTo, profile?.code, profileRuns.length]);

  const exportProfilePdf = useCallback(async () => {
    setExporting("pdf");
    try {
      const rows = buildProfileExportRows();
      const code = profile?.code ?? "profil";
      const stamp = loggerTripExportFileStamp();
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(`Logger ${code}`, pageWidth / 2, 14, { align: "center" });
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Periode: ${dateFrom} s/d ${dateTo} · ${profileRuns.length} perjalanan · ${rows.length} titik`, pageWidth / 2, 20, {
        align: "center",
      });
      autoTable(doc, {
        startY: 27,
        head: [[...PROFILE_TRIP_EXPORT_PDF_HEADERS]],
        body: rows.map((row, index) => toProfileTripPdfRow(row, index)),
        styles: { fontSize: 8, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { halign: "right", cellWidth: 10 },
          1: { cellWidth: 56 },
          2: { cellWidth: 20 },
          3: { cellWidth: 28 },
          4: { cellWidth: 28 },
          5: { cellWidth: 30 },
          6: { cellWidth: 30 },
          7: { halign: "right", cellWidth: 20 },
        },
        didDrawPage: () => {
          const page = doc.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(`Halaman ${page}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, {
            align: "right",
          });
        },
      });
      doc.save(`logger-${code}-${dateFrom}_${dateTo}-${stamp}.pdf`);
    } catch {
      setProfileError("Gagal mengekspor PDF. Coba lagi.");
    } finally {
      setExporting(null);
    }
  }, [buildProfileExportRows, dateFrom, dateTo, profile?.code, profileRuns.length]);

  // Ambil seluruh data sesuai filter aktif (loop paging server, maks 100/halaman).
  const fetchAllFilteredRows = useCallback(async (): Promise<TripLogRow[]> => {
    const all: TripLogRow[] = [];
    let pageNum = 1;
    for (;;) {
      const params = buildListParams(pageNum, 100);
      const response = await fetch(`/api/tms/logger-trips?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as ListResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Gagal memuat data export.");
      }
      const batch = Array.isArray(payload.data) ? payload.data : [];
      all.push(...batch);
      const totalCount = payload.meta?.total ?? 0;
      if (all.length >= totalCount || batch.length < 100) break;
      pageNum += 1;
      if (pageNum > 50) break; // Batas aman: 5000 baris.
    }
    return all;
  }, [buildListParams]);

  const visitFilterLabel = useMemo(
    () => VISIT_FILTERS.find((filter) => filter.key === visitState)?.label ?? "Semua",
    [visitState],
  );

  const slaFilterLabel = useMemo(
    () => SLA_FILTERS.find((filter) => filter.key === slaState)?.label ?? "Semua SLA",
    [slaState],
  );

  const slaComplianceLabel = useMemo(
    () =>
      formatSlaCompliance(
        computeSlaCompliance(slaCounts?.onTime ?? 0, slaCounts?.late ?? 0),
      ),
    [slaCounts],
  );

  const exportXlsx = useCallback(async () => {
    setExporting("xlsx");
    try {
      const all = await fetchAllFilteredRows();
      const stamp = loggerTripExportFileStamp();
      const now = Date.now();
      const meta: string[][] = [
        ["Laporan Logger Trips"],
        ["Periode", `${dateFrom} s/d ${dateTo}`],
        ["Status", visitFilterLabel],
        ["Status SLA", slaFilterLabel],
        ...(appliedSearch ? [["Pencarian", appliedSearch]] : []),
        ["Total kunjungan", String(all.length)],
        [],
      ];
      const headerIndex = meta.length;
      const sheetRows: string[][] = [
        ...meta,
        [...LOGGER_TRIP_EXPORT_EXCEL_HEADERS],
        ...all.map((row, index) => toLoggerTripExcelRow(row, index, now)),
      ];
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
      sheet["!cols"] = [
        { wch: 6 },
        { wch: 16 },
        { wch: 14 },
        { wch: 28 },
        { wch: 36 },
        { wch: 22 },
        { wch: 20 },
        { wch: 20 },
        { wch: 14 },
        { wch: 16 },
        { wch: 10 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 20 },
        { wch: 16 },
        { wch: 20 },
      ];
      const lastRow = sheetRows.length - 1;
      const lastCol = LOGGER_TRIP_EXPORT_EXCEL_HEADERS.length - 1;
      sheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({ s: { r: headerIndex, c: 0 }, e: { r: lastRow, c: lastCol } }),
      };
      XLSX.utils.book_append_sheet(workbook, sheet, "Logger Trips");
      XLSX.writeFile(workbook, `logger-trips-${stamp}.xlsx`);
    } catch {
      setError("Gagal mengekspor Excel. Coba lagi.");
    } finally {
      setExporting(null);
    }
  }, [appliedSearch, dateFrom, dateTo, fetchAllFilteredRows, slaFilterLabel, visitFilterLabel]);

  const exportPdf = useCallback(async () => {
    setExporting("pdf");
    try {
      const all = await fetchAllFilteredRows();
      const stamp = loggerTripExportFileStamp();
      const now = Date.now();
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Laporan Logger Trips", pageWidth / 2, 14, { align: "center" });
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Periode: ${dateFrom} s/d ${dateTo} · Status: ${visitFilterLabel} · SLA: ${slaFilterLabel}`, pageWidth / 2, 20, {
        align: "center",
      });
      doc.text(
        `Total kunjungan: ${all.length}${appliedSearch ? ` · Cari: ${appliedSearch}` : ""}`,
        pageWidth / 2,
        25,
        { align: "center" },
      );

      autoTable(doc, {
        startY: 32,
        head: [[...LOGGER_TRIP_EXPORT_PDF_HEADERS]],
        body: all.map((row, index) => toLoggerTripPdfRow(row, index, now)),
        styles: { fontSize: 8, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { halign: "right", cellWidth: 10 },
          1: { cellWidth: 22 },
          2: { cellWidth: 52 },
          3: { cellWidth: 34 },
          4: { cellWidth: 26 },
          5: { cellWidth: 26 },
          6: { cellWidth: 20 },
          7: { cellWidth: 26 },
          8: { cellWidth: 30 },
          9: { halign: "right", cellWidth: 18 },
        },
        didDrawPage: () => {
          const page = doc.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(`Halaman ${page}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, {
            align: "right",
          });
        },
      });

      doc.save(`logger-trips-${stamp}.pdf`);
    } catch {
      setError("Gagal mengekspor PDF. Coba lagi.");
    } finally {
      setExporting(null);
    }
  }, [appliedSearch, dateFrom, dateTo, fetchAllFilteredRows, slaFilterLabel, visitFilterLabel]);

  useEffect(() => {
    // clientTick memicu muat ulang saat pilihan client berubah.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, clientTick]);

  // Perbarui durasi berjalan tiap 30 detik.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const handleSearch = useCallback(() => {
    setPage(1);
    setAppliedSearch(search.trim());
  }, [search]);

  return (
    <RouteGuard permission="tms.logger-trips">
      <div className="space-y-5">
        <PageHeader
          title="Logger Trips"
          description="Waktu masuk dan keluar unit di setiap titik kunjungan beserta suhu kargo"
          icon={Clock3}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <TmsClientSelector compact />
              <Button
                size="sm"
                variant="outline"
                icon={FileSpreadsheet}
                disabled={loading || profileLoading || exporting !== null}
                onClick={() => void (mode === "profile" ? exportProfileXlsx() : exportXlsx())}
              >
                {exporting === "xlsx" ? "Menyiapkan…" : "Export Excel"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={FileText}
                disabled={loading || profileLoading || exporting !== null}
                onClick={() => void (mode === "profile" ? exportProfilePdf() : exportPdf())}
              >
                {exporting === "pdf" ? "Menyiapkan…" : "Export PDF"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={RefreshCw}
                disabled={loading || profileLoading}
                onClick={() => {
                  if (mode === "profile") void loadProfileRuns(profileId);
                  else void load();
                }}
              >
                Muat ulang
              </Button>
            </div>
          }
        />

        {mode === "list" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard icon={Store} tileClass="bg-sky-500" label="Total kunjungan" value={String(total)} sub={lastSyncedAt ? `Sinkron ${formatDateTimeShort(lastSyncedAt)}` : "Sinkronisasi McEasy"} />
              <KpiCard icon={Truck} tileClass="bg-violet-500" label="Sedang di lokasi" value={String(counts?.ongoing ?? 0)} sub="sudah masuk, belum keluar" />
              <KpiCard icon={CheckCircle2} tileClass="bg-emerald-500" label="Kunjungan selesai" value={String(counts?.completed ?? 0)} sub="masuk & keluar tercatat" />
              <KpiCard icon={AlertTriangle} tileClass={(counts?.incomplete ?? 0) > 0 ? "bg-amber-500" : "bg-slate-400"} label="Waktu tak lengkap" value={String(counts?.incomplete ?? 0)} sub="perlu validasi data" />
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-2xl border border-border bg-card px-4 py-3 text-xs shadow-sm">
              <span className="font-bold text-foreground">SLA Kedatangan</span>
              <span className="tabular-nums text-muted-foreground">
                Tepat Waktu <strong className="text-emerald-600">{slaCounts?.onTime ?? 0}</strong>
              </span>
              <span className="tabular-nums text-muted-foreground">
                Terlambat <strong className="text-danger">{slaCounts?.late ?? 0}</strong>
              </span>
              <span className="tabular-nums text-muted-foreground">
                Belum Tiba/Berangkat <strong className="text-sky-600">{slaCounts?.pending ?? 0}</strong>
              </span>
              <span className="tabular-nums text-muted-foreground">
                Tanpa SLA <strong className="text-amber-600">{slaCounts?.unset ?? 0}</strong>
              </span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                Kepatuhan <strong className="text-base text-foreground">{slaComplianceLabel}</strong>
              </span>
            </div>
          </>
        )}

        {/* Mode tampilan: logger per rute SLA atau semua kunjungan */}
        <div
          role="tablist"
          aria-label="Mode tampilan logger"
          className="flex gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-sm"
        >
          {(
            [
              { key: "profile", label: "Per Profil SLA" },
              { key: "list", label: "Semua Kunjungan" },
            ] as { key: LoggerMode; label: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={mode === tab.key}
              onClick={() => setMode(tab.key)}
              className={cn(
                "flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors sm:flex-none sm:px-6",
                mode === tab.key ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === "profile" ? (
          <div className="space-y-3">
            {/* Filter tanggal + pencarian FO/unit/driver */}
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="date"
                  aria-label="Tanggal mulai"
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  value={dateFrom}
                  max={dateTo}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
                <span className="text-muted-foreground">s.d.</span>
                <input
                  type="date"
                  aria-label="Tanggal akhir"
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  value={dateTo}
                  min={dateFrom}
                  max={jakartaDate(0)}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-xs"
                  placeholder="Cari nomor FO, unit, atau driver"
                  aria-label="Cari nomor FO, unit, atau driver"
                  value={profileSearch}
                  onChange={(event) => setProfileSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setAppliedProfileSearch(profileSearch.trim());
                  }}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => setAppliedProfileSearch(profileSearch.trim())}>
                Cari
              </Button>
            </div>

            {/* Chip profil rute SLA */}
            <div
              role="tablist"
              aria-label="Profil rute SLA"
              aria-busy={slaProfilesLoading}
              className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card p-2.5 shadow-sm"
            >
              {slaProfilesError ? (
                <p className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs text-danger" role="alert">
                  <span>{slaProfilesError}</span>
                  <Button size="sm" variant="outline" onClick={() => void loadSlaProfiles()}>
                    Coba lagi
                  </Button>
                </p>
              ) : slaProfilesLoading && slaProfiles.length === 0 ? (
                <div className="flex items-center gap-1.5" aria-label="Memuat profil SLA">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <span key={index} className="h-7 w-20 shrink-0 animate-pulse rounded-full bg-muted" />
                  ))}
                  <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Memuat profil SLA…
                  </span>
                </div>
              ) : (
                slaProfiles.length === 0 &&
                !profileLoading && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    Belum ada profil SLA untuk client ini. Hubungi administrator bila rute seharusnya sudah tersedia.
                  </p>
                )
              )}
              {slaProfiles.map((item) => {
                const isActive = profileId === item.id;
                const isRefreshing = isActive && (slaProfilesLoading || profileLoading);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setProfileId(item.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold tabular-nums transition-colors",
                      isActive ? "bg-primary text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    {isRefreshing && <Loader2 className="h-3 w-3 animate-spin" aria-label="Memuat data profil" />}
                    {item.code}
                  </button>
                );
              })}
            </div>

            <TripLoggerProfileView
              profile={profile}
              stops={profileStops}
              runs={profileRuns}
              meta={profileMeta}
              loading={profileLoading}
              error={profileError}
              onRetry={() => void loadProfileRuns(profileId)}
            />
          </div>
        ) : (
        <div className="rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-xs"
                  placeholder="Cari unit, toko, driver, atau nomor FO"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleSearch();
                  }}
                />
              </div>
              <Button size="sm" variant="outline" onClick={handleSearch}>
                Cari
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                aria-label="Tanggal mulai"
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
              />
              <span className="text-muted-foreground">s.d.</span>
              <input
                type="date"
                aria-label="Tanggal akhir"
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                value={dateTo}
                min={dateFrom}
                max={jakartaDate(0)}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
            {VISIT_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  setVisitState(filter.key);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  visitState === filter.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
            {SLA_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  setSlaState(filter.key);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  slaState === filter.key ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {filter.label}
              </button>
            ))}
            {slaProfilesLoading && slaProfiles.length === 0 && !slaProfilesError && (
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Memuat profil…
              </span>
            )}
            {slaProfiles.length > 0 && (
              <select
                aria-label="Filter profil rute SLA"
                className="ml-auto rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
                value={slaProfile}
                onChange={(event) => {
                  setSlaProfile(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Semua profil rute</option>
                {slaProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.groupName ? `${profile.groupName} · ${profile.code}` : profile.code}
                  </option>
                ))}
              </select>
            )}
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : error ? (
            <p className="px-4 py-10 text-center text-sm text-danger">{error}</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Belum ada catatan kunjungan pada rentang ini. Sinkronisasi McEasy berjalan setiap 2 menit.
            </p>
          ) : (
            <>
              {/* Tabel desktop */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1320px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">Unit</th>
                      <th className="px-4 py-3 font-semibold">Nama Toko</th>
                      <th className="px-4 py-3 font-semibold">Profil SLA</th>
                      <th className="px-4 py-3 font-semibold">Driver</th>
                      <th className="px-4 py-3 font-semibold">Masuk Toko</th>
                      <th className="px-4 py-3 font-semibold">Keluar Toko</th>
                      <th className="px-4 py-3 font-semibold">Target SLA</th>
                      <th className="px-4 py-3 font-semibold">Durasi di Toko</th>
                      <th className="px-4 py-3 font-semibold">Status SLA</th>
                      <th className="px-4 py-3 font-semibold">Selisih</th>
                      <th className="px-4 py-3 font-semibold">Kunjungan</th>
                      <th className="px-4 py-3 font-semibold">Suhu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const inProgress = !!row.enteredAt && !row.exitedAt;
                      const secs = inProgress
                        ? ongoingSeconds(row.enteredAt, nowMs)
                        : durationSeconds(row.enteredAt, row.exitedAt);
                      return (
                        <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-bold tabular-nums text-foreground">{row.unit ?? "–"}</p>
                            <p className="text-[11px] text-muted-foreground">{row.taskNumber ?? "–"}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold text-foreground">{row.store ?? `Titik ${row.routeSequence}`}</p>
                            <p className="max-w-56 truncate text-[11px] text-muted-foreground" title={row.address ?? undefined}>
                              {row.address ?? "–"}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            {row.slaProfileCode ? (
                              <>
                                <p className="text-xs font-bold tabular-nums text-foreground">{row.slaProfileCode}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {row.groupName ?? "–"} · {slaKindLabel(row.slaKind === "DEPARTURE" || row.slaKind === "ARRIVAL" ? row.slaKind : null)}
                                </p>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">–</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground">{row.driver ?? "–"}</td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-extrabold tabular-nums text-foreground">{formatTime(row.enteredAt)}</p>
                            <p className="text-[11px] text-muted-foreground">{formatDate(row.enteredAt)}</p>
                          </td>
                          <td className="px-4 py-3">
                            {row.exitedAt ? (
                              <>
                                <p className="text-sm font-extrabold tabular-nums text-foreground">{formatTime(row.exitedAt)}</p>
                                <p className="text-[11px] text-muted-foreground">{formatDate(row.exitedAt)}</p>
                              </>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                                Di lokasi
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-extrabold tabular-nums text-foreground">{formatSlaTarget(row.slaTargetAt)}</p>
                            <p className="text-[11px] text-muted-foreground">{row.slaTargetAt ? formatDate(row.slaTargetAt) : ""}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-semibold tabular-nums text-foreground">{formatDuration(secs)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <SlaBadge row={row} />
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs tabular-nums text-foreground">{formatSlaDelta(row.slaDeltaSeconds)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <VisitStateBadge row={row} />
                          </td>
                          <td className="px-4 py-3">
                            <TempBadge tempC={row.temperatureC} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Kartu mobile */}
              <div className="space-y-2.5 p-4 lg:hidden">
                {rows.map((row) => {
                  const inProgress = !!row.enteredAt && !row.exitedAt;
                  const secs = inProgress
                    ? ongoingSeconds(row.enteredAt, nowMs)
                    : durationSeconds(row.enteredAt, row.exitedAt);
                  return (
                    <article key={row.id} className="rounded-xl border border-border bg-background p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{row.store ?? `Titik ${row.routeSequence}`}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{row.address ?? row.taskNumber ?? "–"}</p>
                        </div>
                        <VisitStateBadge row={row} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Truck className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-mono font-semibold tabular-nums text-foreground">{row.unit ?? "–"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-foreground">{row.driver ?? "–"}</span>
                        </div>
                        <div className="col-span-2 flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-2">
                          <span className="tabular-nums text-foreground">
                            Masuk <strong className="text-sm">{formatTime(row.enteredAt)}</strong>
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="tabular-nums text-foreground">
                            {row.exitedAt ? <>Keluar <strong className="text-sm">{formatTime(row.exitedAt)}</strong></> : <strong className="text-sky-600">Di lokasi</strong>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Durasi</span>
                          <span className="font-semibold tabular-nums text-foreground">{formatDuration(secs)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Suhu</span>
                          <TempBadge tempC={row.temperatureC} />
                        </div>
                        <div className="col-span-2 flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-2">
                          <span className="tabular-nums text-foreground">
                            Target <strong className="text-sm">{formatSlaTarget(row.slaTargetAt)}</strong>
                            {row.slaProfileCode ? ` · ${row.slaProfileCode}` : ""}
                          </span>
                          <SlaBadge row={row} />
                        </div>
                        {row.slaDeltaSeconds !== null && row.slaDeltaSeconds !== undefined && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Selisih SLA</span>
                            <span className="font-semibold tabular-nums text-foreground">{formatSlaDelta(row.slaDeltaSeconds)}</span>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  Halaman {page} dari {totalPages} · {total} kunjungan
                </span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            </>
          )}
        </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Waktu masuk/keluar berasal dari timeline Fleet Task McEasy. Suhu hanya tampil bila ada hasil capture perangkat; jika kosong berarti belum ada snapshot suhu untuk titik tersebut.
          SLA dihitung dari jadwal internal client per kelompok kendaraan (mis. profil VAN Tuku CP); baris tanpa konfigurasi SLA berstatus “SLA Belum Diatur”.
        </p>
      </div>
    </RouteGuard>
  );
}
