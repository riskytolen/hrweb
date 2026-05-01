"use client";

import { useState, useEffect, useCallback } from "react";
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

// ─── Types ───
interface Role {
  id: number;
  nama: string;
  deskripsi: string | null;
  level: number;
  permissions: string[];
  status: "Aktif" | "Tidak Aktif";
}

interface UserWithRole extends UserProfile {
  roles: Role | null;
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
];

export default function AccountsPage() {
  const supabase = createClient();
  const { isSuperAdmin, profile: currentUser } = useAuth();

  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
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
    status: "Aktif" as "Aktif" | "Tidak Aktif",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

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

  // ─── Fetch Data ───
  const fetchUsers = useCallback(async () => {
    const { data } = await supabase
      .from("user_profiles")
      .select("*, roles(id, nama, deskripsi, level, permissions, status)")
      .order("created_at", { ascending: false });
    if (data) setUsers(data as UserWithRole[]);
  }, [supabase]);

  const fetchRoles = useCallback(async () => {
    const { data } = await supabase
      .from("roles")
      .select("*")
      .order("level", { ascending: false });
    if (data) setRoles(data as Role[]);
  }, [supabase]);

  useEffect(() => {
    Promise.all([fetchUsers(), fetchRoles()]).finally(() => setLoading(false));
  }, [fetchUsers, fetchRoles]);

  // ─── User CRUD ───
  const openCreateUser = () => {
    setEditingUserId(null);
    setUserForm({ email: "", nama: "", password: "", role_id: roles[0]?.id || 0, status: "Aktif" });
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
      status: u.status,
    });
    setShowPassword(false);
    setShowUserModal(true);
  };

  const saveUser = async () => {
    if (!userForm.email || !userForm.nama || !userForm.role_id) {
      addToast("error", "Lengkapi semua field yang wajib.");
      return;
    }

    setSaving(true);
    try {
      if (editingUserId) {
        // Update profile
        const { error } = await supabase
          .from("user_profiles")
          .update({
            nama: userForm.nama,
            role_id: userForm.role_id,
            status: userForm.status,
          })
          .eq("id", editingUserId);

        if (error) throw error;
        addToast("success", `Akun ${userForm.nama} berhasil diperbarui.`);
      } else {
        // Create new user via Supabase Auth
        if (!userForm.password || userForm.password.length < 6) {
          addToast("error", "Password minimal 6 karakter.");
          setSaving(false);
          return;
        }

        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: userForm.email,
          password: userForm.password,
          options: {
            data: { nama: userForm.nama },
          },
        });

        if (authError) throw authError;

        // Update the auto-created profile with correct role
        if (authData.user) {
          await supabase
            .from("user_profiles")
            .update({
              nama: userForm.nama,
              role_id: userForm.role_id,
              status: userForm.status,
            })
            .eq("id", authData.user.id);
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

  const deleteUser = async (id: string) => {
    const { error } = await supabase.from("user_profiles").delete().eq("id", id);
    if (error) {
      addToast("error", "Gagal menghapus akun.");
    } else {
      addToast("success", "Akun berhasil dihapus.");
      fetchUsers();
    }
    setDeleteConfirm(null);
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

  const togglePermission = (key: string) => {
    setRoleForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  };

  // ─── Filter ───
  const filteredUsers = users.filter(
    (u) =>
      u.nama.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.roles?.nama || "").toLowerCase().includes(search.toLowerCase())
  );

  // ─── Guard ───
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
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Email</th>
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
                            {u.id === currentUser?.id && (
                              <span className="text-[10px] text-primary font-semibold">(Anda)</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
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
                      r.permissions.map((p) => (
                        <span key={p} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
                          {PERMISSION_OPTIONS.find((o) => o.key === p || p.startsWith(o.key))?.label || p}
                        </span>
                      ))
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
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowUserModal(false)} />
          <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md animate-scale-in">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                {editingUserId ? "Edit Akun" : "Tambah Akun Baru"}
              </h3>
              <button onClick={() => setShowUserModal(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Nama */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Nama Lengkap *</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={userForm.nama}
                    onChange={(e) => setUserForm({ ...userForm, nama: e.target.value })}
                    placeholder="Nama lengkap"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Email *</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    placeholder="email@jamslogistic.com"
                    disabled={!!editingUserId}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Password (only for new user) */}
              {!editingUserId && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Password *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      placeholder="Minimal 6 karakter"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Role */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Role *</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <select
                    value={userForm.role_id}
                    onChange={(e) => setUserForm({ ...userForm, role_id: Number(e.target.value) })}
                    className="w-full pl-10 pr-8 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 appearance-none"
                  >
                    <option value={0}>Pilih role...</option>
                    {roles.filter((r) => r.status === "Aktif").map((r) => (
                      <option key={r.id} value={r.id}>{r.nama} (Level {r.level})</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Status</label>
                <div className="flex gap-2">
                  {(["Aktif", "Tidak Aktif"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setUserForm({ ...userForm, status: s })}
                      className={cn(
                        "flex-1 py-2 rounded-xl text-sm font-semibold border transition-all",
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

            <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
              <button
                onClick={() => setShowUserModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Batal
              </button>
              <button
                onClick={saveUser}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {editingUserId ? "Simpan Perubahan" : "Buat Akun"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* MODAL: CREATE/EDIT ROLE                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      {showRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowRoleModal(false)} />
          <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-primary" />
                {editingRoleId ? "Edit Role" : "Tambah Role Baru"}
              </h3>
              <button onClick={() => setShowRoleModal(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Nama */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Nama Role *</label>
                <input
                  type="text"
                  value={roleForm.nama}
                  onChange={(e) => setRoleForm({ ...roleForm, nama: e.target.value })}
                  placeholder="Contoh: Admin HR"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>

              {/* Deskripsi */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Deskripsi</label>
                <textarea
                  value={roleForm.deskripsi}
                  onChange={(e) => setRoleForm({ ...roleForm, deskripsi: e.target.value })}
                  placeholder="Deskripsi singkat role ini..."
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 resize-none"
                />
              </div>

              {/* Level */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Level Akses (0-100)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={roleForm.level}
                  onChange={(e) => setRoleForm({ ...roleForm, level: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
                <p className="text-[11px] text-muted-foreground">Level 100 = Super Admin (akses penuh). Semakin tinggi = semakin banyak akses.</p>
              </div>

              {/* Permissions */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Hak Akses Modul</label>

                {/* All access toggle */}
                <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 cursor-pointer">
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
                    <p className="text-[11px] text-muted-foreground">Dapat mengakses semua modul</p>
                  </div>
                </label>

                {!roleForm.permissions.includes("all") && (
                  <div className="grid grid-cols-2 gap-2">
                    {PERMISSION_OPTIONS.map((opt) => (
                      <label
                        key={opt.key}
                        className={cn(
                          "flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all",
                          roleForm.permissions.includes(opt.key)
                            ? "border-primary/30 bg-primary/5"
                            : "border-border hover:bg-muted/30"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={roleForm.permissions.includes(opt.key)}
                          onChange={() => togglePermission(opt.key)}
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-xs font-medium text-foreground">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Status</label>
                <div className="flex gap-2">
                  {(["Aktif", "Tidak Aktif"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setRoleForm({ ...roleForm, status: s })}
                      className={cn(
                        "flex-1 py-2 rounded-xl text-sm font-semibold border transition-all",
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

            <div className="flex items-center justify-end gap-2 p-5 border-t border-border sticky bottom-0 bg-card">
              <button
                onClick={() => setShowRoleModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Batal
              </button>
              <button
                onClick={saveRole}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {editingRoleId ? "Simpan Perubahan" : "Buat Role"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* MODAL: DELETE CONFIRM                                    */}
      {/* ═══════════════════════════════════════════════════════ */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm animate-scale-in p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6 text-danger" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Hapus {deleteConfirm.type === "user" ? "Akun" : "Role"}?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                <strong>{deleteConfirm.name}</strong> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted border border-border"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (deleteConfirm.type === "user") deleteUser(deleteConfirm.id as string);
                  else deleteRole(deleteConfirm.id as number);
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-danger text-white hover:opacity-90"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* TOASTS                                                   */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div className="fixed bottom-6 right-6 z-[60] space-y-2">
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
    </div>
  );
}
