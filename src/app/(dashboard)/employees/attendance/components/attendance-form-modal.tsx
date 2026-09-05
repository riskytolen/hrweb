"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import {
  ClipboardCheck, Pencil, X, ChevronUp, ChevronDown, Clock, Check, Plus, AlertTriangle,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";
import Portal from "@/components/ui/Portal";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import {
  MIN_DATE,
  ALASAN_MANUAL_OPTIONS,
  DEFAULT_DENDA_PER_MENIT,
  DEFAULT_BATAS_MENIT,
  DEFAULT_DENDA_MAKSIMUM,
  DEFAULT_DENDA_ALPHA,
} from "../lib/attendance-constants";
import { STATUS_OPTIONS, NO_JAM_STATUSES } from "../lib/attendance-status";
import {
  timeToMinutes,
  computeLateness,
  computeDenda,
  computeDendaAlpha,
} from "../lib/attendance-helpers";
import type {
  EmployeeLite,
  DivisionLite,
  ScheduleLite,
  PenaltyLite,
  OffDayEntry,
  OverrideEntry,
  AttendanceRow,
} from "../lib/attendance-types";
import type { AttendanceViewMode } from "../lib/hooks/use-attendance-filters";
import type { ToastType } from "../lib/hooks/use-toast";

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

export type AttendanceFormModalHandle = {
  openAdd: () => void;
  openEdit: (row: AttendanceRow) => void;
};

export type AttendanceFormModalProps = {
  dateFilter: string;
  employees: EmployeeLite[];
  divisions: DivisionLite[];
  schedules: ScheduleLite[];
  penalties: PenaltyLite[];
  offDays: OffDayEntry[];
  overrides: OverrideEntry[];
  records: AttendanceRow[];
  viewMode: AttendanceViewMode;
  onSaved: (tanggal: string) => Promise<void> | void;
  onShowToast: (type: ToastType, title: string, message?: string) => void;
};

type FormState = {
  employee_id: string;
  division_id: number;
  tanggal: string;
  jam_masuk: string;
  specialStatus: "" | "Izin" | "Sakit" | "Alpha" | "Cuti" | "Libur";
  catatan: string;
  alasan_manual: string;
};

const EMPTY_FORM: FormState = {
  employee_id: "",
  division_id: 0,
  tanggal: "",
  jam_masuk: "",
  specialStatus: "",
  catatan: "",
  alasan_manual: "",
};

