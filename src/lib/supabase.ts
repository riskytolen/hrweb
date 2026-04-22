import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Database Types ───

export interface DbBank {
  id: number;
  nama: string;
  kode: string | null;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbLevel {
  id: number;
  nama: string;
  urutan: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbJabatan {
  id: number;
  nama: string;
  deskripsi: string | null;
  level_id: number | null;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
  // joined
  levels?: DbLevel;
}

export interface DbPegawai {
  id: string;
  nama: string;
  jenis_kelamin: "Laki-laki" | "Perempuan";
  agama: "Islam" | "Kristen" | "Katolik" | "Hindu" | "Buddha" | "Konghucu";
  status: "Aktif" | "Tidak Aktif" | "Cuti";
  no_ktp: string;
  tempat_lahir: string;
  tanggal_lahir: string;
  alamat_ktp: string;
  alamat_domisili: string;
  no_telp: string;
  tanggal_bergabung: string;
  jabatan_id: number | null;
  status_pernikahan: "Belum Menikah" | "Menikah" | "Cerai";
  nama_pasangan: string | null;
  jumlah_anak: number;
  foto_ktp: string | null;
  foto_diri: string | null;
  no_bpjs_kesehatan: string | null;
  no_bpjs_ketenagakerjaan: string | null;
  foto_sim: string | null;
  no_rekening: string;
  bank: string;
  nama_rekening: string;
  kartu_keluarga: string | null;
  tanggal_mulai_pkwt: string | null;
  tanggal_berakhir_pkwt: string | null;
  created_at: string;
  updated_at: string;
  // joined
  jabatan?: DbJabatan;
}
