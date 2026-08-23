-- Membuat beberapa aset per unit dalam satu transaksi.
CREATE OR REPLACE FUNCTION public.create_ga_assets_batch(
  p_category_id bigint,
  p_nama_aset text,
  p_jumlah integer,
  p_merek text,
  p_model text,
  p_serial_number text,
  p_spesifikasi text,
  p_tanggal_beli date,
  p_harga_beli numeric,
  p_kondisi text,
  p_status text,
  p_lokasi_id bigint,
  p_catatan text
) RETURNS TABLE(asset_id bigint, kode_aset text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_sequence integer;
  v_index integer;
  v_code text;
  v_asset_id bigint;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak valid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = v_user_id
      AND up.status = 'Aktif'
      AND r.status = 'Aktif'
      AND (
        r.permissions ? 'all'
        OR r.permissions ? 'inventory-aset'
        OR r.permissions ? 'inventory-aset.input'
      )
  ) THEN
    RAISE EXCEPTION 'Tidak memiliki izin input inventory-aset';
  END IF;

  IF p_jumlah IS NULL OR p_jumlah < 1 OR p_jumlah > 100 THEN
    RAISE EXCEPTION 'Jumlah item harus antara 1 dan 100';
  END IF;
  IF p_nama_aset IS NULL OR char_length(btrim(p_nama_aset)) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'Nama aset harus terdiri dari 2-200 karakter';
  END IF;
  IF p_kondisi IS NULL OR p_kondisi NOT IN ('Baik', 'Rusak Ringan', 'Rusak Berat') THEN
    RAISE EXCEPTION 'Kondisi aset tidak valid';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('Aktif', 'Rusak', 'Tidak Aktif') THEN
    RAISE EXCEPTION 'Status aset tidak valid';
  END IF;
  IF p_harga_beli IS NOT NULL AND (p_harga_beli < 0 OR p_harga_beli > 999999999999.99) THEN
    RAISE EXCEPTION 'Harga beli tidak valid';
  END IF;
  IF p_tanggal_beli IS NOT NULL AND p_tanggal_beli > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'Tanggal beli tidak boleh di masa depan';
  END IF;
  IF p_lokasi_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.ga_asset_locations
    WHERE id = p_lokasi_id AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'Lokasi aset tidak valid';
  END IF;

  SELECT category.kode_prefix, category.next_sequence
  INTO v_prefix, v_sequence
  FROM public.ga_asset_categories category
  WHERE category.id = p_category_id AND category.status = 'Aktif'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kategori aset tidak valid';
  END IF;

  v_sequence := greatest(coalesce(v_sequence, 1), 1);

  FOR v_index IN 0..(p_jumlah - 1) LOOP
    v_code := v_prefix || '-' || lpad((v_sequence + v_index)::text, 4, '0');

    INSERT INTO public.ga_assets (
      kode_aset,
      nama_aset,
      category_id,
      merek,
      model,
      serial_number,
      spesifikasi,
      tanggal_beli,
      harga_beli,
      kondisi,
      status,
      lokasi_id,
      catatan,
      created_by,
      updated_by
    ) VALUES (
      v_code,
      btrim(p_nama_aset),
      p_category_id,
      NULLIF(btrim(p_merek), ''),
      NULLIF(btrim(p_model), ''),
      CASE WHEN p_jumlah = 1 THEN NULLIF(btrim(p_serial_number), '') ELSE NULL END,
      NULLIF(btrim(p_spesifikasi), ''),
      p_tanggal_beli,
      p_harga_beli,
      p_kondisi,
      p_status,
      p_lokasi_id,
      NULLIF(btrim(p_catatan), ''),
      v_user_id,
      v_user_id
    )
    RETURNING id INTO v_asset_id;

    asset_id := v_asset_id;
    kode_aset := v_code;
    RETURN NEXT;
  END LOOP;

  UPDATE public.ga_asset_categories
  SET next_sequence = v_sequence + p_jumlah,
      updated_by = v_user_id,
      updated_at = now()
  WHERE id = p_category_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_ga_assets_batch(
  bigint, text, integer, text, text, text, text, date, numeric, text, text, bigint, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_ga_assets_batch(
  bigint, text, integer, text, text, text, text, date, numeric, text, text, bigint, text
) TO authenticated;

COMMENT ON FUNCTION public.create_ga_assets_batch(
  bigint, text, integer, text, text, text, text, date, numeric, text, text, bigint, text
) IS 'Membuat 1-100 aset individual dengan kode unik dalam satu transaksi';
