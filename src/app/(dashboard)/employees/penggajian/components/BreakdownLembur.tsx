import { formatDate, formatRupiah } from "@/lib/payroll-v2/formatter";
import type { LemburDetail } from "@/lib/payroll-v2/types";

export default function BreakdownLembur({
  detail,
  total,
  compact = false,
}: {
  detail: LemburDetail[];
  total: number;
  compact?: boolean;
}) {
  if (detail.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">Tidak ada lembur di periode ini</p>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={`rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-900/10 overflow-hidden ${
          compact ? "max-h-40" : "max-h-56"
        } overflow-y-auto`}
      >
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-emerald-50 dark:bg-emerald-900/20 z-[1]">
            <tr className="border-b border-emerald-200/60 dark:border-emerald-800/40">
              <th className="px-3 py-2 text-left text-emerald-700 dark:text-emerald-300 font-semibold w-[58px]">
                Tgl
              </th>
              <th className="px-3 py-2 text-left text-emerald-700 dark:text-emerald-300 font-semibold">
                Durasi
              </th>
              <th className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-300 font-semibold">
                Rate
              </th>
              <th className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-300 font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.map((d, i) => (
              <tr
                key={`${d.tanggal}-${i}`}
                className="border-b last:border-0 border-emerald-200/30 dark:border-emerald-800/20 odd:bg-white/40 dark:odd:bg-emerald-950/20"
              >
                <td className="px-3 py-1.5 text-muted-foreground text-[11px]">
                  {formatDate(d.tanggal)}
                </td>
                <td className="px-3 py-1.5 text-foreground tabular-nums">
                  {d.jam.toFixed(1)} jam
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                  {formatRupiah(d.tarif)}
                </td>
                <td className="px-3 py-1.5 text-right font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {formatRupiah(d.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-emerald-100 dark:bg-emerald-900/40 border-t border-emerald-300/60">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-emerald-900 dark:text-emerald-200 font-bold text-xs">
                Total
              </td>
              <td className="px-3 py-2 text-right font-bold text-emerald-700 dark:text-emerald-200 tabular-nums text-xs">
                {formatRupiah(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
