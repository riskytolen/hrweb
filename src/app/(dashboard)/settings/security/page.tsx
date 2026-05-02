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
} from "lucide-react";
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

  const [deviceForm, setDeviceForm] = useState({
    employee_id: "",
    device_id: "",
    status: "Aktif",
  });

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "device" | "face"; id: number; name: string } | null>(null);
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const fetchEmployees = async () => {
    const { data } = await supabase.from("pegawai").select("id, nama, status").order("nama");
    if (data) setEmployees(data as EmployeeLite[]);
  };

  const fetchDevices = async () => {
    const { data } = await supabase.from("employee_devices").select("*, pegawai(id, nama)").order("created_at", { ascending: false });
    if (data) {
      setDeviceList(data.map((d) => ({ ...d, employeeNama: d.pegawai?.nama || d.employee_id })) as DeviceRow[]);
    }
  };

  const fetchFaces = async () => {
    const { data } = await supabase.from("employee_face_profiles").select("*, pegawai(id, nama)").order("created_at", { ascending: false });
    if (data) {
      setFaceList(data.map((f) => ({ ...f, employeeNama: f.pegawai?.nama || f.employee_id })) as FaceRow[]);
    }
  };

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchDevices(), fetchFaces()]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showDeviceForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showDeviceForm]);

  const employeesWithoutDevice = employees.filter((e) => !deviceList.some((d) => d.employee_id === e.id));

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
  const openAddDevice = () => {
    setDeviceForm({ employee_id: employeesWithoutDevice[0]?.id || "", device_id: "", status: "Aktif" });
    setEditingDeviceId(null);
    setShowDeviceForm(true);
  };

  const openEditDevice = (row: DeviceRow) => {
    setDeviceForm({ employee_id: row.employee_id, device_id: row.device_id, status: row.status });
    setEditingDeviceId(row.id);
    setShowDeviceForm(true);
  };

  const saveDevice = async () => {
    if (!deviceForm.employee_id || !deviceForm.device_id.trim()) return;
    const payload = { employee_id: deviceForm.employee_id, device_id: deviceForm.device_id, status: deviceForm.status };
    if (editingDeviceId !== null) {
      await supabase.from("employee_devices").update(payload).eq("id", editingDeviceId);
      showToast("success", "Device Diperbarui", "Data perangkat pegawai telah disimpan.");
    } else {
      await supabase.from("employee_devices").insert(payload);
      showToast("success", "Device Ditambahkan", "Data perangkat pegawai berhasil ditambahkan.");
    }
    setShowDeviceForm(false);
    fetchDevices();
  };

  // ─── Delete ───
  const deleteRow = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "device") {
      await supabase.from("employee_devices").delete().eq("id", deleteConfirm.id);
      showToast("success", "Device Dihapus", "Data perangkat pegawai telah dihapus.");
      fetchDevices();
    } else {
      await supabase.from("employee_face_profiles").delete().eq("id", deleteConfirm.id);
      showToast("success", "Data Wajah Dihapus", "Profil wajah pegawai telah dihapus.");
      fetchFaces();
    }
    setDeleteConfirm(null);
  };

  // ─── Face stats ───
  const registeredCount = faceList.filter((f) => f.face_data_ref).length;
  const activeEmployees = employees.filter((e) => e.status === "Aktif").length;
  const notRegisteredCount = activeEmployees - registeredCount;

  return (
    <RouteGuard permission="settings">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Keamanan"
        description="Kelola Device ID pegawai dan data wajah untuk kebutuhan absensi mobile"
        icon={Shield}
      />

      {toast.show && (
        <Portal>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]",
              toast.type === "error" ? "border-danger/20" : "border-success/20")}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
                {toast.type === "error"
                  ? <AlertTriangle className="w-5 h-5 text-danger" />
                  : <CircleCheckBig className="w-5 h-5 text-success" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{toast.title}</p>
                {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
              </div>
              <button onClick={() => setToast({ show: false, title: "", message: "", type: "success" })} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
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
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key as "device" | "face"); setPage(1); }}
                className={cn(
                  "flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 -mb-px",
                  isActive ? "border-primary text-primary bg-card" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
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
                <input
                  type="text"
                  placeholder="Cari nama, ID pegawai, atau device..."
                  value={deviceSearch}
                  onChange={(e) => { setDeviceSearch(e.target.value); setPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
                />
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
                  {loading ? (
                    <SkeletonTable rows={5} cols={5} />
                  ) : pagedDevices.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data device ditemukan</td></tr>
                  ) : (
                    pagedDevices.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                        <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{row.employeeNama}</p><p className="text-[11px] text-muted-foreground">{row.employee_id}</p></td>
                        <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{row.device_id}</span></td>
                        <td className="px-5 py-3.5">
                          <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg", row.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", row.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                            {row.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-center gap-1">
                            {canEdit && <button onClick={() => openEditDevice(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                            {canEdit && <button onClick={() => setDeleteConfirm({ type: "device", id: row.id, name: row.employeeNama || row.employee_id })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={page} totalItems={filteredDevices.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}

        {/* ═══ FACE TAB — Read-only monitoring ═══ */}
        {activeTab === "face" && (
          <>
            {/* Info banner */}
            <div className="mx-5 mt-4 flex items-start gap-3 bg-primary/5 border border-primary/10 rounded-xl p-3.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">Pendaftaran via Aplikasi Android</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Data wajah didaftarkan melalui aplikasi Android khusus. Halaman ini hanya untuk monitoring status pendaftaran wajah pegawai.
                </p>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3 px-5 mt-3">
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

            {/* Search */}
            <div className="px-5 py-3 border-b border-border mt-2">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Cari nama atau ID pegawai..."
                  value={faceSearch}
                  onChange={(e) => { setFaceSearch(e.target.value); setPage(1); }}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
                />
              </div>
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
                  {loading ? (
                    <SkeletonTable rows={5} cols={canEdit ? 6 : 5} />
                  ) : pagedFaces.length === 0 ? (
                    <tr><td colSpan={canEdit ? 6 : 5} className="text-center py-10 text-sm text-muted-foreground">
                      {faceList.length === 0 ? "Belum ada data wajah terdaftar. Gunakan aplikasi Android untuk mendaftarkan wajah pegawai." : "Tidak ada data ditemukan"}
                    </td></tr>
                  ) : (
                    pagedFaces.map((row, idx) => (
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
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success bg-success-light px-2 py-1 rounded-lg">
                              <Check className="w-3 h-3" />
                              128-d vector
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">Belum ada data</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg", row.status === "Aktif" ? "bg-success-light text-success" : "bg-muted text-muted-foreground")}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", row.status === "Aktif" ? "bg-success" : "bg-muted-foreground")} />
                            {row.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">
                          {new Date(row.enrolled_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        {canEdit && (
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => setDeleteConfirm({ type: "face", id: row.id, name: row.employeeNama || row.employee_id })}
                                title="Hapus data wajah"
                                className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
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
                    <div className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-muted-foreground cursor-not-allowed">
                      {employees.find((e) => e.id === deviceForm.employee_id)?.nama || deviceForm.employee_id}
                    </div>
                  ) : (
                    <Select
                      value={deviceForm.employee_id}
                      onChange={(val) => setDeviceForm({ ...deviceForm, employee_id: val })}
                      options={employeesWithoutDevice.map((e) => ({ value: e.id, label: `${e.nama} (${e.id})` }))}
                      placeholder="Pilih pegawai"
                    />
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
                <Button size="sm" icon={editingDeviceId !== null ? Check : Plus} onClick={saveDevice} disabled={!deviceForm.employee_id || !deviceForm.device_id.trim()}>
                  {editingDeviceId !== null ? "Simpan" : "Tambah"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ DELETE CONFIRM ═══ */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-7 h-7 text-danger" />
                </div>
                <h3 className="text-base font-bold text-foreground">Hapus {deleteConfirm.type === "device" ? "Device" : "Data Wajah"}?</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Data untuk <span className="font-semibold text-foreground">&ldquo;{deleteConfirm.name}&rdquo;</span> akan dihapus permanen.
                  {deleteConfirm.type === "face" && <span className="block mt-1 text-xs">Pegawai perlu mendaftar ulang melalui aplikasi Android.</span>}
                </p>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)}>Batal</Button>
                <Button variant="danger" size="sm" icon={Trash2} className="flex-1" onClick={deleteRow}>Hapus</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
    </RouteGuard>
  );
}