export const AttendanceFormModal = forwardRef<AttendanceFormModalHandle, AttendanceFormModalProps>(function AttendanceFormModal(
  { dateFilter, employees, divisions, schedules, penalties, offDays, overrides, records, viewMode, onSaved, onShowToast },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [existingEmpIds, setExistingEmpIds] = useState<Set<string>>(new Set());

  // Lock body scroll when modal open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  const fetchExisting = useCallback(async (tanggal: string) => {
    if (!tanggal) {
      setExistingEmpIds(new Set());
      return;
    }
    const { data } = await supabase.from("attendance_records").select("employee_id").eq("tanggal", tanggal);
    setExistingEmpIds(new Set(data?.map((d) => d.employee_id) || []));
  }, []);

  const openAdd = useCallback(() => {
    setForm({ ...EMPTY_FORM, tanggal: dateFilter });
    setEditingId(null);
    setError("");
    fetchExisting(dateFilter);
    setOpen(true);
  }, [dateFilter, fetchExisting]);

  const openEdit = useCallback((row: AttendanceRow) => {
    const isSpec = (NO_JAM_STATUSES as readonly string[]).includes(row.status);
    setForm({
      employee_id: row.employee_id,
      division_id: row.division_id,
      tanggal: row.tanggal,
      jam_masuk: isSpec ? "" : row.jam_masuk.slice(0, 5),
      specialStatus: isSpec ? (row.status as FormState["specialStatus"]) : "",
      catatan: row.catatan || "",
      alasan_manual: (row as { alasan_manual?: string }).alasan_manual || "",
    });
    setEditingId(row.id);
    setError("");
    setOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({ openAdd, openEdit }), [openAdd, openEdit]);

  // Derived state for live preview
  const isSpecial = form.specialStatus !== "" && (NO_JAM_STATUSES as readonly string[]).includes(form.specialStatus);
  const formSchedule = useMemo(() => schedules.find((s) => s.division_id === form.division_id), [schedules, form.division_id]);
  const formPenalty = useMemo(() => penalties.find((p) => p.division_id === form.division_id), [penalties, form.division_id]);

  const formPreview = useMemo(() => {
    if (isSpecial) {
      const denda = form.specialStatus === "Alpha" ? computeDendaAlpha(formPenalty, DEFAULT_DENDA_ALPHA) : 0;
      return { status: form.specialStatus as string, durasi: 0, denda };
    }
    if (!form.jam_masuk || !formSchedule) return null;
    const result = computeLateness(form.jam_masuk, formSchedule.jam_masuk, formSchedule.toleransi_menit);
    const denda = computeDenda(result.durasi, formPenalty, {
      perMenit: DEFAULT_DENDA_PER_MENIT,
      batas: DEFAULT_BATAS_MENIT,
      maksimum: DEFAULT_DENDA_MAKSIMUM,
    });
    return { status: result.status, durasi: result.durasi, denda };
  }, [form.jam_masuk, form.specialStatus, formSchedule, formPenalty, isSpecial]);

  const previewColor = formPreview
    ? STATUS_OPTIONS.find((s) => s.value === formPreview.status)?.color || "#6b7280"
    : "#6b7280";

  const close = useCallback(() => {
    if (!saving) setOpen(false);
  }, [saving]);

  const handleSave = async () => {
    setError("");

    if (!form.employee_id) { setError("Pilih pegawai terlebih dahulu."); return; }
    if (!form.division_id) { setError("Pilih divisi terlebih dahulu."); return; }
    if (!form.tanggal) { setError("Pilih tanggal terlebih dahulu."); return; }
    if (!isSpecial && !form.jam_masuk) { setError("Isi jam masuk atau pilih status Alpha."); return; }
    if (!form.alasan_manual) { setError("Pilih alasan input manual."); return; }

    if (!editingId && form.employee_id && form.tanggal) {
      const emp = employees.find((e) => e.id === form.employee_id);
      if (emp?.tanggal_bergabung && form.tanggal < emp.tanggal_bergabung) {
        const tglBergabung = new Date(emp.tanggal_bergabung + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        setError(`${emp.nama} baru bergabung tanggal ${tglBergabung}. Tanggal absen harus pada atau setelah tanggal bergabung.`);
        return;
      }
      if (emp?.tanggal_keluar && form.tanggal >= emp.tanggal_keluar) {
        const tglKeluar = new Date(emp.tanggal_keluar + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        setError(`${emp.nama} sudah tidak aktif sejak ${tglKeluar}. Tanggal absen harus sebelum tanggal mulai tidak aktif.`);
        return;
      }
    }

    if (!editingId && form.employee_id && form.tanggal) {
      const [fy, fm, fd] = form.tanggal.split("-").map(Number);
      const formDow = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay();
      const empOff = offDays.filter((od) => od.employee_id === form.employee_id);
      const empOverride = overrides.find((ov) => ov.employee_id === form.employee_id && ov.tanggal === form.tanggal);
      const isLibur = empOverride?.type === "libur" || (!empOverride && empOff.some((od) => od.day_of_week === formDow));
      if (isLibur) {
        setError("Pegawai ini libur di tanggal tersebut. Tidak perlu input absen.");
        return;
      }
    }

    if (!editingId) {
      const { data: existing } = await supabase
        .from("attendance_records")
        .select("id")
        .eq("employee_id", form.employee_id)
        .eq("tanggal", form.tanggal)
        .limit(1);
      if (existing && existing.length > 0) {
        const empNama = employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id;
        setError(`${empNama} sudah memiliki data absen di tanggal ${form.tanggal}.`);
        return;
      }
    }

    setSaving(true);

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setError("Sesi login Anda berakhir. Silakan login ulang sebelum menyimpan absensi.");
      setSaving(false);
      return;
    }
    const expiresAt = sessionData.session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSec < 120) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        setError("Gagal memperbarui sesi login. Silakan login ulang.");
        setSaving(false);
        return;
      }
    }

    const sched = schedules.find((s) => s.division_id === form.division_id);
    const penalty = penalties.find((p) => p.division_id === form.division_id);
    const schedJamMasuk = sched?.jam_masuk || "08:00";
    const toleransi = sched?.toleransi_menit || 0;

    let status = "";
    let durasi = 0;
    let denda = 0;

    if (isSpecial) {
      status = form.specialStatus;
      if (status === "Alpha") denda = computeDendaAlpha(penalty, DEFAULT_DENDA_ALPHA);
    } else {
      const result = computeLateness(form.jam_masuk, schedJamMasuk, toleransi);
      status = result.status;
      durasi = result.durasi;
      denda = computeDenda(durasi, penalty, {
        perMenit: DEFAULT_DENDA_PER_MENIT,
        batas: DEFAULT_BATAS_MENIT,
        maksimum: DEFAULT_DENDA_MAKSIMUM,
      });
    }

    const payload = {
      employee_id: form.employee_id,
      division_id: form.division_id,
      tanggal: form.tanggal,
      jam_masuk: isSpecial ? schedJamMasuk : form.jam_masuk,
      schedule_jam_masuk: schedJamMasuk,
      toleransi_menit: toleransi,
      status,
      durasi_telat: durasi,
      denda,
      catatan: form.catatan || null,
      is_manual: true,
      alasan_manual: form.alasan_manual || null,
    };

    try {
      if (editingId) {
        const oldRecord = records.find((r) => r.id === editingId);
        const { error: err } = await supabase.from("attendance_records").update(payload).eq("id", editingId);
        if (err) { setError(err.message); setSaving(false); return; }
        const empNama = employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id;
        await logAudit({
          supabase,
          action: "update",
          entityType: "attendance_records",
          entityId: editingId,
          entityLabel: `Absensi ${empNama} (${form.tanggal})`,
          oldData: oldRecord ? { ...oldRecord } as unknown as Record<string, unknown> : null,
          newData: { ...payload } as Record<string, unknown>,
          metadata: { alasan_manual: form.alasan_manual || null, is_manual: true },
        });
        onShowToast("success", "Data Diperbarui", "Data absen berhasil diperbarui.");
      } else {
        const { data: inserted, error: err } = await supabase
          .from("attendance_records")
          .insert(payload)
          .select("id, jam_masuk, status, durasi_telat")
          .single();
        if (err) {
          if (err.message.includes("duplicate") || err.message.includes("unique")) {
            setError("Pegawai ini sudah memiliki data absen di tanggal tersebut.");
          } else {
            setError(err.message);
          }
          setSaving(false);
          return;
        }
        if (inserted && payload.jam_masuk && inserted.jam_masuk) {
          const formJam = String(payload.jam_masuk).slice(0, 5);
          const dbJam = String(inserted.jam_masuk).slice(0, 5);
          if (formJam !== dbJam) {
            await supabase.from("attendance_records").delete().eq("id", inserted.id);
            setError(
              `Sesi login bermasalah: server mengubah jam menjadi ${dbJam} (form: ${formJam}). ` +
                `Data tidak disimpan. Silakan logout dan login ulang sebagai Admin, kemudian coba lagi.`
            );
            setSaving(false);
            return;
          }
        }
        onShowToast("success", "Absensi Disimpan", `Data absen ${employees.find((e) => e.id === form.employee_id)?.nama || ""} berhasil disimpan.`);
        await logAudit({
          supabase,
          action: "manual_input",
          entityType: "attendance_records",
          entityId: inserted?.id,
          entityLabel: `Absensi ${employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id} (${form.tanggal})`,
          newData: { ...payload, id: inserted?.id } as Record<string, unknown>,
          metadata: { alasan_manual: form.alasan_manual || null, is_manual: true },
        });
      }
      setOpen(false);
      await onSaved(form.tanggal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
        <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
          <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
            <button onClick={close} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                {editingId ? <Pencil className="w-5 h-5 text-white" /> : <ClipboardCheck className="w-5 h-5 text-white" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">{editingId ? "Edit Data Absen" : "Input Absen Pegawai"}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingId ? "Perbarui data kehadiran" : "Catat kehadiran pegawai"}
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Pegawai <span className="text-danger">*</span></label>
              {editingId ? (
                <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-foreground">
                  {employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id}
                </div>
              ) : (
                <>
                  <Select
                    value={form.employee_id}
                    onChange={(val) => { setForm({ ...form, employee_id: val }); setError(""); }}
                    options={employees.filter((e) => !existingEmpIds.has(e.id)).map((e) => ({ value: e.id, label: e.nama }))}
                    placeholder="Pilih pegawai"
                    searchable
                  />
                  {existingEmpIds.size > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">{existingEmpIds.size} pegawai sudah absen di tanggal ini</p>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Divisi <span className="text-danger">*</span></label>
                <Select
                  value={String(form.division_id || "")}
                  onChange={(val) => { setForm({ ...form, division_id: parseInt(val) || 0 }); setError(""); }}
                  options={divisions.map((d) => ({ value: String(d.id), label: d.nama }))}
                  placeholder="Pilih divisi"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                <DatePicker value={form.tanggal} onChange={(val) => { setForm({ ...form, tanggal: val, employee_id: "" }); if (!editingId) fetchExisting(val); }} placeholder="Pilih tanggal" minDate={MIN_DATE} />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground mb-2 block">Keterangan Tidak Hadir</label>
              <div className="flex items-center gap-2">
                {(["Alpha"] as const).map((s) => {
                  const sc = STATUS_OPTIONS.find((o) => o.value === s)!;
                  const active = form.specialStatus === s;
                  return (
                    <button key={s} type="button"
                      onClick={() => setForm({ ...form, specialStatus: active ? "" : s, jam_masuk: active ? form.jam_masuk : "" })}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border-2",
                        active
                          ? "shadow-md"
                          : "border-border bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/50"
                      )}
                      style={active ? { borderColor: sc.color, backgroundColor: `${sc.color}15`, color: sc.color, boxShadow: `0 4px 12px ${sc.color}20` } : undefined}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              {isSpecial && (
                <p className="text-[10px] text-muted-foreground mt-1.5">Jam masuk tidak diperlukan untuk status {form.specialStatus}</p>
              )}
            </div>

            {!isSpecial && (() => {
              const [hh, mm] = (form.jam_masuk || "").split(":").map((v) => parseInt(v) || 0);
              const hasTime = !!form.jam_masuk;
              const setTime = (h: number, m: number) => {
                const ch = Math.max(0, Math.min(23, h));
                const cm = Math.max(0, Math.min(59, m));
                const val = `${String(ch).padStart(2, "0")}:${String(cm).padStart(2, "0")}`;
                setForm({ ...form, jam_masuk: val });
                setError("");
              };
              const presets = formSchedule
                ? [formSchedule.jam_masuk.slice(0, 5), ...[5, 10, 15, 30].map((d) => {
                    const base = timeToMinutes(formSchedule.jam_masuk);
                    const t = base + d;
                    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
                  })]
                : ["07:00", "07:30", "08:00", "08:15", "08:30"];

              return (
                <div>
                  <label className="text-xs font-semibold text-foreground mb-2 block">Jam Masuk <span className="text-danger">*</span></label>
                  <div className="flex items-center justify-center gap-1 mb-3">
                    <div className="flex flex-col items-center gap-1">
                      <button type="button" onClick={() => setTime(hh + 1, mm)}
                        className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <div className={cn(
                        "w-16 h-14 rounded-xl flex items-center justify-center text-2xl font-extrabold tracking-wider transition-all",
                        hasTime ? "bg-primary/10 text-primary border-2 border-primary/20" : "bg-muted/50 text-muted-foreground/40 border-2 border-dashed border-border"
                      )}>
                        {hasTime ? String(hh).padStart(2, "0") : "--"}
                      </div>
                      <button type="button" onClick={() => setTime(hh - 1, mm)}
                        className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 px-1 pt-1">
                      <div className={cn("w-1.5 h-1.5 rounded-full", hasTime ? "bg-primary" : "bg-muted-foreground/30")} />
                      <div className={cn("w-1.5 h-1.5 rounded-full", hasTime ? "bg-primary" : "bg-muted-foreground/30")} />
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <button type="button" onClick={() => setTime(hh, mm + 1)}
                        className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <div className={cn(
                        "w-16 h-14 rounded-xl flex items-center justify-center text-2xl font-extrabold tracking-wider transition-all",
                        hasTime ? "bg-primary/10 text-primary border-2 border-primary/20" : "bg-muted/50 text-muted-foreground/40 border-2 border-dashed border-border"
                      )}>
                        {hasTime ? String(mm).padStart(2, "0") : "--"}
                      </div>
                      <button type="button" onClick={() => setTime(hh, mm - 1)}
                        className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 justify-center">
                    {presets.map((t) => {
                      const isActive = form.jam_masuk === t;
                      return (
                        <button key={t} type="button" onClick={() => { setForm({ ...form, jam_masuk: t }); setError(""); }}
                          className={cn(
                            "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                            isActive
                              ? "bg-primary text-white shadow-sm shadow-primary/25"
                              : "bg-muted/60 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          )}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                  {formSchedule && (
                    <div className="flex items-center justify-center gap-2 mt-3">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg">
                        <Clock className="w-3 h-3" />
                        Jadwal <strong className="text-foreground">{formSchedule.jam_masuk.slice(0, 5)}</strong>
                      </div>
                      {formSchedule.toleransi_menit > 0 && (
                        <div className="text-[10px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg">
                          Toleransi <strong className="text-foreground">{formSchedule.toleransi_menit} mnt</strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {formPreview && (
              <div className="rounded-xl border-2 p-4 transition-all" style={{ borderColor: `${previewColor}30`, backgroundColor: `${previewColor}08` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${previewColor}20` }}>
                      <span className="text-sm font-extrabold" style={{ color: previewColor }}>
                        {formPreview.status === "Hadir" ? <Check className="w-4.5 h-4.5" /> : formPreview.status.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-bold" style={{ color: previewColor }}>{formPreview.status}</p>
                      {formPreview.durasi > 0 && (
                        <p className="text-[10px] text-muted-foreground">Terlambat {formPreview.durasi} menit</p>
                      )}
                    </div>
                  </div>
                  {formPreview.denda > 0 && (
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Denda</p>
                      <p className="text-sm font-bold text-danger">{formatCurrency(formPreview.denda)}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Alasan Input Manual <span className="text-danger">*</span></label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {ALASAN_MANUAL_OPTIONS.map((alasan) => (
                  <button key={alasan} type="button" onClick={() => setForm({ ...form, alasan_manual: alasan })}
                    className={cn("px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                      form.alasan_manual === alasan
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    )}>
                    {alasan}
                  </button>
                ))}
              </div>
              {form.alasan_manual === "Lainnya" && (
                <input type="text" placeholder="Tulis alasan lainnya..." value={form.catatan}
                  onChange={(e) => setForm({ ...form, catatan: e.target.value })} className={inputClass} />
              )}
              <p className="text-[10px] text-muted-foreground mt-1">Wajib dipilih karena absen diinput manual (bukan dari aplikasi)</p>
            </div>

            {form.alasan_manual !== "Lainnya" && (
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                <input type="text" placeholder="Keterangan tambahan..." value={form.catatan}
                  onChange={(e) => setForm({ ...form, catatan: e.target.value })} className={inputClass} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={close} disabled={saving}>Batal</Button>
            <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSave} disabled={saving}>
              {saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Absen"}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
});
