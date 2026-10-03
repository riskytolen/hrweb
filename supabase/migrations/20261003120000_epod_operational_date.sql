-- e-POD: tanggal operasional FO untuk Monitoring (tanggal saja, zona WIB).
--
-- `snapshot_at` adalah waktu FO masuk pool sinkronisasi, bukan tanggal
-- operasional. Kolom baru `operational_date` menyimpan tanggal layanan
-- occurrence Live Track dalam zona Asia/Jakarta, dengan fallback tanggal
-- snapshot/created. Monitoring, filter, dan urutan memakai kolom ini agar
-- FO beda hari tampil sesuai tanggal operasionalnya.

alter table public.tms_epod_assignments
  add column if not exists operational_date date;

create index if not exists tms_epod_assignments_operational_idx
  on public.tms_epod_assignments (operational_date desc, snapshot_at desc);

-- Backfill dari occurrence Live Track terbaru per task.
with latest_occurrence as (
  select distinct on (task_id) task_id, window_started_at
  from public.tms_live_track_task_occurrences
  order by task_id, window_started_at desc nulls last
)
update public.tms_epod_assignments a
set operational_date = coalesce(
  ((lo.window_started_at at time zone 'Asia/Jakarta')::date),
  ((a.snapshot_at at time zone 'Asia/Jakarta')::date),
  ((a.created_at at time zone 'Asia/Jakarta')::date)
)
from latest_occurrence lo
where lo.task_id = a.task_id
  and a.operational_date is null;

-- Sisa tanpa occurrence (mis. unit Portable): pakai snapshot/created.
update public.tms_epod_assignments
set operational_date = coalesce(
  ((snapshot_at at time zone 'Asia/Jakarta')::date),
  ((created_at at time zone 'Asia/Jakarta')::date)
)
where operational_date is null;

notify pgrst, 'reload schema';
