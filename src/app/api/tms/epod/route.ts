import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { countAssignmentsByStatus, listAssignments } from "@/lib/tms-epod-data";
import { EPOD_ASSIGNMENT_STATUS_LABEL, type EpodAssignmentStatus } from "@/lib/tms-epod";

export const dynamic = "force-dynamic";

const VALID_STATUSES = Object.keys(EPOD_ASSIGNMENT_STATUS_LABEL) as EpodAssignmentStatus[];

function parseDate(value: string | null): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

export async function GET(request: Request) {
  const auth = await authorizeEpod(false);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && VALID_STATUSES.includes(statusParam as EpodAssignmentStatus) ? statusParam : undefined;

  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page") ?? "1")) || 1);
  const limitRaw = Math.trunc(Number(url.searchParams.get("limit") ?? "20")) || 20;
  const limit = Math.min(Math.max(limitRaw, 1), 100);

  try {
    const [result, counts] = await Promise.all([
      listAssignments({
        search: url.searchParams.get("search")?.trim() || undefined,
        status,
        dateFrom: parseDate(url.searchParams.get("dateFrom")),
        dateTo: parseDate(url.searchParams.get("dateTo")),
        page,
        limit,
      }),
      countAssignmentsByStatus(),
    ]);

    return epodJson({
      data: result.items,
      meta: {
        total: result.total,
        page,
        limit,
        counts,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat data e-POD.";
    return epodError(message, 502);
  }
}
