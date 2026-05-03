"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Shield,
  Smartphone,
  ScanFace,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Check,
  CircleCheckBig,
  AlertTriangle,
  Upload,
  RefreshCw,
  Loader2,
  Image as ImageIcon,
  QrCode,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import {
  supabase,
  type DbEmployeeDevice,
  type DbEmployeeFaceProfile,
} from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type EmployeeLite = {
  id: string;
  nama: string;
  status: "Aktif" | "Tidak Aktif" | "Cuti";
};

type DeviceRow = DbEmployeeDevice & { employeeNama?: string };
type FaceRow = DbEmployeeFaceProfile & { employeeNama?: string };

const PAGE_SIZE = 10;

export default function SecuritySettingsPage() {
  const { isSuperAdmin, getPermissionLevel } = useAuth();
  const permLevel = isSuperAdmin ? "edit" as const : getPermissionLevel("settings");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const [activeTab, setActiveTab] = useState<"device" | "face">("device");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [deviceList, setDeviceList] = useState<DeviceRow[]>([]);
  const [faceList, setFaceList] = useState<FaceRow[]>([]);

  const [deviceSearch, setDeviceSearch] = useState("");
  const [faceSearch, setFaceSearch] = useState("");

  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<number | null>(null);
  const [deviceForm, setDeviceForm] = useState({ employee_id: "", device_id: "", status: "Aktif" });

  // Face registration
  const [showFaceForm, setShowFaceForm] = useState(false);
  const [faceFormMode, setFaceFormMode] = useState<"qr" | "upload">("qr");
  const [faceFormEmpId, setFaceFormEmpId] = useState("");
  const [faceEmpSearch, setFaceEmpSearch] = useState("");
  const [faceFormSaving, setFaceFormSaving] = useState(false);
  const [faceFormError, setFaceFormError] = useState("");
  const [faceFormStep, setFaceFormStep] = useState<"select" | "capture" | "processing" | "done">("select");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const faceApiRef = useRef<typeof import("face-api.js") | null>(null);

  // QR Code mode
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = useState(false);
  const [qrPolling, setQrPolling] = useState(false);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "device" | "face"; id: number; name: string } | null>(null);
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => { return () => { if (toastTimer.current) clearTimeout(toastTimer.current); }; }, []);

  const fetchEmployees = async () => {
    const { data, error } = await supabase.from("pegawai").select("id, nama, status").order("nama");
    if (error) { showToast("error", "Gagal Memuat", "Data pegawai gagal dimuat. Coba refresh halaman."); return; }
    if (data) setEmployees(data as EmployeeLite[]);
  };
  const fetchDevices = async () => {
    const { data, error } = await supabase.from("employee_devices").select("*, pegawai(id, nama)").order("created_at", { ascending: false });
    if (error) { showToast("error", "Gagal Memuat", "Data device gagal dimuat."); return; }
    if (data) setDeviceList(data.map((d) => ({ ...d, employeeNama: d.pegawai?.nama || d.employee_id })) as DeviceRow[]);
  };
  const fetchFaces = async () => {
    const { data, error } = await supabase.from("employee_face_profiles").select("*, pegawai(id, nama)").order("created_at", { ascending: false });
    if (error) { showToast("error", "Gagal Memuat", "Data wajah gagal dimuat."); return; }
    if (data) setFaceList(data.map((f) => ({ ...f, employeeNama: f.pegawai?.nama || f.employee_id })) as FaceRow[]);
  };

  useEffect(() => { Promise.all([fetchEmployees(), fetchDevices(), fetchFaces()]).then(() => setLoading(false)); }, []);

  useEffect(() => {
    if (showDeviceForm || showFaceForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showDeviceForm, showFaceForm]);

  const employeesWithoutDevice = employees.filter((e) => !deviceList.some((d) => d.employee_id === e.id));
  const employeesWithoutFace = employees.filter((e) => e.status === "Aktif" && !faceList.some((f) => f.employee_id === e.id));

  const filteredDevices = deviceList.filter((d) =>
    (d.employeeNama || "").toLowerCase().includes(deviceSearch.toLowerCase()) ||
    d.employee_id.toLowerCase().includes(deviceSearch.toLowerCase()) ||
    d.device_id.toLowerCase().includes(deviceSearch.toLowerCase())
  );
  const filteredFaces = faceList.filter((f) =>
    (f.employeeNama || "").toLowerCase().includes(faceSearch.toLowerCase()) ||
    f.employee_id.toLowerCase().includes(faceSearch.toLowerCase())
  );
  const pagedDevices = filteredDevices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedFaces = filteredFaces.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ─── Device CRUD ───
  const openAddDevice = () => { setDeviceForm({ employee_id: employeesWithoutDevice[0]?.id || "", device_id: "", status: "Aktif" }); setEditingDeviceId(null); setShowDeviceForm(true); };
  const openEditDevice = (row: DeviceRow) => { setDeviceForm({ employee_id: row.employee_id, device_id: row.device_id, status: row.status }); setEditingDeviceId(row.id); setShowDeviceForm(true); };
  const saveDevice = async () => {
    if (!deviceForm.employee_id || !deviceForm.device_id.trim()) return;
    const payload = { employee_id: deviceForm.employee_id, device_id: deviceForm.device_id, status: deviceForm.status };
    if (editingDeviceId !== null) {
      const { error } = await supabase.from("employee_devices").update(payload).eq("id", editingDeviceId);
      if (error) { showToast("error", "Gagal Memperbarui", "Terjadi kesalahan saat menyimpan data perangkat."); return; }
      showToast("success", "Device Diperbarui", "Data perangkat pegawai telah disimpan.");
    } else {
      const { error } = await supabase.from("employee_devices").insert(payload);
      if (error) { showToast("error", "Gagal Menambahkan", "Terjadi kesalahan saat menambahkan perangkat."); return; }
      showToast("success", "Device Ditambahkan", "Data perangkat pegawai berhasil ditambahkan.");
    }
    setShowDeviceForm(false);
    fetchDevices();
  };

  // ─── Delete ───
  const [deleting, setDeleting] = useState(false);
  const deleteRow = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    if (deleteConfirm.type === "device") {
      const { error } = await supabase.from("employee_devices").delete().eq("id", deleteConfirm.id);
      if (error) { showToast("error", "Gagal Menghapus", "Terjadi kesalahan saat menghapus data perangkat."); setDeleting(false); setDeleteConfirm(null); return; }
      showToast("success", "Device Dihapus", "Data perangkat pegawai telah dihapus.");
      fetchDevices();
    } else {
      const { error } = await supabase.from("employee_face_profiles").delete().eq("id", deleteConfirm.id);
      if (error) { showToast("error", "Gagal Menghapus", "Terjadi kesalahan saat menghapus data wajah."); setDeleting(false); setDeleteConfirm(null); return; }
      showToast("success", "Data Wajah Dihapus", "Profil wajah pegawai telah dihapus.");
      fetchFaces();
    }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  // ─── Face stats ───
  const registeredCount = faceList.filter((f) => f.face_data_ref).length;
  const activeEmployees = employees.filter((e) => e.status === "Aktif").length;
  const notRegisteredCount = activeEmployees - registeredCount;

  // ═══════════════════════════════════════════
  // FACE REGISTRATION LOGIC (QR + Upload only)
  // ═══════════════════════════════════════════

  const loadFaceModels = async () => {
    if (modelsLoaded) return true;
    setModelsLoading(true);
    try {
      const faceapi = await import("face-api.js");
      faceApiRef.current = faceapi;
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      setModelsLoaded(true);
      setModelsLoading(false);
      return true;
    } catch (err) {
      setModelsLoading(false);
      setFaceFormError("Gagal memuat model face detection. Pastikan koneksi internet stabil.");
      console.error("Failed to load face-api models:", err);
      return false;
    }
  };

  const handleUploadFile = async (file: File) => {
    const faceapi = faceApiRef.current;
    if (!faceapi) return;
    setFaceFormStep("processing");
    setFaceFormError("");
    try {
      if (!file.type.startsWith("image/")) { setFaceFormError("File harus berupa gambar (JPG, PNG, dll)."); setFaceFormStep("capture"); return; }
      if (file.size > 10 * 1024 * 1024) { setFaceFormError("Ukuran file maksimal 10MB."); setFaceFormStep("capture"); return; }
      const imageUrl = URL.createObjectURL(file);
      setCapturedImage(imageUrl);
      const img = await faceapi.fetchImage(imageUrl);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) {
        URL.revokeObjectURL(imageUrl);
        setFaceFormError("Wajah tidak terdeteksi pada gambar. Pastikan foto menampilkan wajah dengan jelas.");
        setCapturedImage(null);
        setFaceFormStep("capture");
        return;
      }
      setFaceDescriptor(Array.from(detection.descriptor));
      setFaceFormStep("done");
    } catch (err) {
      setFaceFormError("Gagal memproses gambar. Silakan coba dengan foto lain.");
      setFaceFormStep("capture");
      console.error("Upload process error:", err);
    }
  };

  // ─── QR Code ───
  const generateQrToken = async () => {
    if (!faceFormEmpId) return;
    setQrGenerating(true);
    setFaceFormError("");
    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { data, error: insertErr } = await supabase
        .from("face_register_tokens")
        .insert({ employee_id: faceFormEmpId, status: "pending", expires_at: expiresAt })
        .select("id")
        .single();
      if (insertErr || !data) { setFaceFormError("Gagal membuat QR Code. Coba lagi."); setQrGenerating(false); return; }
      setQrToken(data.id);
      setFaceFormStep("capture");
      setQrGenerating(false);
      startQrPolling(data.id);
    } catch {
      setFaceFormError("Terjadi kesalahan.");
      setQrGenerating(false);
    }
  };

  const startQrPolling = (tokenId: string) => {
    setQrPolling(true);
    let failCount = 0;
    qrPollRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.from("face_register_tokens").select("status").eq("id", tokenId).single();
        if (error) { failCount++; if (failCount >= 3) { stopQrPolling(); setFaceFormError("Koneksi terputus. Silakan generate QR Code baru."); setQrToken(null); setFaceFormStep("select"); } return; }
        failCount = 0;
        if (data?.status === "completed") { stopQrPolling(); setFaceFormStep("done"); fetchFaces(); showToast("success", "Wajah Terdaftar", `Wajah ${employees.find((e) => e.id === faceFormEmpId)?.nama || faceFormEmpId} berhasil didaftarkan dari HP.`); }
        else if (data?.status === "expired") { stopQrPolling(); setFaceFormError("QR Code sudah kedaluwarsa. Generate ulang."); setQrToken(null); setFaceFormStep("select"); }
      } catch { failCount++; }
    }, 3000);
  };

  const stopQrPolling = () => {
    if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
    setQrPolling(false);
  };

  const saveFaceProfile = async () => {
    if (!faceFormEmpId || !faceDescriptor) return;
    setFaceFormSaving(true);
    setFaceFormError("");
    try {
      const { error: dbError } = await supabase
        .from("employee_face_profiles")
        .upsert({ employee_id: faceFormEmpId, face_data_ref: JSON.stringify(faceDescriptor), status: "Aktif", enrolled_at: new Date().toISOString() }, { onConflict: "employee_id" });
      if (dbError) { setFaceFormError(`Gagal menyimpan data: ${dbError.message}`); setFaceFormSaving(false); return; }
      const empName = employees.find((e) => e.id === faceFormEmpId)?.nama || faceFormEmpId;
      showToast("success", "Wajah Terdaftar", `Data wajah ${empName} berhasil disimpan.`);
      closeFaceForm();
      fetchFaces();
    } catch (err) {
      setFaceFormError("Terjadi kesalahan saat menyimpan.");
      console.error("Save face error:", err);
    } finally {
      setFaceFormSaving(false);
    }
  };

  const openFaceForm = () => {
    setFaceFormEmpId(employeesWithoutFace[0]?.id || "");
    setFaceFormMode("qr");
    setFaceEmpSearch("");
    setFaceFormStep("select");
    setFaceFormError("");
    setCapturedImage(null);
    setFaceDescriptor(null);
    setFaceFormSaving(false);
    setQrToken(null);
    setQrGenerating(false);
    stopQrPolling();
    setShowFaceForm(true);
  };

  const closeFaceForm = () => {
    stopQrPolling();
    if (capturedImage) URL.revokeObjectURL(capturedImage);
    setCapturedImage(null);
    setFaceDescriptor(null);
    setQrToken(null);
    setFaceFormError("");
    setShowFaceForm(false);
  };

  const startCapture = async () => {
    setFaceFormError("");
    if (faceFormMode === "qr") { await generateQrToken(); return; }
    // Upload mode — load models then show upload UI
    const loaded = await loadFaceModels();
    if (!loaded) return;
    setFaceFormStep("capture");
  };

  const retryCapture = () => {
    if (capturedImage) URL.revokeObjectURL(capturedImage);
    setCapturedImage(null);
    setFaceDescriptor(null);
    setFaceFormError("");
    setFaceFormStep("capture");
  };

  useEffect(() => { return () => { if (qrPollRef.current) clearInterval(qrPollRef.current); }; }, []);

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════

  return (
    <RouteGuard permission="settings">
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Keamanan" description="Kelola Device ID pegawai dan data wajah untuk kebutuhan absensi mobile" icon={Shield} />

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

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center border-b border-border bg-muted/30">
          {[{ key: "device", label: "Device ID", icon: Smartphone }, { key: "face", label: "Data Wajah", icon: ScanFace }].map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            const count = tab.key === "device" ? deviceList.length : faceList.length;
            return (
              <button key={tab.key} onClick={() => { setActiveTab(tab.key as "device" | "face"); setPage(1); }}
                className={cn("flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 -mb-px", isActive ? "border-primary text-primary bg-card" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                <Icon className="w-4 h-4" />
                {tab.label}
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md", isActive ? "bg-primary-light text-primary" : "bg-muted text-muted-foreground")}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* ═══ DEVICE TAB ═══ */}
        {activeTab === "device" && (
          <>
            <div className="px-5 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari nama, ID pegawai, atau device..." value={deviceSearch}
                  onChange={(e) => { setDeviceSearch(e.target.value); setPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && <Button icon={Plus} size="sm" onClick={openAddDevice} disabled={employeesWithoutDevice.length === 0}>
                {employeesWithoutDevice.length === 0 ? "Semua Sudah Terdaftar" : "Tambah Device"}
              </Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Pegawai</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Device ID</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Status</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? <SkeletonTable rows={5} cols={5} /> : pagedDevices.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data device ditemukan</td></tr>
                  ) : pagedDevices.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{row.employeeNama}</p><p className="text-[11px] text-muted-foreground">{row.employee_id}</p></td>
                      <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{row.device_id}</span></td>
                      <td className="px-5 py-3.5">
                        <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg", row.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", row.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />{row.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && <button onClick={() => openEditDevice(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                          {canEdit && <button onClick={() => setDeleteConfirm({ type: "device", id: row.id, name: row.employeeNama || row.employee_id })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={page} totalItems={filteredDevices.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}

        {/* ═══ FACE TAB ═══ */}
        {activeTab === "face" && (
          <>
            <div className="grid grid-cols-3 gap-3 px-5 mt-4">
              <div className="bg-muted/30 rounded-xl border border-border p-3 text-center">
                <p className="text-lg font-bold text-foreground">{faceList.length}</p>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Total Terdaftar</p>
              </div>
              <div className="bg-success/5 rounded-xl border border-success/10 p-3 text-center">
                <p className="text-lg font-bold text-success">{registeredCount}</p>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Descriptor Aktif</p>
              </div>
              <div className="bg-warning/5 rounded-xl border border-warning/10 p-3 text-center">
                <p className="text-lg font-bold text-warning">{notRegisteredCount > 0 ? notRegisteredCount : 0}</p>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Belum Daftar</p>
              </div>
            </div>
            <div className="px-5 py-3 border-b border-border mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari nama atau ID pegawai..." value={faceSearch}
                  onChange={(e) => { setFaceSearch(e.target.value); setPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
              {canInput && (
                <Button icon={ScanFace} size="sm" onClick={openFaceForm} disabled={employeesWithoutFace.length === 0}>
                  {employeesWithoutFace.length === 0 ? "Semua Sudah Terdaftar" : "Daftarkan Wajah"}
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Pegawai</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Face Descriptor</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Status</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Terdaftar</th>
                    {canEdit && <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? <SkeletonTable rows={5} cols={canEdit ? 6 : 5} /> : pagedFaces.length === 0 ? (
                    <tr><td colSpan={canEdit ? 6 : 5} className="text-center py-10 text-sm text-muted-foreground">
                      {faceList.length === 0 ? "Belum ada data wajah terdaftar." : "Tidak ada data ditemukan"}
                    </td></tr>
                  ) : pagedFaces.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-[10px] font-bold">
                            <ScanFace className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{row.employeeNama}</p>
                            <p className="text-[11px] text-muted-foreground">{row.employee_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {row.face_data_ref ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success bg-success-light px-2 py-1 rounded-lg"><Check className="w-3 h-3" />128-d vector</span>
                        ) : (<span className="text-[11px] text-muted-foreground italic">Belum ada data</span>)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg", row.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", row.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />{row.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{new Date(row.enrolled_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</td>
                      {canEdit && (
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-center">
                            <button onClick={() => setDeleteConfirm({ type: "face", id: row.id, name: row.employeeNama || row.employee_id })} title="Hapus data wajah" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={page} totalItems={filteredFaces.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}
      </div>

      {/* ═══ DEVICE FORM MODAL ═══ */}
      {showDeviceForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDeviceForm(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                <h2 className="text-sm font-bold text-foreground">{editingDeviceId !== null ? "Edit Device" : "Tambah Device"}</h2>
                <button onClick={() => setShowDeviceForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Pegawai *</label>
                  {editingDeviceId !== null ? (
                    <div className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-muted-foreground cursor-not-allowed">{employees.find((e) => e.id === deviceForm.employee_id)?.nama || deviceForm.employee_id}</div>
                  ) : (
                    <Select value={deviceForm.employee_id} onChange={(val) => setDeviceForm({ ...deviceForm, employee_id: val })} options={employeesWithoutDevice.map((e) => ({ value: e.id, label: `${e.nama} (${e.id})` }))} placeholder="Pilih pegawai" />
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Device ID *</label>
                  <input type="text" value={deviceForm.device_id} onChange={(e) => setDeviceForm({ ...deviceForm, device_id: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary" placeholder="Contoh: android-3f9b-7cd2" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <Select value={deviceForm.status} onChange={(val) => setDeviceForm({ ...deviceForm, status: val })} options={[{ value: "Aktif", label: "Aktif" }, { value: "Tidak Aktif", label: "Tidak Aktif" }]} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
                <Button variant="outline" size="sm" onClick={() => setShowDeviceForm(false)}>Batal</Button>
                <Button size="sm" icon={editingDeviceId !== null ? Check : Plus} onClick={saveDevice} disabled={!deviceForm.employee_id || !deviceForm.device_id.trim()}>{editingDeviceId !== null ? "Simpan" : "Tambah"}</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ FACE REGISTRATION MODAL ═══ */}
      {showFaceForm && (() => {
        const selectedEmp = employees.find((e) => e.id === faceFormEmpId);
        const empInitials = selectedEmp ? selectedEmp.nama.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "";
        return (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !faceFormSaving && closeFaceForm()} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>

              {/* Header — step indicator */}
              <div className="relative px-6 pt-5 pb-4 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !faceFormSaving && closeFaceForm()} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    <ScanFace className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">Pendaftaran Wajah</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {faceFormStep === "select" ? "Pilih pegawai dan metode capture" :
                       faceFormStep === "capture" ? (faceFormMode === "qr" ? "Scan QR Code dari HP" : "Upload foto wajah") :
                       faceFormStep === "processing" ? "Memproses data wajah..." : "Pendaftaran selesai"}
                    </p>
                  </div>
                </div>
                {/* Step progress */}
                <div className="flex items-center gap-1.5 mt-4">
                  {["select", "capture", "done"].map((s, i) => {
                    const steps = ["select", "capture", "done"];
                    const currentIdx = steps.indexOf(faceFormStep === "processing" ? "capture" : faceFormStep);
                    const isDone = i < currentIdx;
                    const isActive = i === currentIdx;
                    return (
                      <div key={s} className={cn("h-1 rounded-full flex-1 transition-all duration-500",
                        isDone ? "bg-primary" : isActive ? "bg-primary/60" : "bg-border"
                      )} />
                    );
                  })}
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
                {faceFormError && (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-danger/5 border border-danger/15 animate-fade-in">
                    <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-danger" />
                    </div>
                    <p className="text-xs font-medium text-danger">{faceFormError}</p>
                  </div>
                )}

                {/* ── Step 1: Select employee & mode ── */}
                {faceFormStep === "select" && (
                  <>
                    {/* Employee picker — custom visual */}
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-2 block">Pilih Pegawai <span className="text-danger">*</span></label>
                      {/* Search box */}
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="Cari nama atau ID pegawai..."
                          value={faceEmpSearch}
                          onChange={(e) => setFaceEmpSearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground"
                        />
                      </div>
                      {/* Employee list */}
                      <div className="max-h-44 overflow-y-auto rounded-xl border border-border divide-y divide-border/50">
                        {employeesWithoutFace
                          .filter((e) => !faceEmpSearch || e.nama.toLowerCase().includes(faceEmpSearch.toLowerCase()) || e.id.toLowerCase().includes(faceEmpSearch.toLowerCase()))
                          .map((emp) => {
                            const isSelected = faceFormEmpId === emp.id;
                            const initials = emp.nama.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                            return (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => setFaceFormEmpId(emp.id)}
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all",
                                  isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                                )}
                              >
                                <div className={cn(
                                  "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all",
                                  isSelected ? "bg-primary text-white shadow-sm shadow-primary/25" : "bg-muted text-muted-foreground"
                                )}>
                                  {initials}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={cn("text-sm font-semibold truncate", isSelected ? "text-primary" : "text-foreground")}>{emp.nama}</p>
                                  <p className="text-[10px] text-muted-foreground">{emp.id}</p>
                                </div>
                                {isSelected && (
                                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                    <Check className="w-3.5 h-3.5 text-white" />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        {employeesWithoutFace.filter((e) => !faceEmpSearch || e.nama.toLowerCase().includes(faceEmpSearch.toLowerCase()) || e.id.toLowerCase().includes(faceEmpSearch.toLowerCase())).length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Tidak ditemukan</div>
                        )}
                      </div>
                    </div>

                    {/* Method selector */}
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-2 block">Metode Capture</label>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { key: "qr" as const, icon: QrCode, label: "Kamera HP", desc: "Scan QR Code dari HP", badge: "Disarankan" },
                          { key: "upload" as const, icon: Upload, label: "Upload Foto", desc: "Pilih file gambar", badge: null },
                        ]).map((m) => {
                          const active = faceFormMode === m.key;
                          return (
                            <button key={m.key} type="button" onClick={() => setFaceFormMode(m.key)}
                              className={cn("relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all",
                                active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/30 hover:bg-muted/30")}>
                              {m.badge && (
                                <span className={cn("absolute -top-2 right-2 text-[9px] font-bold px-2 py-0.5 rounded-full",
                                  active ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                                )}>{m.badge}</span>
                              )}
                              <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center transition-all", active ? "bg-primary/10" : "bg-muted")}>
                                <m.icon className={cn("w-5 h-5", active ? "text-primary" : "text-muted-foreground")} />
                              </div>
                              <div className="text-center">
                                <p className={cn("text-xs font-bold", active ? "text-primary" : "text-foreground")}>{m.label}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{m.desc}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* ── Step 2: Capture ── */}
                {faceFormStep === "capture" && (
                  <>
                    {/* Selected employee card */}
                    {selectedEmp && (
                      <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 rounded-xl border border-border">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">{empInitials}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{selectedEmp.nama}</p>
                          <p className="text-[10px] text-muted-foreground">{selectedEmp.id}</p>
                        </div>
                      </div>
                    )}

                    {faceFormMode === "upload" && (
                      <div className="space-y-3">
                        <label className="group flex flex-col items-center justify-center gap-4 p-10 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/[0.02] cursor-pointer transition-all">
                          <div className="w-16 h-16 rounded-2xl bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                            <ImageIcon className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold text-foreground">Pilih foto wajah</p>
                            <p className="text-xs text-muted-foreground mt-1">JPG, PNG — maksimal 10MB</p>
                          </div>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUploadFile(file); }} />
                        </label>
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-muted/30 rounded-lg">
                          <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <p className="text-[11px] text-muted-foreground leading-relaxed">Pastikan foto menampilkan wajah dengan jelas — frontal, pencahayaan baik, tanpa masker atau kacamata hitam.</p>
                        </div>
                      </div>
                    )}

                    {faceFormMode === "qr" && qrToken && (
                      <div className="space-y-4">
                        <div className="flex flex-col items-center gap-5 p-6 bg-gradient-to-b from-muted/40 to-muted/10 rounded-xl border border-border">
                          <div className="bg-white p-4 rounded-2xl shadow-md shadow-black/5">
                            <QRCodeSVG value={`${typeof window !== "undefined" ? window.location.origin : ""}/face-register/${qrToken}`} size={180} level="M" />
                          </div>
                          <div className="text-center space-y-1.5">
                            <p className="text-sm font-bold text-foreground">Scan dengan Kamera HP</p>
                            <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px]">Arahkan kamera HP ke QR Code di atas untuk membuka halaman capture wajah</p>
                          </div>
                        </div>
                        {qrPolling && (
                          <div className="flex items-center justify-center gap-2.5 py-2">
                            <div className="relative">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <div className="absolute inset-0 w-4 h-4 rounded-full bg-primary/20 animate-ping" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">Menunggu capture dari HP...</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg">
                          <div className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />
                          <p className="text-[10px] text-muted-foreground">Link berlaku 10 menit. Halaman ini otomatis update setelah wajah berhasil di-capture.</p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Step 3: Processing ── */}
                {faceFormStep === "processing" && (
                  <div className="flex flex-col items-center justify-center py-12 gap-5">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                        <ScanFace className="w-9 h-9 text-primary" />
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-card border-2 border-primary/20 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">Memproses Wajah</p>
                      <p className="text-xs text-muted-foreground mt-1">Mendeteksi wajah dan menghasilkan face descriptor...</p>
                    </div>
                  </div>
                )}

                {/* ── Step 4: Done ── */}
                {faceFormStep === "done" && (
                  <div className="space-y-4">
                    {capturedImage && (
                      <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                        <img src={capturedImage} alt="Captured face" className="w-full h-full object-cover" />
                        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-success/20 text-success text-[11px] font-semibold backdrop-blur-sm">
                          <Check className="w-3 h-3" />Wajah Terdeteksi
                        </div>
                      </div>
                    )}
                    <div className="bg-success/5 border border-success/15 rounded-xl p-5">
                      <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
                          <CircleCheckBig className="w-6 h-6 text-success" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">{faceFormMode === "qr" ? "Wajah Berhasil Didaftarkan" : "Face Descriptor Berhasil"}</p>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {faceFormMode === "qr"
                              ? <>Wajah <span className="font-semibold text-foreground">{selectedEmp?.nama || faceFormEmpId}</span> berhasil di-capture dari HP dan tersimpan ke sistem.</>
                              : <>128-dimensional face vector telah dihasilkan untuk <span className="font-semibold text-foreground">{selectedEmp?.nama || faceFormEmpId}</span>.</>}
                          </p>
                        </div>
                      </div>
                    </div>
                    {faceFormMode !== "qr" && (
                      <button onClick={retryCapture} className="flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                        <RefreshCw className="w-3.5 h-3.5" />Ambil ulang foto
                      </button>
                    )}
                  </div>
                )}

                {modelsLoading && (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10">
                    <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                    <p className="text-xs font-medium text-primary">Memuat model face detection...</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <div className="text-[10px] text-muted-foreground">
                  {faceFormStep === "select" && faceFormEmpId && selectedEmp && (
                    <span>Terpilih: <span className="font-semibold text-foreground">{selectedEmp.nama}</span></span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={closeFaceForm} disabled={faceFormSaving}>
                    {faceFormStep === "done" && faceFormMode === "qr" ? "Selesai" : "Batal"}
                  </Button>
                  {faceFormStep === "select" && (
                    <Button size="sm" icon={faceFormMode === "qr" ? QrCode : Upload} onClick={startCapture} disabled={!faceFormEmpId || modelsLoading || qrGenerating}>
                      {modelsLoading ? "Memuat Model..." : qrGenerating ? "Membuat QR..." : faceFormMode === "qr" ? "Generate QR Code" : "Mulai Upload"}
                    </Button>
                  )}
                  {faceFormStep === "done" && faceFormMode !== "qr" && (
                    <Button size="sm" icon={Check} onClick={saveFaceProfile} disabled={faceFormSaving}>
                      {faceFormSaving ? "Menyimpan..." : "Simpan Data Wajah"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Portal>
        );
      })()}

      {/* ═══ DELETE CONFIRM ═══ */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-danger" /></div>
                <h3 className="text-base font-bold text-foreground">Hapus {deleteConfirm.type === "device" ? "Device" : "Data Wajah"}?</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Data untuk <span className="font-semibold text-foreground">&ldquo;{deleteConfirm.name}&rdquo;</span> akan dihapus permanen.
                  {deleteConfirm.type === "face" && <span className="block mt-1 text-xs">Pegawai perlu didaftarkan ulang.</span>}
                </p>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                <Button variant="danger" size="sm" icon={Trash2} className="flex-1" onClick={deleteRow} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Hapus"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
    </RouteGuard>
  );
}
