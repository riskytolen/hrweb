"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  UserCog,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Shield,
  Mail,
  User,
  Lock,
  Eye,
  EyeOff,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  Users,
  KeyRound,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, type UserProfile } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase-browser";
import Portal from "@/components/ui/Portal";
import Button from "@/components/ui/Button";

// ─── Types ───
interface Role {
  id: number;
  nama: string;
  deskripsi: string | null;
  level: number;
  permissions: string[];
  status: "Aktif" | "Tidak Aktif";
}

interface PegawaiLite {
  id: string;
  nama: string;
  jabatan?: { nama: string } | { nama: string }[] | null;
}

// Helper: get jabatan nama from pegawai (handles both object and array from Supabase)
function getJabatanNama(pegawai?: PegawaiLite | null): string {
  if (!pegawai?.jabatan) return "";
  if (Array.isArray(pegawai.jabatan)) return pegawai.jabatan[0]?.nama || "";
  return pegawai.jabatan.nama || "";
}

interface UserWithRole extends UserProfile {
  roles: Role | null;
  pegawai?: PegawaiLite | null;
}

type Tab = "users" | "roles";

// ─── Toast ───
interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

// ─── Permission Options ───
const PERMISSION_OPTIONS = [
  { key: "employees", label: "Data Pegawai" },
  { key: "attendance", label: "Absensi" },
  { key: "leave", label: "Cuti & Izin" },
  { key: "income", label: "Rekap Titik" },
  { key: "payroll", label: "Penggajian" },
  { key: "recruitment", label: "Rekrutmen" },
  { key: "performance", label: "Kinerja" },
  { key: "legal", label: "Legal & Administrasi" },
  { key: "settings", label: "Pengaturan" },
];

