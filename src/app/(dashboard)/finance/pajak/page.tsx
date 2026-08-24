"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ReceiptText, CalendarDays, FileDown, Calculator, TrendingUp, TrendingDown, PiggyBank, ChevronLeft, ChevronRight, Search, Building2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import RouteGuard from "@/components/RouteGuard";
import Pagination from "@/components/ui/Pagination";
import { supabase } from "@/lib/supabase";
import type { DbFinanceClient } from "@/lib/supabase";
import { downloadCsv } from "@/lib/finance";
import { computePpn11, formatRupiah, formatTanggal, monthLabelId, summarizeClientPpn, buildMonthlyPajak } from "@/lib/finance-tax";
import { cn } from "@/lib/utils";

type PpnTab = "ppn" | "tahunan";

interface InvoicePajak {
  id: number;
  invoice_no: string;
  invoice_date: string;
  subtotal: number;
  client: { company_name: string | null; contact_name: string } | null;
}

interface ExpensePajak {
  expense_date: string;
  amount: number;
}

const PAGE_SIZE = 20;

export default function FinancePajakPage() {
  const [tab, setTab] = useState<PpnTab>("ppn");
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoicePajak[]>([]);
  const [clients, setClients] = useState<DbFinanceClient[]>([]);
  const [expenses, setExpenses] = useState<ExpensePajak[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const currentYear = new Date().getFullYear();
  const [tahunPpn, setTahunPpn] = useState(currentYear);
  const [bulanPpn, setBulanPpn] = useState<string>("Semua");
  const [clientFilter, setClientFilter] = useState<string>("Semua");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [tahunTahunan, setTahunTahunan] = useState(currentYear);

  const showToast = useCallback((type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchPpn = useCallback(async (year: number) => {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const { data, error } = await supabase
      .from("finance_invoices")
      .select("id, invoice_no, invoice_date, subtotal, client:finance_clients(company_name, contact_name)")
      .gte("invoice_date", start)
      .lte("invoice_date", end)
      .order("invoice_date", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw error;
    setInvoices((data as unknown as InvoicePajak[]) || []);
  }, []);

  const fetchTahunan = useCallback(async (year: number) => {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const [{ data: invData, error: invErr }, { data: expData, error: expErr }] = await Promise.all([
      supabase.from("finance_invoices").select("invoice_date, subtotal").gte("invoice_date", start).lte("invoice_date", end),
      supabase.from("finance_expenses").select("expense_date, amount").gte("expense_date", start).lte("expense_date", end),
    ]);
    if (invErr) throw invErr;
    if (expErr) throw expErr;
    // Untuk tab tahunan kita butuh invoices juga untuk PPN akumulasi, tapi fetchPpn sudah punya invoices tahun itu; kita sync di sini agar konsisten
    // Jika tab ppn year != tahunan year, data invoices akan berbeda, jadi kita fetch terpisah dan set untuk tahunan
    // Namun untuk sederhana, kita simpan expenses dan biarkan invoices tetap sesuai tahunPpn bila tab ppn aktif; saat tab tahunan aktif kita override invoices dengan data tahunan
    // Solusi: simpan tahunanInvoices terpisah, tapi untuk MVP kita fetch ulang invoices tahunan sebagai invoices juga bila tab tahunan aktif
    // Kita akan handle di effect pemanggil
    setExpenses((expData as ExpensePajak[]) || []);
    return (invData as { invoice_date: string; subtotal: number }[]) || [];
  }, []);

  const fetchClients = useCallback(async () => {
    const { data } = await supabase.from("finance_clients").select("*").order("company_name");
    if (data) setClients(data as DbFinanceClient[]);
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([fetchPpn(tahunPpn), fetchClients(), fetchTahunan(tahunTahunan).then((invYearData) => {
          // Jika tahun ppn dan tahunan sama, tidak perlu override; jika beda, simpan untuk tahunan di state terpisah via effect tahunan
          // Untuk initial, tahun sama jadi invoices sudah benar
          void invYearData;
        })]);
        // Ambil expenses tahunan
        const start = `${tahunTahunan}-01-01`;
        const end = `${tahunTahunan}-12-31`;
        const { data: expData } = await supabase.from("finance_expenses").select("expense_date, amount").gte("expense_date", start).lte("expense_date", end);
        if (expData) setExpenses(expData as ExpensePajak[]);
      } catch {
        showToast("error", "Gagal memuat data pajak.");
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchPpn, fetchClients, fetchTahunan, showToast, tahunPpn, tahunTahunan]);

  // Refetch saat tahun ppn berubah
  useEffect(() => {
    if (tab !== "ppn") return;
    (async () => {
      setLoading(true);
      try {
        await fetchPpn(tahunPpn);
      } catch {
        showToast("error", "Gagal memuat data PPN.");
      } finally {
        setLoading(false);
      }
    })();
  }, [tahunPpn, tab, fetchPpn, showToast]);

  // Refetch saat tahun tahunan berubah
  useEffect(() => {
    if (tab !== "tahunan") return;
    (async () => {
      setLoading(true);
      try {
        const start = `${tahunTahunan}-01-01`;
        const end = `${tahunTahunan}-12-31`;
        const [{ data: invData }, { data: expData }] = await Promise.all([
          supabase.from("finance_invoices").select("id, invoice_no, invoice_date, subtotal, client:finance_clients(company_name, contact_name)").gte("invoice_date", start).lte("invoice_date", end).order("invoice_date", { ascending: false }),
          supabase.from("finance_expenses").select("expense_date, amount").gte("expense_date", start).lte("expense_date", end),
        ]);
        if (invData) setInvoices(invData as unknown as InvoicePajak[]);
        if (expData) setExpenses(expData as ExpensePajak[]);
      } catch {
        showToast("error", "Gagal memuat data tahunan.");
      } finally {
        setLoading(false);
      }
    })();
  }, [tahunTahunan, tab, showToast]);

  // Saat ganti tab, sinkronkan data sesuai tahun tab tersebut
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (tab === "ppn") {
          await fetchPpn(tahunPpn);
        } else {
          const start = `${tahunTahunan}-01-01`;
          const end = `${tahunTahunan}-12-31`;
          const [{ data: invData }, { data: expData }] = await Promise.all([
            supabase.from("finance_invoices").select("id, invoice_no, invoice_date, subtotal, client:finance_clients(company_name, contact_name)").gte("invoice_date", start).lte("invoice_date", end).order("invoice_date", { ascending: false }),
            supabase.from("finance_expenses").select("expense_date, amount").gte("expense_date", start).lte("expense_date", end),
          ]);
          if (invData) setInvoices(invData as unknown as InvoicePajak[]);
          if (expData) setExpenses(expData as ExpensePajak[]);
        }
      } catch {
        showToast("error", "Gagal memuat data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, fetchPpn, showToast, tahunPpn, tahunTahunan]);

  const clientLabel = useCallback((inv: InvoicePajak) => {
    const c = inv.client;
    if (!c) return "Tanpa Client";
    return c.company_name?.trim() ? c.company_name.trim() : c.contact_name;
  }, []);

  const filteredPpn = useMemo(() => {
    const q = search.toLowerCase().trim();
    return invoices.filter((inv) => {
      if (bulanPpn !== "Semua") {
        const m = String(Number(inv.invoice_date.slice(5, 7)));
        if (m !== bulanPpn && inv.invoice_date.slice(5, 7) !== bulanPpn.padStart(2, "0")) return false;
      }
      const label = clientLabel(inv);
      if (clientFilter !== "Semua" && label !== clientFilter) return false;
      if (q) {
        const hay = `${inv.invoice_no} ${label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, bulanPpn, clientFilter, search, clientLabel]);

  const ppnSummary = useMemo(() => {
    const totalTagihan = filteredPpn.reduce((s, i) => s + (i.subtotal || 0), 0);
    const totalPpn = filteredPpn.reduce((s, i) => s + computePpn11(i.subtotal), 0);
    const distinctClients = new Set(filteredPpn.map(clientLabel)).size;
    return { totalTagihan, totalPpn, invoiceCount: filteredPpn.length, clientCount: distinctClients };
  }, [filteredPpn, clientLabel]);

  const clientSummaries = useMemo(() => {
    const rows = filteredPpn.map((inv) => ({ clientLabel: clientLabel(inv), subtotal: inv.subtotal }));
    return summarizeClientPpn(rows);
  }, [filteredPpn, clientLabel]);

  const clientTotal = useMemo(() => {
    const totalTagihan = clientSummaries.reduce((s, c) => s + c.totalTagihan, 0);
    const totalPpn = clientSummaries.reduce((s, c) => s + c.totalPpn, 0);
    return { totalTagihan, totalPpn };
  }, [clientSummaries]);

  const tahunanData = useMemo(() => {
    // invoices sudah difilter tahun via fetch, jadi langsung pakai untuk tahunan
    const invForYear = invoices.map((i) => ({ invoice_date: i.invoice_date, subtotal: i.subtotal }));
    const monthly = buildMonthlyPajak(invForYear, expenses, tahunTahunan);
    const omzet = monthly.reduce((s, m) => s + m.omzet, 0);
    const pengeluaran = monthly.reduce((s, m) => s + m.pengeluaran, 0);
    const hasil = omzet - pengeluaran;
    const akumulasiPpn = computePpn11(omzet);
    const invoiceCount = monthly.reduce((s, m) => s + m.invoiceCount, 0);
    const expenseCount = monthly.reduce((s, m) => s + m.expenseCount, 0);
    return { monthly, omzet, pengeluaran, hasil, akumulasiPpn, invoiceCount, expenseCount };
  }, [invoices, expenses, tahunTahunan]);

  const pagedPpn = useMemo(() => filteredPpn.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredPpn, page]);

  const exportPpnDetail = () => {
    const rows: (string | number)[][] = [
      [`Daftar PPN 1,1% — Tahun ${tahunPpn}${bulanPpn !== "Semua" ? ` Bulan ${bulanPpn}` : ""}${clientFilter !== "Semua" ? ` — ${clientFilter}` : ""}`],
      [],
      ["Tanggal", "Nomor Invoice", "Client", "Nilai Tagihan", "Tarif", "Nilai PPN"],
      ...filteredPpn.map((inv) => [formatTanggal(inv.invoice_date), inv.invoice_no, clientLabel(inv), inv.subtotal, "1,1%", computePpn11(inv.subtotal)]),
      [],
      ["Total Tagihan", ppnSummary.totalTagihan],
      ["Total PPN 1,1%", ppnSummary.totalPpn],
      ["Jumlah Invoice", ppnSummary.invoiceCount],
    ];
    downloadCsv(`ppn-11-detail-${tahunPpn}${bulanPpn !== "Semua" ? `-${bulanPpn.padStart(2, "0")}` : ""}.csv`, rows);
  };

  const exportPpnPerClient = () => {
    const rows: (string | number)[][] = [
      [`Ringkasan PPN per Client — Tahun ${tahunPpn}${bulanPpn !== "Semua" ? ` Bulan ${bulanPpn}` : ""}`],
      [],
      ["Client", "Jumlah Invoice", "Total Tagihan", "Total PPN 1,1%"],
      ...clientSummaries.map((c) => [c.clientLabel, c.invoiceCount, c.totalTagihan, c.totalPpn]),
      [],
      ["TOTAL", clientSummaries.reduce((s, c) => s + c.invoiceCount, 0), clientTotal.totalTagihan, clientTotal.totalPpn],
    ];
    downloadCsv(`ppn-11-per-client-${tahunPpn}.csv`, rows);
  };

  const exportTahunan = () => {
    const rows: (string | number)[][] = [
      [`Pajak Tahunan — Tahun ${tahunTahunan}`],
      [],
      ["Omzet Kotor (subtotal)", tahunanData.omzet],
      ["Total Pengeluaran", tahunanData.pengeluaran],
      ["Hasil Bersih (Omzet - Pengeluaran)", tahunanData.hasil],
      ["Akumulasi PPN 1,1% (dari omzet)", tahunanData.akumulasiPpn],
      ["Jumlah Invoice", tahunanData.invoiceCount],
      ["Jumlah Transaksi Pengeluaran", tahunanData.expenseCount],
      [],
      ["Rincian Bulanan"],
      ["Bulan", "Invoice", "Omzet Kotor", "Transaksi Pengeluaran", "Pengeluaran", "Hasil Bersih"],
      ...tahunanData.monthly.map((m) => [monthLabelId(m.month - 1), m.invoiceCount, m.omzet, m.expenseCount, m.pengeluaran, m.hasil]),
      [],
      ["TOTAL TAHUN", tahunanData.invoiceCount, tahunanData.omzet, tahunanData.expenseCount, tahunanData.pengeluaran, tahunanData.hasil],
    ];
    downloadCsv(`pajak-tahunan-${tahunTahunan}.csv`, rows);
  };

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => String(y - 3 + i));
  }, []);

  const bulanOptions = ["Semua", ...Array.from({ length: 12 }, (_, i) => String(i + 1))];

  const clientOptions = useMemo(() => {
    const labels = [...new Set(invoices.map(clientLabel))].sort((a, b) => a.localeCompare(b, "id"));
    return ["Semua", ...labels];
  }, [invoices, clientLabel]);

  return (
    <RouteGuard permission="finance">
      <PageHeader title="Pajak" description="PPN 1,1% dari tagihan dan rekap pajak tahunan (omzet - pengeluaran)" icon={ReceiptText} />

      <div className="flex items-center gap-2 p-1 bg-muted rounded-xl w-fit mb-4">
        <button
          onClick={() => setTab("ppn")}
          className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all", tab === "ppn" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          PPN 1,1%
        </button>
        <button
          onClick={() => setTab("tahunan")}
          className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all", tab === "tahunan" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          Pajak Tahunan
        </button>
      </div>

      {tab === "ppn" ? (
        <>
          <div className="bg-card rounded-2xl border border-border p-3 space-y-3 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                <Select value={String(tahunPpn)} onChange={(v) => { setTahunPpn(Number(v)); setPage(1); }} options={yearOptions.map((y) => ({ value: y, label: y }))} className="w-28" />
                <Select value={bulanPpn} onChange={(v) => { setBulanPpn(v); setPage(1); }} options={bulanOptions.map((b) => ({ value: b, label: b === "Semua" ? "Semua Bulan" : monthLabelId(Number(b) - 1) }))} className="w-40" />
              </div>
              <Select value={clientFilter} onChange={(v) => { setClientFilter(v); setPage(1); }} options={clientOptions.map((c) => ({ value: c, label: c }))} className="w-48" />
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cari nomor invoice atau client..." className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 mb-4">
            <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
              <p className="text-xs font-semibold text-muted-foreground">Jumlah Invoice</p>
              <p className="text-2xl font-bold text-foreground mt-1">{ppnSummary.invoiceCount}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{ppnSummary.clientCount} client</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" /> Jumlah Client</p>
              <p className="text-2xl font-bold text-foreground mt-1">{ppnSummary.clientCount}</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
              <p className="text-xs font-semibold text-muted-foreground">Total Tagihan (subtotal)</p>
              <p className="text-xl font-bold text-foreground mt-1 tabular-nums">{formatRupiah(ppnSummary.totalTagihan)}</p>
            </div>
            <div className="bg-gradient-to-br from-teal-600 to-cyan-600 rounded-2xl p-4 shadow-sm text-white">
              <p className="text-xs font-semibold text-white/80 flex items-center gap-1"><Calculator className="w-3 h-3" /> Total PPN 1,1%</p>
              <p className="text-xl font-bold mt-1 tabular-nums">{formatRupiah(ppnSummary.totalPpn)}</p>
              <p className="text-[11px] text-white/80 mt-1">1,1% × subtotal</p>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-4">
            <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">Daftar Pajak per Invoice</h2>
                <p className="text-[11px] text-muted-foreground">Nilai PPN = pembulatan(subtotal × 1,1 / 100)</p>
              </div>
              <Button variant="outline" size="sm" icon={FileDown} onClick={exportPpnDetail}>Export CSV</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b border-border">
                  <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="px-3 py-3 text-left">Tanggal</th>
                    <th className="px-3 py-3 text-left">Nomor Invoice</th>
                    <th className="px-3 py-3 text-left">Client</th>
                    <th className="px-3 py-3 text-right">Nilai Tagihan</th>
                    <th className="px-3 py-3 text-center">Tarif</th>
                    <th className="px-3 py-3 text-right">Nilai PPN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Memuat...</td></tr>
                  ) : pagedPpn.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Tidak ada data.</td></tr>
                  ) : (
                    pagedPpn.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2.5 whitespace-nowrap">{formatTanggal(inv.invoice_date)}</td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-primary">{inv.invoice_no}</td>
                        <td className="px-3 py-2.5">{clientLabel(inv)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatRupiah(inv.subtotal)}</td>
                        <td className="px-3 py-2.5 text-center"><span className="px-2 py-1 rounded-full bg-muted text-foreground font-semibold">1,1%</span></td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{formatRupiah(computePpn11(inv.subtotal))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {pagedPpn.length > 0 && (
                  <tfoot className="bg-muted/30 border-t border-border font-bold">
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-right">Total Halaman</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatRupiah(pagedPpn.reduce((s, i) => s + i.subtotal, 0))}</td>
                      <td></td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatRupiah(pagedPpn.reduce((s, i) => s + computePpn11(i.subtotal), 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="px-4 py-3 bg-muted/20 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>{filteredPpn.length} invoice terfilter • Total {formatRupiah(ppnSummary.totalTagihan)} • PPN {formatRupiah(ppnSummary.totalPpn)}</span>
            </div>
          </div>
          {filteredPpn.length > PAGE_SIZE && <Pagination currentPage={page} totalItems={filteredPpn.length} pageSize={PAGE_SIZE} onPageChange={setPage} />}

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mt-6">
            <div className="p-4 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">Ringkasan per Client</h2>
                <p className="text-[11px] text-muted-foreground">Total nilai pajak dari beberapa client — urut terbesar</p>
              </div>
              <Button variant="outline" size="sm" icon={FileDown} onClick={exportPpnPerClient}>Export CSV</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b border-border">
                  <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="px-3 py-3 text-left">Client</th>
                    <th className="px-3 py-3 text-right">Jumlah Invoice</th>
                    <th className="px-3 py-3 text-right">Total Tagihan</th>
                    <th className="px-3 py-3 text-right">Total PPN 1,1%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {clientSummaries.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Tidak ada data.</td></tr>
                  ) : (
                    clientSummaries.map((c) => (
                      <tr key={c.clientLabel} className="hover:bg-muted/20">
                        <td className="px-3 py-2.5 font-medium text-foreground">{c.clientLabel}</td>
                        <td className="px-3 py-2.5 text-right">{c.invoiceCount}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatRupiah(c.totalTagihan)}</td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{formatRupiah(c.totalPpn)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-primary/5 border-t border-border font-bold">
                  <tr>
                    <td className="px-3 py-3">TOTAL</td>
                    <td className="px-3 py-3 text-right">{clientSummaries.reduce((s, c) => s + c.invoiceCount, 0)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatRupiah(clientTotal.totalTagihan)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatRupiah(clientTotal.totalPpn)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="px-4 py-3 bg-amber-100 dark:bg-amber-900/50 border-t border-amber-300 dark:border-amber-700 text-[11px] font-medium text-amber-950 dark:text-amber-50">
              Laporan internal — PPN dihitung 1,1% × subtotal tagihan, bukan pajak terutang resmi.
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setTahunTahunan((y) => y - 1)} className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground"><ChevronLeft className="w-4 h-4" /></button>
              <span className="px-4 py-2 rounded-xl border border-border text-sm font-bold text-foreground min-w-[110px] text-center">Tahun {tahunTahunan}</span>
              <button onClick={() => setTahunTahunan((y) => y + 1)} className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
              <button onClick={() => setTahunTahunan(new Date().getFullYear())} className="px-3 py-2 rounded-xl text-xs font-semibold text-primary hover:bg-primary/5">Tahun ini</button>
            </div>
            <Button variant="outline" size="sm" icon={FileDown} onClick={exportTahunan}>Export CSV</Button>
          </div>

          <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 mb-4">
            <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
              <p className="text-xs font-semibold text-muted-foreground">Omzet Kotor</p>
              <p className="text-xl font-bold text-foreground mt-1 tabular-nums">{formatRupiah(tahunanData.omzet)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{tahunanData.invoiceCount} invoice • subtotal</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
              <p className="text-xs font-semibold text-muted-foreground">Total Pengeluaran</p>
              <p className="text-xl font-bold text-danger mt-1 tabular-nums">{formatRupiah(tahunanData.pengeluaran)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{tahunanData.expenseCount} transaksi</p>
            </div>
            <div className={cn("rounded-2xl border p-4 shadow-sm", tahunanData.hasil >= 0 ? "bg-success/5 border-success/20" : "bg-danger/5 border-danger/20")}>
              <p className="text-xs font-semibold text-muted-foreground">Hasil Bersih</p>
              <p className={cn("text-xl font-bold mt-1 tabular-nums", tahunanData.hasil >= 0 ? "text-success" : "text-danger")}>{formatRupiah(tahunanData.hasil)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Omzet − Pengeluaran</p>
            </div>
            <div className="bg-gradient-to-br from-teal-600 to-cyan-600 rounded-2xl p-4 shadow-sm text-white">
              <p className="text-xs font-semibold text-white/80">Akumulasi PPN 1,1%</p>
              <p className="text-xl font-bold mt-1 tabular-nums">{formatRupiah(tahunanData.akumulasiPpn)}</p>
              <p className="text-[11px] text-white/80 mt-1">dari omzet kotor</p>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Rincian Bulanan {tahunTahunan}</h2>
              <p className="text-[11px] text-muted-foreground">Omzet dan pengeluaran per bulan — dasar pajak tahunan sesuai arahan</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b border-border">
                  <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="px-3 py-3 text-left">Bulan</th>
                    <th className="px-3 py-3 text-right">Invoice</th>
                    <th className="px-3 py-3 text-right">Omzet Kotor</th>
                    <th className="px-3 py-3 text-right">Transaksi Pengeluaran</th>
                    <th className="px-3 py-3 text-right">Pengeluaran</th>
                    <th className="px-3 py-3 text-right">Hasil Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {tahunanData.monthly.map((m) => (
                    <tr key={m.month} className="hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-medium text-foreground">{monthLabelId(m.month - 1)}</td>
                      <td className="px-3 py-2.5 text-right">{m.invoiceCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatRupiah(m.omzet)}</td>
                      <td className="px-3 py-2.5 text-right">{m.expenseCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-danger">{formatRupiah(m.pengeluaran)}</td>
                      <td className={cn("px-3 py-2.5 text-right font-bold tabular-nums", m.hasil >= 0 ? "text-success" : "text-danger")}>{formatRupiah(m.hasil)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 border-t border-border font-bold">
                  <tr>
                    <td className="px-3 py-3">TOTAL {tahunTahunan}</td>
                    <td className="px-3 py-3 text-right">{tahunanData.invoiceCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatRupiah(tahunanData.omzet)}</td>
                    <td className="px-3 py-3 text-right">{tahunanData.expenseCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatRupiah(tahunanData.pengeluaran)}</td>
                    <td className={cn("px-3 py-3 text-right tabular-nums", tahunanData.hasil >= 0 ? "text-success" : "text-danger")}>{formatRupiah(tahunanData.hasil)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="px-4 py-3 bg-amber-100 dark:bg-amber-900/50 border-t border-amber-300 dark:border-amber-700 text-[11px] font-medium text-amber-950 dark:text-amber-50">
              Laporan internal — Omzet kotor diambil dari subtotal tagihan (bukan total termasuk PPN) sesuai kesepakatan.
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white bg-danger">{toast.msg}</div>
      )}
    </RouteGuard>
  );
}
