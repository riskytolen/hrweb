"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Eye,
  EyeOff,
  ArrowRight,
  Lock,
  Mail,
  Shield,
  Truck,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // 1. Sign in with Supabase Auth
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        if (authError.message.includes("Invalid login credentials")) {
          setError("Email atau password salah. Silakan coba lagi.");
        } else if (authError.message.includes("Email not confirmed")) {
          setError("Akun belum dikonfirmasi. Hubungi Super Admin.");
        } else {
          setError(authError.message);
        }
        setIsLoading(false);
        return;
      }

      // 2. Check if user profile is active
      if (data.user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("status")
          .eq("id", data.user.id)
          .single();

        if (profile && profile.status === "Tidak Aktif") {
          await supabase.auth.signOut();
          setError("Akun Anda telah dinonaktifkan. Hubungi Super Admin.");
          setIsLoading(false);
          return;
        }
      }

      // 3. Success → redirect
      router.push("/employees");
      router.refresh();
    } catch {
      setError("Terjadi kesalahan. Silakan coba lagi.");
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page h-screen flex relative overflow-hidden">
      {/* ═══════════════════════════════════════════════════════ */}
      {/* FULL-SCREEN ANIMATED BACKGROUND                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 login-bg-base">
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
        <div className="absolute inset-0 login-grid-pattern opacity-[0.03]" />
        <div className="absolute inset-0 login-noise opacity-[0.015]" />
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* LEFT — Branding & Info                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex lg:w-[50%] relative z-10 flex-col justify-between p-10 xl:p-14">
        {/* Top — Logo */}
        <div
          className={`transition-all duration-700 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="login-logo-box">
              <Image
                src="/logo.png"
                alt="Jamslogistic"
                width={22}
                height={22}
                className="object-contain"
              />
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              Jams<span className="login-brand-accent">logistic</span>
            </span>
          </div>
        </div>

        {/* Center — Hero Content */}
        <div className="space-y-8 max-w-lg">
          <div
            className={`transition-all duration-700 delay-100 ${
              mounted
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-6"
            }`}
          >
            <div className="login-badge">
              <Truck className="w-3.5 h-3.5" />
              <span>Human Resource Management System</span>
            </div>
          </div>

          <div
            className={`space-y-4 transition-all duration-1000 delay-200 ${
              mounted
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-8"
            }`}
          >
            <h1 className="text-[2.5rem] xl:text-[3.25rem] font-extrabold text-white leading-[1.1] tracking-[-0.03em]">
              Kelola SDM
              <br />
              Perusahaan dengan
              <br />
              <span className="login-gradient-text">Lebih Efisien.</span>
            </h1>
            <p className="text-white/45 text-base xl:text-lg leading-relaxed max-w-md font-medium">
              Sistem manajemen sumber daya manusia internal Jamslogistic.
              Absensi, penggajian, dan performa dalam satu platform.
            </p>
          </div>

          <div
            className={`flex flex-wrap gap-3 transition-all duration-1000 delay-400 ${
              mounted
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-4"
            }`}
          >
            {["Absensi", "Penggajian", "Rekrutmen", "Performa"].map(
              (item, i) => (
                <div key={i} className="login-feature-pill">
                  {item}
                </div>
              )
            )}
          </div>
        </div>

        {/* Bottom — Footer */}
        <div
          className={`flex items-center gap-5 transition-all duration-1000 delay-600 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="login-status-dot">
              <span className="login-status-ping" />
              <span className="login-status-core" />
            </div>
            <span className="text-white/40 text-sm font-medium">
              Sistem aktif
            </span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <span className="text-white/25 text-sm">
            &copy; {new Date().getFullYear()} Jamslogistic
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* RIGHT — Login Card                                      */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex items-center justify-center px-6 sm:px-10 relative z-10">
        <div
          className={`login-card transition-all duration-700 delay-150 ${
            mounted
              ? "opacity-100 translate-y-0 scale-100"
              : "opacity-0 translate-y-6 scale-[0.98]"
          }`}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-px login-card-glow" />

          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="login-logo-box">
              <Image
                src="/logo.png"
                alt="Jamslogistic"
                width={20}
                height={20}
                className="object-contain"
              />
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              Jams<span className="login-brand-accent">logistic</span>
            </span>
          </div>

          {/* Header */}
          <div className="mb-7">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Shield className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-white/40 text-xs font-semibold uppercase tracking-widest">
                Internal Access
              </span>
            </div>
            <h2 className="text-[1.6rem] font-bold text-white tracking-tight leading-tight">
              Masuk ke HRM System
            </h2>
            <p className="text-white/40 text-sm mt-2 leading-relaxed">
              Gunakan email dan password perusahaan Anda.
            </p>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="login-error-alert mb-5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div className="space-y-2">
              <label className="login-label">Email</label>
              <div
                className={`login-input-wrap ${
                  focusedField === "email" ? "is-focused" : ""
                }`}
              >
                <Mail className="login-input-icon" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@jamslogistic.com"
                  required
                  onFocus={() => setFocusedField("email")}
                  onBlur={() => setFocusedField(null)}
                  className="login-input"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="login-label">Password</label>
              <div
                className={`login-input-wrap ${
                  focusedField === "password" ? "is-focused" : ""
                }`}
              >
                <Lock className="login-input-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  required
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  className="login-input !pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-[18px] h-[18px]" />
                  ) : (
                    <Eye className="w-[18px] h-[18px]" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="login-submit-btn group"
            >
              {isLoading ? (
                <>
                  <div className="login-spinner" />
                  <span>Memverifikasi...</span>
                </>
              ) : (
                <>
                  <span>Masuk</span>
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-white/20 text-xs mt-7 leading-relaxed font-medium">
            Akses terbatas hanya untuk karyawan Jamslogistic.
            <br />
            Hubungi HRD jika mengalami kendala login.
          </p>
        </div>
      </div>
    </div>
  );
}
