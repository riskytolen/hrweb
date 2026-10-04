-- RPC katalog Live Track: gantikan N+1 upsert + 1 select + M update
-- menjadi satu panggilan RPC dengan failure isolation per kendaraan.
--
-- Invarian yang dipertahankan dari perilaku serial lama:
-- - Conflict tetap pada mceasy_vehicle_id; UUID, client_id, first_seen_at,
--   dan created_at tidak pernah ditimpa.
-- - Stale marking tidak mengubah last_seen_at, updated_at, client_id.
-- - Respons vendor kosong/malformed TIDAK dianggap otoritatif: tidak ada
--   row yang ditandai stale (perlindungan fleet-wide stale).
-- - Stale marking bersyarat last_synced_at <= p_synced_at agar run lama
--   tidak menimpa hasil run yang lebih baru saat terjadi overlap.
-- - Upsert bersyarat serupa agar timestamp tidak mundur.
-- - Satu row invalid hanya menggagalkan row tersebut (nested exception),
--   bukan seluruh batch.

create or replace function public.tms_live_track_apply_catalog(
  p_vehicles jsonb,
  p_synced_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_vehicle_id bigint;
  v_plate text;
  v_plate_key text;
  v_groups jsonb;
  v_seen bigint[] := '{}';
  v_upserted integer := 0;
  v_stale integer := 0;
  v_failures jsonb := '[]'::jsonb;
begin
  if p_vehicles is null or jsonb_typeof(p_vehicles) <> 'array' then
    raise exception 'vehicles must be a json array';
  end if;
  if p_synced_at is null then
    raise exception 'synced_at is required';
  end if;

  if jsonb_array_length(p_vehicles) = 0 then
    return jsonb_build_object(
      'upserted', 0,
      'stale_marked', 0,
      'failures', jsonb_build_array(
        jsonb_build_object(
          'vehicle_id', null,
          'error', 'Respons katalog kosong tidak dianggap otoritatif; stale marking dilewati.'
        )
      )
    );
  end if;

  for v_row in select * from jsonb_array_elements(p_vehicles)
  loop
    begin
      if nullif(btrim(coalesce(v_row ->> 'mceasy_vehicle_id', '')), '') is null then
        raise exception 'mceasy_vehicle_id wajib diisi';
      end if;
      v_vehicle_id := (v_row ->> 'mceasy_vehicle_id')::bigint;

      v_plate := nullif(btrim(coalesce(v_row ->> 'license_plate', '')), '');
      if v_plate is null then
        raise exception 'license_plate wajib diisi';
      end if;

      v_plate_key := nullif(btrim(coalesce(v_row ->> 'license_plate_key', '')), '');
      if v_plate_key is null then
        raise exception 'license_plate_key wajib diisi';
      end if;

      v_groups := coalesce(v_row -> 'vendor_groups', '[]'::jsonb);
      if jsonb_typeof(v_groups) <> 'array' then
        raise exception 'vendor_groups harus array';
      end if;

      insert into public.tms_live_track_vehicles (
        mceasy_vehicle_id, license_plate, license_plate_key, vendor_groups,
        last_seen_at, last_synced_at, status, updated_at
      ) values (
        v_vehicle_id, v_plate, v_plate_key, v_groups,
        p_synced_at, p_synced_at, 'active', p_synced_at
      )
      on conflict (mceasy_vehicle_id) do update set
        license_plate = excluded.license_plate,
        license_plate_key = excluded.license_plate_key,
        vendor_groups = excluded.vendor_groups,
        last_seen_at = excluded.last_seen_at,
        last_synced_at = excluded.last_synced_at,
        status = 'active',
        updated_at = excluded.updated_at
      where excluded.last_synced_at >= public.tms_live_track_vehicles.last_synced_at;

      v_seen := v_seen || v_vehicle_id;
      v_upserted := v_upserted + 1;
    exception when others then
      v_failures := v_failures || jsonb_build_object(
        'vehicle_id', v_row ->> 'mceasy_vehicle_id',
        'error', SQLERRM
      );
    end;
  end loop;

  if coalesce(array_length(v_seen, 1), 0) = 0 then
    v_failures := v_failures || jsonb_build_object(
      'vehicle_id', null,
      'error', 'Tidak ada row valid; stale marking dilewati.'
    );
  else
    update public.tms_live_track_vehicles
    set status = 'stale',
        last_synced_at = p_synced_at
    where not (mceasy_vehicle_id = any (v_seen))
      and last_synced_at <= p_synced_at;

    get diagnostics v_stale = row_count;
  end if;

  return jsonb_build_object(
    'upserted', v_upserted,
    'stale_marked', v_stale,
    'failures', v_failures
  );
end;
$$;

revoke all on function public.tms_live_track_apply_catalog(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.tms_live_track_apply_catalog(jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
