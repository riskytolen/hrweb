import { formatCurrency } from "@/lib/utils";

const formatRupiah = formatCurrency;

export interface AbsenItem {
  tanggal: string;
  status: string;
  nominal: number;
  menitTelat?: number;
}

export default function BreakdownAbsen({
  detail,
  total,
  compact = false,
}: {
  detail: AbsenItem[];
  total: number;
  compact?: boolean;
}) {
  if (detail.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">Tidak ada potongan absen</p>
    );
  }

  return (
    <div
      className={`rounded-xl border border-rose-200/60 dark:border-rose-800/40 bg-rose-50/40 dark:bg-rose-900/10 overflow-hidden ${
        compact ? "max-h-40" : "max-h-56"
      } overflow-y-auto`}
    >
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-rose-50 dark:bg-rose-900/20 z-[1]">
          <tr className="border-b border-rose-200/60 dark:border-rose-800/40">
            <th className="px-3 py-2 text-left text-rose-700 dark:text-rose-300 font-semibold w-[58px]">
              Tgl
            </th>
            <th className="px-3 py-2 text-left text-rose-700 dark:text-rose-300 font-semibold">
              Status
            </th>
            <th className="px-3 py-2 text-right text-rose-700 dark:text-rose-300 font-semibold">
              Nominal
            </th>
          </tr>
        </thead>
        <tbody>
          {detail.map((d, i) => (
            <tr
              key={`${d.tanggal}-${i}`}
              className="border-b last:border-0 border-rose-200/30 dark:border-rose-800/20 odd:bg-white/40 dark:odd:bg-rose-950/20"
            >
              <td className="px-3 py-1.5 text-muted-foreground font-mono text-[11px]">
                {d.tanggal.slice(8, 10)}
              </td>
              <td className="px-3 py-1.5 text-foreground truncate">
                {d.status}
                {d.menitTelat != null && d.menitTelat > 0 && (
                  <span className="text-muted-foreground ml-1">· {d.menitTelat}m</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold text-rose-700 dark:text-rose-300 tabular-nums">
                {formatRupiah(d.nominal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 bg-rose-100 dark:bg-rose-900/40 border-t border-rose-300/60">
          <tr>
            <td colSpan={2} className="px-3 py-2 text-rose-900 dark:text-rose-200 font-bold text-xs">
              Total
            </td>
            <td className="px-3 py-2 text-right font-bold text-rose-700 dark:text-rose-200 tabular-nums text-xs">
              {formatRupiah(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