export default function AccountsPage() {
  // Fix #4: Supabase instance dibuat sekali via useState
  const [supabase] = useState(() => createClient());
  const { isSuperAdmin, profile: currentUser, isLoading: authLoading, user } = useAuth();

  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [employees, setEmployees] = useState<PegawaiLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  // User modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({
    email: "",
    nama: "",
    password: "",
    role_id: 0,
    employee_id: "" as string,
    status: "Aktif" as "Aktif" | "Tidak Aktif",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset password modal (Fix #6)
  const [showResetPwModal, setShowResetPwModal] = useState(false);
  const [resetPwUser, setResetPwUser] = useState<{ id: string; nama: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resettingPw, setResettingPw] = useState(false);

  // Role modal
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [roleForm, setRoleForm] = useState({
    nama: "",
    deskripsi: "",
    level: 0,
    permissions: [] as string[],
    status: "Aktif" as "Aktif" | "Tidak Aktif",
  });

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "user" | "role"; id: string | number; name: string } | null>(null);

  // ─── Toast helper ───
  const addToast = (type: "success" | "error", message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  // ─── Fetch Data (Fix #5: no supabase in dependency) ───
  const fetchUsers = useCallback(async () => {
    const { data } = await supabase
      .from("user_profiles")
      .select("*, roles(id, nama, deskripsi, level, permissions, status), pegawai(id, nama, jabatan(nama))")
      .order("created_at", { ascending: false });
    if (data) setUsers(data as UserWithRole[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchRoles = useCallback(async () => {
    const { data } = await supabase
      .from("roles")
      .select("*")
      .order("level", { ascending: false });
    if (data) setRoles(data as Role[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEmployees = useCallback(async () => {
    const { data } = await supabase
      .from("pegawai")
      .select("id, nama, jabatan(nama)")
      .eq("status", "Aktif")
      .order("nama");
    if (data) setEmployees(data as PegawaiLite[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Promise.all([fetchUsers(), fetchRoles(), fetchEmployees()]).finally(() => setLoading(false));
  }, [fetchUsers, fetchRoles, fetchEmployees]);

  // ─── Pegawai yang belum punya akun ───
  const availableEmployees = useMemo(() => {
    const linkedIds = users.map((u) => u.employee_id).filter(Boolean);
    return employees.filter((e) => !linkedIds.includes(e.id));
  }, [employees, users]);

  // ─── User CRUD ───
  const openCreateUser = () => {
    setEditingUserId(null);
    setUserForm({ email: "", nama: "", password: "", role_id: roles[0]?.id || 0, employee_id: "", status: "Aktif" });
    setShowPassword(false);
    setShowUserModal(true);
  };

  const openEditUser = (u: UserWithRole) => {
    setEditingUserId(u.id);
    setUserForm({
      email: u.email,
      nama: u.nama,
      password: "",
      role_id: u.role_id || 0,
      employee_id: u.employee_id || "",
      status: u.status,
    });
    setShowPassword(false);
    setShowUserModal(true);
  };

  // Fix #6: Open reset password modal
  const openResetPassword = (u: UserWithRole) => {
    setResetPwUser({ id: u.id, nama: u.nama });
    setNewPassword("");
    setShowNewPassword(false);
    setShowResetPwModal(true);
  };

  const saveUser = async () => {
    if (!userForm.email || !userForm.nama || !userForm.role_id) {
      addToast("error", "Lengkapi semua field yang wajib.");
      return;
    }

    setSaving(true);
    try {
      if (editingUserId) {
        // Update profile (no auth change needed)
        const { error } = await supabase
          .from("user_profiles")
          .update({
            nama: userForm.nama,
            role_id: userForm.role_id,
            employee_id: userForm.employee_id || null,
            status: userForm.status,
          })
          .eq("id", editingUserId);

        if (error) throw error;
        addToast("success", `Akun ${userForm.nama} berhasil diperbarui.`);
      } else {
        // Fix #1: Create new user via API Route (tidak mengganti session admin)
        if (!userForm.password || userForm.password.length < 6) {
          addToast("error", "Password minimal 6 karakter.");
          setSaving(false);
          return;
        }

        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: userForm.email.trim(),
            password: userForm.password,
            nama: userForm.nama,
            role_id: userForm.role_id,
            employee_id: userForm.employee_id || null,
            status: userForm.status,
          }),
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || "Gagal membuat akun.");
        }

        addToast("success", `Akun ${userForm.nama} berhasil dibuat.`);
      }

      setShowUserModal(false);
      fetchUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Gagal menyimpan akun.";
      addToast("error", message);
    } finally {
      setSaving(false);
    }
  };

  // Fix #2: Delete user via API Route (hapus auth + profile)
  const deleteUser = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/users?id=${id}`, {
        method: "DELETE",
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Gagal menghapus akun.");
      }

      addToast("success", "Akun berhasil dihapus.");
      fetchUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Gagal menghapus akun.";
      addToast("error", message);
    }
    setDeleteConfirm(null);
  };

  // Fix #6: Reset password via API Route
  const resetPassword = async () => {
    if (!resetPwUser || !newPassword) return;

    if (newPassword.length < 6) {
      addToast("error", "Password minimal 6 karakter.");
      return;
    }

    setResettingPw(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: resetPwUser.id,
          password: newPassword,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Gagal mereset password.");
      }

      addToast("success", `Password ${resetPwUser.nama} berhasil direset.`);
      setShowResetPwModal(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Gagal mereset password.";
      addToast("error", message);
    } finally {
      setResettingPw(false);
    }
  };

  const toggleUserStatus = async (u: UserWithRole) => {
    const newStatus = u.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    await supabase.from("user_profiles").update({ status: newStatus }).eq("id", u.id);
    fetchUsers();
    addToast("success", `Akun ${u.nama} ${newStatus === "Aktif" ? "diaktifkan" : "dinonaktifkan"}.`);
  };

  // ─── Role CRUD ───
  const openCreateRole = () => {
    setEditingRoleId(null);
    setRoleForm({ nama: "", deskripsi: "", level: 0, permissions: [], status: "Aktif" });
    setShowRoleModal(true);
  };

  const openEditRole = (r: Role) => {
    setEditingRoleId(r.id);
    setRoleForm({
      nama: r.nama,
      deskripsi: r.deskripsi || "",
      level: r.level,
      permissions: r.permissions,
      status: r.status,
    });
    setShowRoleModal(true);
  };

  const saveRole = async () => {
    if (!roleForm.nama) {
      addToast("error", "Nama role wajib diisi.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        nama: roleForm.nama,
        deskripsi: roleForm.deskripsi || null,
        level: roleForm.level,
        permissions: roleForm.permissions,
        status: roleForm.status,
      };

      if (editingRoleId) {
        const { error } = await supabase.from("roles").update(payload).eq("id", editingRoleId);
        if (error) throw error;
        addToast("success", `Role ${roleForm.nama} berhasil diperbarui.`);
      } else {
        const { error } = await supabase.from("roles").insert(payload);
        if (error) throw error;
        addToast("success", `Role ${roleForm.nama} berhasil dibuat.`);
      }

      setShowRoleModal(false);
      fetchRoles();
      fetchUsers(); // refresh joined data
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Gagal menyimpan role.";
      addToast("error", message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (id: number) => {
    const { error } = await supabase.from("roles").delete().eq("id", id);
    if (error) {
      addToast("error", "Gagal menghapus role. Pastikan tidak ada user yang menggunakan role ini.");
    } else {
      addToast("success", "Role berhasil dihapus.");
      fetchRoles();
    }
    setDeleteConfirm(null);
  };

  // Permission per modul: 4 keadaan
  // - tidak ada key → tidak tampil
  // - "key.view" → hanya lihat
  // - "key.input" → lihat + tambah data baru (tidak bisa edit/hapus)
  // - "key" → CRUD penuh (edit)
  const getPermissionState = (key: string): "none" | "view" | "input" | "edit" => {
    if (roleForm.permissions.includes(key)) return "edit";
    if (roleForm.permissions.includes(key + ".input")) return "input";
    if (roleForm.permissions.includes(key + ".view")) return "view";
    return "none";
  };

  const setPermissionState = (key: string, state: "none" | "view" | "input" | "edit") => {
    setRoleForm((prev) => {
      // Hapus semua varian key ini dulu
      const cleaned = prev.permissions.filter((p) => p !== key && p !== key + ".view" && p !== key + ".input");
      // Tambah sesuai state baru
      if (state === "edit") return { ...prev, permissions: [...cleaned, key] };
      if (state === "input") return { ...prev, permissions: [...cleaned, key + ".input"] };
      if (state === "view") return { ...prev, permissions: [...cleaned, key + ".view"] };
      return { ...prev, permissions: cleaned };
    });
  };

  // ─── Filter (memoized) ───
  const filteredUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.nama.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          (u.roles?.nama || "").toLowerCase().includes(search.toLowerCase())
      ),
    [users, search]
  );

  // ─── Guard ───
  if (authLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        {/* Header skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-muted animate-pulse" />
              <div className="h-6 w-40 rounded-lg bg-muted animate-pulse" />
            </div>
            <div className="h-4 w-64 rounded-lg bg-muted animate-pulse mt-2" />
          </div>
        </div>

        {/* Tabs skeleton */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit">
          <div className="h-9 w-32 rounded-lg bg-muted-foreground/10 animate-pulse" />
          <div className="h-9 w-40 rounded-lg bg-muted-foreground/10 animate-pulse" />
        </div>

        {/* Table skeleton */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          {/* Toolbar skeleton */}
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="h-10 w-72 rounded-xl bg-muted animate-pulse" />
            <div className="flex items-center gap-2 ml-auto">
              <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
              <div className="h-10 w-36 rounded-xl bg-muted animate-pulse" />
            </div>
          </div>

          {/* Table header skeleton */}
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-4">
            <div className="h-4 w-8 rounded bg-muted animate-pulse" />
            <div className="h-4 w-28 rounded bg-muted animate-pulse" />
            <div className="h-4 w-36 rounded bg-muted animate-pulse" />
            <div className="h-4 w-20 rounded bg-muted animate-pulse" />
            <div className="h-4 w-16 rounded bg-muted animate-pulse" />
            <div className="h-4 w-28 rounded bg-muted animate-pulse" />
            <div className="h-4 w-16 rounded bg-muted animate-pulse ml-auto" />
          </div>

          {/* Table rows skeleton */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="px-4 py-3.5 border-b border-border/50 flex items-center gap-4"
              style={{ opacity: 1 - i * 0.15 }}
            >
              <div className="h-4 w-6 rounded bg-muted animate-pulse" />
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted animate-pulse flex-shrink-0" />
                <div className="h-4 w-28 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-4 w-40 rounded bg-muted animate-pulse" />
              <div className="h-6 w-24 rounded-full bg-muted animate-pulse" />
              <div className="h-6 w-16 rounded-full bg-muted animate-pulse" />
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              <div className="flex items-center gap-1 ml-auto">
                <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
                <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Jika user sudah null (sedang logout), tampilkan skeleton — middleware akan redirect ke /login
  if (!user) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-muted animate-pulse" />
          <div className="h-6 w-48 rounded-lg bg-muted animate-pulse" />
        </div>
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <div className="h-10 w-72 rounded-xl bg-muted animate-pulse" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3.5 border-b border-border/50 flex items-center gap-4" style={{ opacity: 1 - i * 0.15 }}>
              <div className="h-4 w-6 rounded bg-muted animate-pulse" />
              <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              <div className="h-4 w-40 rounded bg-muted animate-pulse flex-1" />
              <div className="h-6 w-20 rounded-full bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">Akses Ditolak</h2>
          <p className="text-sm text-muted-foreground">Hanya Super Admin yang dapat mengakses halaman ini.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <UserCog className="w-[18px] h-[18px] text-white" />
            </div>
            Manajemen Akun
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola akun pengguna dan hak akses sistem HRM.
          </p>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit">
        {[
          { key: "users" as Tab, label: "Pengguna", icon: Users, count: users.length },
          { key: "roles" as Tab, label: "Role & Hak Akses", icon: KeyRound, count: roles.length },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full font-semibold",
              tab === t.key ? "bg-primary/10 text-primary" : "bg-muted-foreground/10 text-muted-foreground"
            )}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* TAB: USERS                                              */}
      {/* ═══════════════════════════════════════════════════════ */}
      {tab === "users" && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari nama, email, atau role..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60"
              />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => { fetchUsers(); fetchRoles(); }}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={openCreateUser}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Tambah Akun
              </button>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground text-sm">
              {search ? "Tidak ada hasil pencarian." : "Belum ada akun pengguna."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">#</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Nama</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Pegawai / Jabatan</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Role</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Login Terakhir</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u, i) => (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {u.nama.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{u.nama}</p>
                            <p className="text-[11px] text-muted-foreground">{u.email}</p>
                            {u.id === currentUser?.id && (
                              <span className="text-[10px] text-primary font-semibold">(Anda)</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.pegawai ? (
                          <div>
                            <p className="text-sm font-medium text-foreground">{u.pegawai.nama}</p>
                            <p className="text-[11px] text-muted-foreground">{getJabatanNama(u.pegawai) || "—"}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">Belum terhubung</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                          (u.roles?.level ?? 0) >= 100
                            ? "bg-amber-500/10 text-amber-600"
                            : (u.roles?.level ?? 0) >= 60
                              ? "bg-blue-500/10 text-blue-600"
                              : "bg-muted text-muted-foreground"
                        )}>
                          <Shield className="w-3 h-3" />
                          {u.roles?.nama || "Tanpa Role"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleUserStatus(u)}
                          disabled={u.id === currentUser?.id}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors",
                            u.status === "Aktif"
                              ? "bg-success-light text-success"
                              : "bg-danger-light text-danger",
                            u.id === currentUser?.id && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <div className={cn("w-1.5 h-1.5 rounded-full", u.status === "Aktif" ? "bg-success" : "bg-danger")} />
                          {u.status}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {u.last_login
                          ? new Date(u.last_login).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "Belum pernah"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openResetPassword(u)}
                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Reset Password"
                          >
                            <Lock className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openEditUser(u)}
                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {u.id !== currentUser?.id && (
                            <button
                              onClick={() => setDeleteConfirm({ type: "user", id: u.id, name: u.nama })}
                              className="p-2 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"
                              title="Hapus"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* TAB: ROLES                                              */}
      {/* ═══════════════════════════════════════════════════════ */}
      {tab === "roles" && (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <button
              onClick={openCreateRole}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Tambah Role
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {roles.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "bg-card rounded-2xl border border-border p-5 space-y-4 hover:shadow-md transition-shadow",
                  r.status === "Tidak Aktif" && "opacity-60"
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        r.level >= 100 ? "bg-amber-500/10" : r.level >= 60 ? "bg-blue-500/10" : "bg-muted"
                      )}>
                        <Shield className={cn(
                          "w-4 h-4",
                          r.level >= 100 ? "text-amber-500" : r.level >= 60 ? "text-blue-500" : "text-muted-foreground"
                        )} />
                      </div>
                      <div>
                        <h3 className="font-bold text-foreground text-sm">{r.nama}</h3>
                        <p className="text-xs text-muted-foreground">Level {r.level}</p>
                      </div>
                    </div>
                    {r.deskripsi && (
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{r.deskripsi}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditRole(r)}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {r.level < 100 && (
                      <button
                        onClick={() => setDeleteConfirm({ type: "role", id: r.id, name: r.nama })}
                        className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Permissions */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Hak Akses</p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.permissions.includes("all") ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 text-[11px] font-semibold">
                        Akses Penuh
                      </span>
                    ) : r.permissions.length > 0 ? (
                      r.permissions.map((p) => {
                        const isView = p.endsWith(".view");
                        const isInput = p.endsWith(".input");
                        const baseKey = isView ? p.replace(".view", "") : isInput ? p.replace(".input", "") : p;
                        const label = PERMISSION_OPTIONS.find((o) => o.key === baseKey)?.label || p;
                        return (
                          <span
                            key={p}
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[11px] font-medium",
                              isView
                                ? "bg-amber-500/10 text-amber-600"
                                : isInput
                                  ? "bg-emerald-500/10 text-emerald-600"
                                  : "bg-primary/10 text-primary"
                            )}
                          >
                            {label}{isView ? " (Lihat)" : isInput ? " (Input)" : ""}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-xs text-muted-foreground">Tidak ada</span>
                    )}
                  </div>
                </div>

                {/* User count */}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {users.filter((u) => u.role_id === r.id).length} pengguna
                  </span>
                  <span className={cn(
                    "ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold",
                    r.status === "Aktif" ? "bg-success-light text-success" : "bg-danger-light text-danger"
                  )}>
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* MODAL: CREATE/EDIT USER                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      {/* ═══════════════════════════════════════════════════════ */}
      {/* MODAL: CREATE/EDIT USER                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      {showUserModal && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setShowUserModal(false)} />
            <div
              className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col"
              style={{ maxHeight: "calc(100vh - 2rem)" }}
            >
              {/* Header */}
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button
                  onClick={() => !saving && setShowUserModal(false)}
                  className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    {editingUserId ? <Edit2 className="w-5 h-5 text-white" /> : <UserCog className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {editingUserId ? "Edit Akun" : "Tambah Akun Baru"}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {editingUserId ? "Perbarui informasi akun pengguna" : "Buat akun baru untuk pengguna sistem"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {/* Live Preview */}
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-muted/50 border border-border/50">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {userForm.nama ? userForm.nama.charAt(0).toUpperCase() : "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {userForm.nama || "Nama Pengguna"}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {userForm.employee_id
                        ? getJabatanNama(employees.find((e) => e.id === userForm.employee_id)) || "Pegawai"
                        : userForm.email || "email@jamslogistic.com"}
                    </p>
                  </div>
                  {userForm.role_id > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-semibold flex-shrink-0">
                      {roles.find((r) => r.id === userForm.role_id)?.nama || ""}
                    </span>
                  )}
                </div>

                {/* Link Pegawai */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">
                    Hubungkan ke Pegawai
                  </label>
                  <div className="relative">
                    <select
                      value={userForm.employee_id}
                      onChange={(e) => {
                        const empId = e.target.value;
                        const emp = employees.find((em) => em.id === empId);
                        setUserForm({
                          ...userForm,
                          employee_id: empId,
                          // Auto-fill nama dari pegawai
                          nama: emp ? emp.nama : "",
                        });
                      }}
                      className="w-full px-3 py-2.5 pr-8 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none"
                    >
                      <option value="">— Tidak dihubungkan (input manual) —</option>
                      {(editingUserId
                        ? employees.filter((e) => e.id === userForm.employee_id || availableEmployees.some((ae) => ae.id === e.id))
                        : availableEmployees
                      ).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nama} {getJabatanNama(e) ? `— ${getJabatanNama(e)}` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {userForm.employee_id ? "Nama diambil dari data pegawai." : "Opsional. Jika tidak dipilih, isi nama manual di bawah."}
                  </p>
                </div>

                {/* Nama — disabled jika pegawai dipilih */}
                {!userForm.employee_id && (
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">
                      Nama Lengkap <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={userForm.nama}
                      onChange={(e) => setUserForm({ ...userForm, nama: e.target.value })}
                      placeholder="Masukkan nama lengkap"
                      autoFocus
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                )}

                {/* Email */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">
                    Email <span className="text-danger">*</span>
                  </label>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    placeholder="nama@jamslogistic.com"
                    disabled={!!editingUserId}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {editingUserId && (
                    <p className="text-[10px] text-muted-foreground mt-1">Email tidak dapat diubah setelah akun dibuat.</p>
                  )}
                </div>

                {/* Password (only for new user) */}
                {!editingUserId && (
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">
                      Password <span className="text-danger">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={userForm.password}
                        onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                        placeholder="Minimal 6 karakter"
                        className="w-full px-3 py-2.5 pr-10 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {userForm.password.length > 0 && userForm.password.length < 6 && (
                      <p className="text-[10px] text-danger mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Minimal 6 karakter
                      </p>
                    )}
                  </div>
                )}

                {/* Role & Status row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">
                      Role <span className="text-danger">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={userForm.role_id}
                        onChange={(e) => setUserForm({ ...userForm, role_id: Number(e.target.value) })}
                        className="w-full px-3 py-2.5 pr-8 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none"
                      >
                        <option value={0}>Pilih role...</option>
                        {roles.filter((r) => r.status === "Aktif").map((r) => (
                          <option key={r.id} value={r.id}>{r.nama} (Lv.{r.level})</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                    <div className="flex gap-1.5">
                      {(["Aktif", "Tidak Aktif"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setUserForm({ ...userForm, status: s })}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all",
                            userForm.status === s
                              ? s === "Aktif"
                                ? "bg-success/10 border-success/30 text-success"
                                : "bg-danger/10 border-danger/30 text-danger"
                              : "border-border text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowUserModal(false)} disabled={saving}>
                  Batal
                </Button>
                <Button
                  size="sm"
                  icon={editingUserId ? CheckCircle : Plus}
                  onClick={saveUser}
                  disabled={saving || !userForm.nama || !userForm.email || !userForm.role_id || (!editingUserId && userForm.password.length < 6)}
                >
                  {saving ? "Menyimpan..." : editingUserId ? "Simpan" : "Buat Akun"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* MODAL: RESET PASSWORD                                    */}
      {/* ═══════════════════════════════════════════════════════ */}
      {showResetPwModal && resetPwUser && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !resettingPw && setShowResetPwModal(false)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 bg-muted/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Lock className="w-4 h-4 text-amber-500" />
                  </div>
                  <h2 className="text-sm font-bold text-foreground">Reset Password</h2>
                </div>
                <button onClick={() => !resettingPw && setShowResetPwModal(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {resetPwUser.nama.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{resetPwUser.nama}</p>
                    <p className="text-[10px] text-muted-foreground">Password akan direset</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">
                    Password Baru <span className="text-danger">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimal 6 karakter"
                      autoFocus
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {newPassword.length > 0 && newPassword.length < 6 && (
                    <p className="text-[10px] text-danger mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Minimal 6 karakter
                    </p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
                <Button variant="outline" size="sm" onClick={() => setShowResetPwModal(false)} disabled={resettingPw}>
                  Batal
                </Button>
                <Button size="sm" icon={Lock} onClick={resetPassword} disabled={resettingPw || newPassword.length < 6}>
                  {resettingPw ? "Mereset..." : "Reset Password"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* MODAL: CREATE/EDIT ROLE                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      {showRoleModal && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setShowRoleModal(false)} />
            <div
              className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col"
              style={{ maxHeight: "calc(100vh - 2rem)" }}
            >
              {/* Header */}
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button
                  onClick={() => !saving && setShowRoleModal(false)}
                  className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    {editingRoleId ? <Edit2 className="w-5 h-5 text-white" /> : <KeyRound className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {editingRoleId ? "Edit Role" : "Tambah Role Baru"}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Atur nama, level, dan hak akses modul</p>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {/* Nama */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">
                    Nama Role <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={roleForm.nama}
                    onChange={(e) => setRoleForm({ ...roleForm, nama: e.target.value })}
                    placeholder="Contoh: Admin HR"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>

                {/* Deskripsi */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                  <textarea
                    value={roleForm.deskripsi}
                    onChange={(e) => setRoleForm({ ...roleForm, deskripsi: e.target.value })}
                    placeholder="Deskripsi singkat role ini..."
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 resize-none"
                  />
                </div>

                {/* Level & Status row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Level Akses (0-100)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={roleForm.level}
                      onChange={(e) => setRoleForm({ ...roleForm, level: Number(e.target.value) })}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">100 = Super Admin</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                    <div className="flex gap-1.5">
                      {(["Aktif", "Tidak Aktif"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setRoleForm({ ...roleForm, status: s })}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all",
                            roleForm.status === s
                              ? s === "Aktif"
                                ? "bg-success/10 border-success/30 text-success"
                                : "bg-danger/10 border-danger/30 text-danger"
                              : "border-border text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Permissions */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Hak Akses Modul</label>

                  {/* All access toggle */}
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={roleForm.permissions.includes("all")}
                      onChange={() => {
                        if (roleForm.permissions.includes("all")) {
                          setRoleForm({ ...roleForm, permissions: roleForm.permissions.filter((p) => p !== "all") });
                        } else {
                          setRoleForm({ ...roleForm, permissions: ["all"] });
                        }
                      }}
                      className="w-4 h-4 rounded accent-primary"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Akses Penuh</p>
                      <p className="text-[10px] text-muted-foreground">Dapat mengakses semua modul</p>
                    </div>
                  </label>

                  {!roleForm.permissions.includes("all") && (
                    <div className="space-y-1.5">
                      {PERMISSION_OPTIONS.map((opt) => {
                        const state = getPermissionState(opt.key);
                        return (
                          <div
                            key={opt.key}
                            className={cn(
                              "flex items-center justify-between p-2.5 rounded-xl border transition-all",
                              state === "edit"
                                ? "border-primary/30 bg-primary/5"
                                : state === "input"
                                  ? "border-emerald-500/30 bg-emerald-500/5"
                                  : state === "view"
                                    ? "border-amber-500/30 bg-amber-500/5"
                                    : "border-border"
                            )}
                          >
                            <span className="text-xs font-medium text-foreground">{opt.label}</span>
                            <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                              {([
                                { value: "none" as const, label: "Tidak Tampil" },
                                { value: "view" as const, label: "Lihat" },
                                { value: "input" as const, label: "Input" },
                                { value: "edit" as const, label: "Edit" },
                              ]).map((s) => (
                                <button
                                  key={s.value}
                                  type="button"
                                  onClick={() => setPermissionState(opt.key, s.value)}
                                  className={cn(
                                    "px-2 py-1 rounded-md text-[10px] font-semibold transition-all",
                                    state === s.value
                                      ? s.value === "edit"
                                        ? "bg-primary text-white shadow-sm"
                                        : s.value === "input"
                                          ? "bg-emerald-500 text-white shadow-sm"
                                          : s.value === "view"
                                            ? "bg-amber-500 text-white shadow-sm"
                                            : "bg-card text-muted-foreground shadow-sm"
                                      : "text-muted-foreground/60 hover:text-muted-foreground"
                                  )}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowRoleModal(false)} disabled={saving}>
                  Batal
                </Button>
                <Button
                  size="sm"
                  icon={editingRoleId ? CheckCircle : Plus}
                  onClick={saveRole}
                  disabled={saving || !roleForm.nama.trim()}
                >
                  {saving ? "Menyimpan..." : editingRoleId ? "Simpan" : "Buat Role"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* MODAL: DELETE CONFIRM                                    */}
      {/* ═══════════════════════════════════════════════════════ */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-7 h-7 text-danger" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  Hapus {deleteConfirm.type === "user" ? "Akun" : "Role"}?
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Data <span className="font-semibold text-foreground">&quot;{deleteConfirm.name}&quot;</span> akan dihapus permanen.
                </p>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                  Batal
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash2}
                  className="flex-1"
                  onClick={() => {
                    if (deleteConfirm.type === "user") deleteUser(deleteConfirm.id as string);
                    else deleteRole(deleteConfirm.id as number);
                  }}
                >
                  Hapus
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* TOASTS                                                   */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Portal>
        <div className="fixed bottom-6 right-6 z-[70] space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-in-right",
                t.type === "success"
                  ? "bg-success text-white"
                  : "bg-danger text-white"
              )}
            >
              {t.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {t.message}
            </div>
          ))}
        </div>
      </Portal>
    </div>
  );
}
