"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import {
  SlidersHorizontal, Save, RefreshCw, Upload, X, Building2, FileText, Mail, Phone,
  Percent, Wallet, MapPin, AlertCircle, CheckCircle2, Landmark, PenLine,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import RouteGuard from "@/components/RouteGuard";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DbFinanceCompanySettings } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import { parseFinanceDbError } from "@/lib/finance-closing";

const LOGO_BUCKET = "finance-assets";
const LOGO_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

export default function FinancePengaturanPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("finance");
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<DbFinanceCompanySettings | null>(null);
  const [form, setForm] = useState({
    company_name: "", address: "", npwp: "", phone: "", email: "",
    ppn_default: 0, initial_cash_balance: 0,
    bank_name: "", bank_account_number: "", bank_account_name: "",
    signer_city: "", signer_name: "", signer_title: "",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [hasClosing, setHasClosing] = useState(false);
  const [lastClosed, setLastClosed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMsg = useCallback((type: "success" | "error", text: string) => {
    if (msgTimer.current) clearTimeout(msgTimer.current);
    setMessage({ type, text });
    msgTimer.current = setTimeout(() => setMessage(null), 3500);
  }, []);

  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current); }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, statusRes] = await Promise.all([
        supabase.from("finance_company_settings").select("*").eq("id", 1).maybeSingle(),
        (supabase.from("finance_month_status" as never).select("period_start, state") as unknown as Promise<{ data: { period_start: string; state: string }[] | null }>),
      ]);
      if (data) {
        const s = data as DbFinanceCompanySettings;
        setSettings(s);
        setForm({
          company_name: s.company_name, address: s.address || "", npwp: s.npwp || "",
          phone: s.phone || "", email: s.email || "", ppn_default: Number(s.ppn_default),
          initial_cash_balance: Number(s.initial_cash_balance),
          bank_name: s.bank_name || "", bank_account_number: s.bank_account_number || "",
          bank_account_name: s.bank_account_name || "",
          signer_city: s.signer_city || "", signer_name: s.signer_name || "",
          signer_title: s.signer_title || "",
        });
        setLogoPreview(s.logo_url);
      }
      const rows = (statusRes as unknown as { data: { period_start: string; state: string }[] | null }).data;
      if (rows && rows.length > 0) {
        const closed = rows.filter((r) => r.state === "close").sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
        setHasClosing(closed.length > 0);
        setLastClosed(closed.length ? closed[closed.length - 1].period_start.slice(0, 7) : null);
      }
    } catch {
      showMsg("error", "Gagal memuat pengaturan.");
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => {
    (async () => { await fetchSettings(); })();
  }, [fetchSettings]);

  const handleLogoFile = (file: File | null) => {
    if (!file) return;
    if (!LOGO_MIME_TYPES.includes(file.type)) {
      showMsg("error", "Format logo harus JPG, PNG, atau WebP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showMsg("error", "Ukuran logo maksimal 2 MB.");
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const uploadLogo = async (): Promise<{ url: string; path: string } | null> => {
    if (!logoFile) return null;
    const path = `logo/${Date.now()}-${logoFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, logoFile, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, path };
  };

  const save = async () => {
    if (!form.company_name.trim()) {
      showMsg("error", "Nama perusahaan wajib diisi.");
      return;
    }
    setSaving(true);
    // Path logo baru yang sudah ter-upload; dipakai untuk bersih-bersih
    // bila update database gagal agar tidak ada file yatim di bucket.
    let uploadedPath: string | null = null;
    try {
      let logoUrl = settings?.logo_url ?? null;
      let logoPath = settings?.logo_path ?? null;

      if (logoFile) {
        const uploaded = await uploadLogo();
        if (!uploaded) throw new Error("Gagal upload logo.");
        uploadedPath = uploaded.path;
        logoUrl = uploaded.url;
        logoPath = uploaded.path;
      }

      const payload = {
        company_name: form.company_name.trim(),
        address: form.address || null,
        npwp: form.npwp || null,
        phone: form.phone || null,
        email: form.email || null,
        ppn_default: form.ppn_default,
        initial_cash_balance: form.initial_cash_balance,
        bank_name: form.bank_name || null,
        bank_account_number: form.bank_account_number || null,
        bank_account_name: form.bank_account_name || null,
        signer_city: form.signer_city || null,
        signer_name: form.signer_name || null,
        signer_title: form.signer_title || null,
        logo_url: logoUrl,
        logo_path: logoPath,
        updated_by: "web-admin",
      };
      const { error } = await supabase.from("finance_company_settings").update(payload).eq("id", 1);
      if (error) throw new Error(parseFinanceDbError(error));
      await logAudit({ supabase, action: "update", entityType: "finance_company_settings", entityId: 1, entityLabel: "Pengaturan Finance", newData: payload });
      // Logo lama baru dihapus setelah database berhasil — logo yang tampil tidak pernah putus.
      if (uploadedPath && settings?.logo_path && settings.logo_path !== uploadedPath) {
        await supabase.storage.from(LOGO_BUCKET).remove([settings.logo_path]).catch(() => {});
      }
      uploadedPath = null;
      showMsg("success", "Pengaturan berhasil disimpan.");
      setLogoFile(null);
      fetchSettings();
    } catch (err) {
      // Update gagal: hapus logo baru agar tidak menjadi file yatim.
      if (uploadedPath) {
        await supabase.storage.from(LOGO_BUCKET).remove([uploadedPath]).catch(() => {});
      }
      showMsg("error", err instanceof Error ? err.message : "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RouteGuard permission="finance">
      <PageHeader
        title="Pengaturan Finance"
        description="Profil perusahaan, PPN default, saldo awal, info invoice, dan logo"
        icon={SlidersHorizontal}
        actions={
          canEdit ? (
            <Button size="sm" icon={Save} onClick={save} disabled={saving || !form.company_name.trim()}>
              {saving ? "Menyimpan..." : "Simpan Pengaturan"}
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Profil */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Profil Perusahaan</h2>
                  <p className="text-[11px] text-muted-foreground">Tampil di header laporan & invoice</p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Perusahaan <span className="text-danger">*</span></label>
                  <input type="text" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} disabled={!canEdit} className={cn(inputClass, !canEdit && "opacity-60")} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Alamat</label>
                  <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} disabled={!canEdit} className={cn(inputClass, !canEdit && "opacity-60")} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block flex items-center gap-1.5"><FileText className="w-3 h-3" /> NPWP</label>
                    <input type="text" value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} disabled={!canEdit} className={cn(inputClass, !canEdit && "opacity-60")} placeholder="00.000.000.0-000.000" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block flex items-center gap-1.5"><Phone className="w-3 h-3" /> Telepon</label>
                    <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canEdit} className={cn(inputClass, !canEdit && "opacity-60")} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block flex items-center gap-1.5"><Mail className="w-3 h-3" /> Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!canEdit} className={cn(inputClass, !canEdit && "opacity-60")} />
                </div>
              </div>
            </div>

            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center">
                  <Percent className="w-4 h-4 text-warning" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Pengaturan Default</h2>
                  <p className="text-[11px] text-muted-foreground">Nilai default untuk invoice & perhitungan kas</p>
                </div>
              </div>
              <div className="p-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block flex items-center gap-1.5"><Percent className="w-3 h-3" /> PPN Default (%)</label>
                  <input type="number" min={0} max={100} step={0.01} value={form.ppn_default} onChange={(e) => setForm({ ...form, ppn_default: Number(e.target.value) })} disabled={!canEdit} className={cn(inputClass, !canEdit && "opacity-60")} />
                  <p className="text-[10px] text-muted-foreground mt-1">Terisi otomatis saat membuat invoice baru.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block flex items-center gap-1.5"><Wallet className="w-3 h-3" /> Saldo Awal Kas (Rp)</label>
                  <CurrencyInput value={form.initial_cash_balance} onChange={(v) => setForm({ ...form, initial_cash_balance: v })} disabled={!canEdit || hasClosing} />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {hasClosing ? `Terkunci setelah closing pertama${lastClosed ? ` (terakhir ${lastClosed})` : ""}. Kelola di Tutup Buku.` : "Dasar perhitungan saldo arus kas."}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  <Landmark className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Informasi Invoice & Pembayaran</h2>
                  <p className="text-[11px] text-muted-foreground">Tampil di PDF invoice fisik: rekening tujuan & penandatangan</p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Bank</label>
                    <input type="text" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} disabled={!canEdit} placeholder="cth. BCA" className={cn(inputClass, !canEdit && "opacity-60")} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Nomor Rekening</label>
                    <input type="text" value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} disabled={!canEdit} placeholder="cth. 1234567890" className={cn(inputClass, !canEdit && "opacity-60")} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Atas Nama</label>
                    <input type="text" value={form.bank_account_name} onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })} disabled={!canEdit} placeholder="Nama pemilik rekening" className={cn(inputClass, !canEdit && "opacity-60")} />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block flex items-center gap-1.5"><PenLine className="w-3 h-3" /> Kota Penandatanganan</label>
                    <input type="text" value={form.signer_city} onChange={(e) => setForm({ ...form, signer_city: e.target.value })} disabled={!canEdit} placeholder="cth. Jakarta" className={cn(inputClass, !canEdit && "opacity-60")} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Penandatangan</label>
                    <input type="text" value={form.signer_name} onChange={(e) => setForm({ ...form, signer_name: e.target.value })} disabled={!canEdit} placeholder="Nama terang" className={cn(inputClass, !canEdit && "opacity-60")} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Jabatan</label>
                    <input type="text" value={form.signer_title} onChange={(e) => setForm({ ...form, signer_title: e.target.value })} disabled={!canEdit} placeholder="cth. Direktur" className={cn(inputClass, !canEdit && "opacity-60")} />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Kolom tanda tangan pada PDF diisi manual (tanda tangan basah/stempel). Kosongkan bila belum ada datanya — PDF tetap dapat dicetak.
                </p>
              </div>
            </div>
          </div>

          {/* Logo */}
          <div className="space-y-4">
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center">
                  <Upload className="w-4 h-4 text-success" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Logo</h2>
                  <p className="text-[11px] text-muted-foreground">Maks 2 MB, JPG/PNG/WebP</p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-center">
                  <div className="w-36 h-36 rounded-2xl border-2 border-dashed border-border bg-muted/20 flex items-center justify-center overflow-hidden">
                    {logoPreview ? (
                      <Image src={logoPreview} alt="Logo" width={144} height={144} className="object-contain w-full h-full" unoptimized />
                    ) : (
                      <Building2 className="w-10 h-10 text-muted-foreground/40" />
                    )}
                  </div>
                </div>
                {canEdit && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoFile(e.target.files?.[0] || null)} />
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => fileRef.current?.click()}>
                        <Upload className="w-3.5 h-3.5" /> Pilih Logo
                      </Button>
                      {logoPreview && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setLogoFile(null); setLogoPreview(settings?.logo_url ?? null); }}
                        >
                          <X className="w-3.5 h-3.5" /> Batal
                        </Button>
                      )}
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/40 border border-border/50 text-[11px] text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
                  Logo disimpan di bucket <code className="font-mono bg-muted px-1 py-0.5 rounded">finance-assets</code> dan dipakai di halaman dashboard finance.
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-5 space-y-3">
              <h3 className="text-sm font-bold text-foreground">Info Modul</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Modul Finance bersifat <b className="text-foreground">standalone</b> dan tidak tersinkron otomatis
                dengan Petty Cash, Payroll, atau Rekap Titik. Input dilakukan manual di halaman
                Pendapatan dan Pengeluaran.
              </p>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5 text-warning" /> Status invoice dihitung otomatis dari total pembayaran.</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-success" /> Semua nominal disimpan sebagai bilangan bulat rupiah.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={cn(
          "fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white",
          message.type === "success" ? "bg-success" : "bg-danger"
        )}>
          {message.text}
        </div>
      )}
    </RouteGuard>
  );
}
