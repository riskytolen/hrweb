"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase-browser";
import type { User, Session } from "@supabase/supabase-js";

// ─── Types ───
export interface UserProfile {
  id: string;
  email: string;
  nama: string;
  role_id: number | null;
  employee_id: string | null;
  avatar_url: string | null;
  status: "Aktif" | "Tidak Aktif";
  account_type: "internal" | "external";
  last_login: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  roles?: {
    id: number;
    nama: string;
    level: number;
    permissions: string[];
    status?: "Aktif" | "Tidak Aktif";
  } | null;
}

/**
 * Permission level untuk setiap modul:
 * - "none"  → tidak ada akses
 * - "view"  → hanya lihat
 * - "input" → lihat + tambah data baru (tidak bisa edit/hapus)
 * - "edit"  → CRUD penuh (lihat, tambah, edit, hapus)
 */
export type PermissionLevel = "none" | "view" | "input" | "edit";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isSuperAdmin: boolean;
  /** Cek apakah user punya akses ke modul (minimal view) */
  hasPermission: (permission: string) => boolean;
  /** Dapatkan level permission untuk modul tertentu */
  getPermissionLevel: (module: string) => PermissionLevel;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  isLoading: true,
  isSuperAdmin: false,
  hasPermission: () => false,
  getPermissionLevel: () => "none",
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function externalCanViewVehicleOdometer(permissions: string[], permission: string): boolean {
  if (permission !== "vehicle-odometer" && permission !== "vehicle-odometer.view") return false;
  return permissions.some(
    (p) =>
      p === "all" ||
      p === "vehicle-odometer" ||
      p === "vehicle-odometer.view" ||
      p === "vehicle-odometer.input" ||
      p === "vehicle-odometer.manage",
  );
}

// ─── Provider ───
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*, roles(id, nama, level, permissions, status)")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Failed to fetch profile:", error);
        setProfile(null);
        return;
      }

      if (data) {
        // Ensure permissions is always an array
        if (data.roles && data.roles.permissions) {
          if (typeof data.roles.permissions === "string") {
            try {
              data.roles.permissions = JSON.parse(data.roles.permissions);
            } catch {
              data.roles.permissions = [];
            }
          }
        }
        if (data.status !== "Aktif" || data.roles?.status === "Tidak Aktif") {
          setProfile(null);
          await supabase.auth.signOut();
          return;
        }
        setProfile(data as UserProfile);

        // Update last_login via RPC so users cannot update privileged profile fields.
        supabase.rpc("touch_user_last_login").then(() => {});
      }
    },
    [supabase]
  );

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, fetchProfile]);

  const isSuperAdmin =
    profile?.status === "Aktif" &&
    profile.account_type === "internal" &&
    profile.roles?.status !== "Tidak Aktif" &&
    ((profile?.roles?.level ?? 0) >= 100 || (profile?.roles?.permissions ?? []).includes("all"));

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!profile?.roles || profile.status !== "Aktif" || profile.roles.status === "Tidak Aktif") return false;
      const perms = profile.roles.permissions;

      if (profile.account_type === "external") {
        return externalCanViewVehicleOdometer(perms, permission);
      }

      // "all" = akses penuh
      if (perms.includes("all")) return true;
      // Cek exact match atau parent match (e.g. "employees" covers "employees.view")
      // Juga: "employees.input" covers "employees.view"
      return perms.some(
        (p) => p === permission || permission.startsWith(p + ".")
      );
    },
    [profile]
  );

  /**
   * Dapatkan level permission untuk modul tertentu.
   * Urutan prioritas: edit > input > view > none
   */
  const getPermissionLevel = useCallback(
    (module: string): PermissionLevel => {
      if (!profile?.roles || profile.status !== "Aktif" || profile.roles.status === "Tidak Aktif") return "none";
      const perms = profile.roles.permissions;

      if (profile.account_type === "external") {
        if (module !== "vehicle-odometer") return "none";
        return externalCanViewVehicleOdometer(perms, "vehicle-odometer") ? "view" : "none";
      }

      // "all" = akses penuh
      if (perms.includes("all")) return "edit";
      // "module" (tanpa suffix) = full CRUD
      if (perms.includes(module)) return "edit";
      // "module.input" = lihat + tambah
      if (perms.includes(module + ".input")) return "input";
      // "module.view" = hanya lihat
      if (perms.includes(module + ".view")) return "view";
      return "none";
    },
    [profile]
  );

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  }, [supabase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isLoading,
        isSuperAdmin,
        hasPermission,
        getPermissionLevel,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
