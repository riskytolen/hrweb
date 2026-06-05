"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Search, X, User } from "lucide-react";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import Pagination from "@/components/ui/Pagination";
import { getDateRange, getAffectedEmployeeIds } from "../lib/attendance-helpers";
import { HOLIDAY_DETAIL_PAGE_SIZE, HOLIDAY_COLORS } from "../lib/attendance-constants";
import type { EmployeeLite, PublicHoliday } from "../lib/attendance-types";

export type HolidayDetailModalHandle = {
  open: (h: PublicHoliday) => void;
};

type HolidayDetailModalProps = {
  employees: EmployeeLite[];
};

export const HolidayDetailModal = forwardRef<HolidayDetailModalHandle, HolidayDetailModalProps>(
  function HolidayDetailModal({ employees }, ref) {
    const [holiday, setHoliday] = useState<PublicHoliday | null>(null);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    useImperativeHandle(ref, () => ({
      open: (h: PublicHoliday) => {
        setHoliday(h);
        setSearch("");
        setPage(1);
      },
    }), []);

    const close = () => setHoliday(null);

    if (!holiday) return null;

    const dates = getDateRange(holiday.tanggal, holiday.tanggal_selesai);
    const empIds = getAffectedEmployeeIds(holiday, employees);
    const affectedEmps = employees
      .filter((e) => empIds.includes(e.id))
      .filter((e) => !search || e.nama.toLowerCase().includes(search.toLowerCase()));
    const rangeLabel = holiday.tanggal_selesai && holiday.tanggal_selesai !== holiday.tanggal
      ? `${new Date(holiday.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} - ${new Date(holiday.tanggal_selesai + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`
      : new Date(holiday.tanggal + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const total = affectedEmps.length;
    const totalPages = Math.max(1, Math.ceil(total / HOLIDAY_DETAIL_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pagedEmps = affectedEmps.slice((safePage - 1) * HOLIDAY_DETAIL_PAGE_SIZE, safePage * HOLIDAY_DETAIL_PAGE_SIZE);

    return (
      <Portal>
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
          <div className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[85vh]">
            <div className="flex items-start justify-between p-5 border-b border-border">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${HOLIDAY_COLORS[holiday.kategori]}15` }}>
                  <span className="w-5 h-5 rounded flex items-center justify-center text-base font-bold" style={{ color: HOLIDAY_COLORS[holiday.kategori] }}>
                    {holiday.kategori.charAt(0)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-foreground truncate">{holiday.nama}</h3>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: `${HOLIDAY_COLORS[holiday.kategori]}15`, color: HOLIDAY_COLORS[holiday.kategori] }}>{holiday.kategori}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{rangeLabel}</p>
                  {holiday.catatan && <p className="text-[10px] text-muted-foreground/70 mt-1 italic">&quot;{holiday.catatan}&quot;</p>}
                </div>
              </div>
              <button onClick={close} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 p-4 bg-muted/20 border-b border-border">
              <div className="rounded-xl bg-card border border-border p-3 text-center">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Pegawai</p>
                <p className="text-lg font-bold text-foreground mt-0.5">{empIds.length}</p>
              </div>
              <div className="rounded-xl bg-card border border-border p-3 text-center">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Hari</p>
                <p className="text-lg font-bold text-foreground mt-0.5">{dates.length}</p>
              </div>
              <div className="rounded-xl bg-card border border-border p-3 text-center">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Berlaku</p>
                <p className="text-[11px] font-bold mt-1" style={{ color: holiday.berlaku_untuk === "semua" ? "#10b981" : "#f59e0b" }}>
                  {holiday.berlaku_untuk === "semua" ? "Semua" : "Pilihan"}
                </p>
              </div>
            </div>

            <div className="px-5 pt-4 pb-3 border-b border-border">
              <div className="flex items-center gap-2 bg-muted/40 rounded-xl px-3 py-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari pegawai..." value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="bg-transparent text-xs outline-none w-full text-foreground placeholder:text-muted-foreground/50" />
                {search && (
                  <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {affectedEmps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10">
                  <User className="w-8 h-8 text-muted-foreground/20 mb-2" />
                  <p className="text-xs text-muted-foreground">{search ? "Tidak ada pegawai cocok" : "Belum ada pegawai"}</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {pagedEmps.map((emp, idx) => {
                      const globalIdx = (safePage - 1) * HOLIDAY_DETAIL_PAGE_SIZE + idx + 1;
                      return (
                        <div key={emp.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-primary">{globalIdx}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{emp.nama}</p>
                            <p className="text-[10px] text-muted-foreground">{emp.id}</p>
                          </div>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 flex-shrink-0">
                            Libur
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {totalPages > 1 && (
                    <div className="mt-3">
                      <Pagination currentPage={safePage} totalItems={total} pageSize={HOLIDAY_DETAIL_PAGE_SIZE} onPageChange={setPage} />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20">
              <p className="text-[10px] text-muted-foreground">
                {affectedEmps.length === empIds.length
                  ? `Menampilkan ${empIds.length} pegawai`
                  : `${affectedEmps.length} dari ${empIds.length} pegawai`}
              </p>
              <Button variant="outline" size="sm" onClick={close}>Tutup</Button>
            </div>
          </div>
        </div>
      </Portal>
    );
  },
);
