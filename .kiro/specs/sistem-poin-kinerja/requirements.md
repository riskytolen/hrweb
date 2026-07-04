# Requirements Document

## Introduction

Sistem penilaian kinerja saat ini memakai skor 0–100 yang di-clip pada nilai maksimum, sehingga pegawai berkinerja sempurna tidak terbedakan dari yang punya pelanggaran ringan, dan tie-breaker memenangkan pegawai dengan lebih banyak hari kerja absolut.

Fitur ini merombak penilaian menjadi **sistem poin** yang menjadikan **ketepatan/kecepatan absen** sebagai penentu utama. Prinsip dasar:

- **Jumlah hari kerja TIDAK dinilai.** Jadwal kerja diatur koordinator masing-masing dan di luar kendali pegawai, jadi banyak/sedikitnya hari kerja tidak boleh memengaruhi poin.
- **Penentu utama = seberapa awal pegawai absen dari batas jam masuk hari itu.** Karena setiap divisi punya jam masuk berbeda (data nyata: dari 04:30 di Cp Suka sampai 20:30 di Rrt) dan pegawai bisa berpindah divisi setiap hari, ukuran yang adil adalah **selisih menit terhadap deadline divisi pada hari tersebut**, bukan jam absolut. Ini otomatis adil lintas divisi.
- **Pegawai bersaing pada kecepatan absen.** Setiap hari ada yang tercepat, dan posisi bisa berganti tiap hari. Penilaian periode mengakumulasi performa ini menjadi satu angka poin.
- **Penalti tetap dipertahankan** seperti sistem lama (telat, alpha, input manual, SP). Alpha tetap menjadi pengurangan yang berat.

Metode kalkulasi yang dipilih: **rata-rata earliness harian (dengan batas/cap per hari) dikali faktor skala, dikurangi total penalti.** Angka poin berada di kisaran ratusan agar peringkat selalu jelas (misal 340 vs 339).

Tujuan: penilaian yang **adil** (netral terhadap jumlah hari kerja, adil lintas divisi) dan **dapat dipertanggungjawabkan** (setiap poin dapat ditelusuri ke data absensi sumbernya).

## Glossary

- **Earliness harian**: selisih menit antara batas masuk dan waktu absen aktual pada satu hari. Rumus: `(jam_masuk_jadwal + toleransi_menit) − jam_absen_aktual`. Positif = absen lebih awal dari batas (baik); negatif = melewati batas (telat).
- **Earliness ter-cap**: earliness harian yang dibatasi pada nilai maksimum tertentu per hari (cap) agar datang ekstrem awal tidak membuat rata-rata melonjak tidak wajar.
- **Hari valid (untuk earliness)**: hari dengan status Hadir, bukan input manual, dan punya jam absen serta jadwal yang valid (bukan 00:00). Hari inilah yang dipakai menghitung rata-rata earliness.
- **Poin earliness**: rata-rata earliness ter-cap selama periode dikali faktor skala. Ini adalah poin dasar (positif).
- **Penalti**: pengurangan poin akibat pelanggaran (telat, alpha, input manual, SP). Nilai tetap sama dengan sistem lama.
- **Poin akhir**: poin earliness dikurangi total penalti; dipakai untuk peringkat.
- **Periode penilaian**: tanggal 8 bulan berjalan sampai 7 bulan berikutnya (konsisten dengan sistem absensi).
- **Eligible**: pegawai yang sudah aktif/bergabung minimal 3 bulan terhadap akhir periode. Pegawai yang belum 3 bulan tidak diikutsertakan dalam peringkat. Seluruh pegawai eligible lainnya wajib diperhitungkan.

## Requirements

### Requirement 1: Earliness sebagai penentu utama poin

**User Story:** Sebagai HR, saya ingin poin pegawai ditentukan oleh seberapa cepat mereka absen dari batas jam masuk yang ditetapkan, agar penilaian adil bagi semua divisi dan pegawai yang berpindah divisi.

#### Acceptance Criteria

1. WHEN sistem menghitung earliness sebuah hari valid THEN sistem SHALL menghitung `(jam_masuk_jadwal + toleransi_menit) − jam_absen_aktual` dalam satuan menit.
2. WHEN seorang pegawai berpindah divisi antar hari THEN sistem SHALL menggunakan jadwal (jam masuk dan toleransi) milik divisi pada record absensi hari tersebut, bukan satu divisi tetap.
3. WHEN earliness harian dihitung THEN sistem SHALL membatasi nilainya pada cap maksimum per hari yang dapat dikonfigurasi, sehingga absen yang sangat awal tidak menggeser rata-rata secara tidak wajar.
4. WHERE sebuah record absensi adalah input manual THE sistem SHALL mengeluarkannya dari perhitungan earliness (record manual tidak punya jam absen riil yang dapat dibandingkan).
5. WHERE sebuah hari berstatus Terlambat THE sistem SHALL mengeluarkannya dari perhitungan rata-rata earliness dan cukup menerapkan penalti telat saja.

### Requirement 2: Jumlah hari kerja tidak memengaruhi poin

**User Story:** Sebagai HR, saya ingin pegawai dengan jumlah hari kerja berbeda dinilai setara, agar pegawai tidak diuntungkan atau dirugikan oleh jadwal yang diatur koordinator.

#### Acceptance Criteria

1. WHEN poin earliness dihitung THEN sistem SHALL menggunakan rata-rata earliness ter-cap, BUKAN jumlah/akumulasi earliness, sehingga jumlah hari kerja absolut tidak menambah poin.
2. WHEN dua pegawai memiliki rata-rata earliness sama tetapi jumlah hari kerja berbeda THEN sistem SHALL memberi poin earliness yang sama kepada keduanya.
3. WHEN seorang pegawai berstatus Libur, Cuti, Izin, atau Sakit pada suatu hari THEN sistem SHALL memperlakukan hari tersebut sebagai netral (tidak menambah, tidak mengurangi, dan tidak masuk hitungan rata-rata earliness).
4. WHEN sistem menentukan peringkat THEN sistem SHALL TIDAK menggunakan jumlah hari hadir absolut sebagai komponen poin maupun sebagai tie-breaker utama.

### Requirement 3: Sistem penalti yang dipertahankan

**User Story:** Sebagai HR, saya ingin aturan pengurangan poin tetap sama seperti sistem sebelumnya, agar kebijakan disiplin konsisten dan Alpha tetap berdampak besar.

#### Acceptance Criteria

1. WHEN seorang pegawai memiliki kejadian Terlambat THEN sistem SHALL mengurangi 3 poin per kejadian.
2. WHEN seorang pegawai memiliki kejadian Alpha THEN sistem SHALL mengurangi 5 poin per kejadian.
3. WHEN sebuah record absensi diinput manual oleh admin — untuk status apa pun termasuk Hadir, Terlambat, Izin, Sakit, dan Cuti — THEN sistem SHALL mengurangi 1 poin per record manual tersebut.
4. WHEN seorang pegawai memiliki Surat Peringatan aktif pada periode THEN sistem SHALL mengurangi 10 poin untuk SP-1, 20 poin untuk SP-2, dan 30 poin untuk SP-3.
5. WHEN total penalti dihitung THEN penalti SHALL dijumlahkan dari seluruh komponen di atas dan dikurangkan dari poin earliness untuk menghasilkan poin akhir.

### Requirement 4: Skala poin dan poin akhir

**User Story:** Sebagai HR, saya ingin angka poin berada di kisaran ratusan dengan peringkat yang selalu jelas, agar mudah dibaca dan dibandingkan (misal 340 vs 339).

#### Acceptance Criteria

1. WHEN poin earliness dihitung THEN sistem SHALL mengalikan rata-rata earliness ter-cap dengan faktor skala yang dapat dikonfigurasi sehingga poin earliness berada pada kisaran ratusan.
2. WHEN poin akhir dihitung THEN poin akhir SHALL = poin earliness − total penalti.
3. WHEN poin akhir dua pegawai berbeda meski hanya selisih 1 THEN sistem SHALL menampilkan dan memeringkat keduanya secara berbeda (tidak ada pembatasan/clip pada nilai maksimum).
4. WHERE total penalti melebihi poin earliness THE sistem SHALL menampilkan poin akhir apa adanya termasuk nilai negatif — kecuali ditetapkan batas minimum 0 (keputusan ini WAJIB dikonfirmasi pada fase design).

### Requirement 5: Eligibilitas pegawai

**User Story:** Sebagai HR, saya ingin hanya pegawai yang sudah cukup lama bergabung yang masuk peringkat, agar penilaian representatif.

#### Acceptance Criteria

1. WHEN seorang pegawai belum aktif/bergabung minimal 3 bulan terhadap akhir periode THEN sistem SHALL menandainya tidak eligible dan tidak menyertakannya dalam peringkat "terbaik".
2. WHEN seorang pegawai sudah aktif minimal 3 bulan THEN sistem SHALL menyertakannya dalam perhitungan poin dan peringkat tanpa syarat jumlah hari minimum tambahan.
3. WHEN seorang pegawai eligible tetapi tidak memiliki satu pun hari valid untuk earliness pada periode THEN sistem SHALL menetapkan poin earliness-nya 0 dan tetap menerapkan penalti yang berlaku.
4. WHEN pegawai tidak eligible ditampilkan di daftar THEN sistem SHALL menempatkannya di bawah semua pegawai eligible.

### Requirement 6: Peringkat dan tie-breaker deterministik

**User Story:** Sebagai HR, saya ingin urutan peringkat selalu jelas dan tidak ambigu, agar penetapan "pegawai terbaik" dapat dipertanggungjawabkan.

#### Acceptance Criteria

1. WHEN poin akhir dua pegawai berbeda THEN sistem SHALL mengurutkan poin akhir lebih tinggi sebagai lebih baik.
2. WHEN poin akhir dua pegawai sama THEN sistem SHALL menerapkan urutan tie-breaker deterministik dan terdokumentasi (usulan: rata-rata earliness lebih tinggi → jumlah penalti lebih sedikit → nama), tanpa memakai jumlah hari kerja.
3. WHEN daftar peringkat dirender ulang dengan data yang sama THEN urutannya SHALL identik (stabil) setiap kali.
4. WHEN sistem menampilkan peringkat THEN sistem SHALL dapat menampilkan baik mode "terbaik" maupun "terendah" secara konsisten dengan aturan urutan yang sama.

### Requirement 7: Transparansi dan keterlacakan data (auditability)

**User Story:** Sebagai auditor/manajemen, saya ingin dapat memverifikasi poin setiap pegawai terhadap data absensi mentah, agar penilaian dapat dipertanggungjawabkan.

#### Acceptance Criteria

1. WHEN poin seorang pegawai ditampilkan THEN sistem SHALL menyertakan rincian: rata-rata earliness, jumlah hari valid, poin earliness, dan total penalti beserta jumlah tiap jenis (telat, alpha, manual, SP).
2. WHEN poin akhir dijumlahkan THEN poin akhir SHALL persis sama dengan poin earliness − total penalti tanpa langkah tersembunyi.
3. WHEN periode penilaian ditentukan THEN rentang tanggal query SHALL sama persis dengan label periode yang ditampilkan (tanpa pergeseran timezone).
4. WHEN laporan kinerja diekspor THEN laporan SHALL mencantumkan rumus poin, nilai cap, faktor skala, tarif penalti, dan rincian per pegawai.
5. WHERE tarif penalti berbeda antar divisi THE sistem SHALL menggunakan tarif penalti milik divisi pegawai yang relevan.

### Requirement 8: Kompatibilitas dengan tampilan yang ada

**User Story:** Sebagai pengguna sistem, saya ingin halaman Kinerja dan Dashboard tetap berfungsi dengan sistem poin baru, agar tidak ada fitur yang rusak.

#### Acceptance Criteria

1. WHEN sistem poin diterapkan THEN halaman Kinerja (`/employees/performance`) SHALL menampilkan poin akhir, peringkat, dan rincian menggantikan skor 0–100.
2. WHEN sistem poin diterapkan THEN Dashboard (card Pegawai Terbaik) SHALL memakai sumber perhitungan yang sama (single source of truth di `lib/performance`).
3. WHERE sistem lama menampilkan grade A–E THE sistem SHALL memutuskan apakah grade dipertahankan, dipetakan ulang dari poin, atau dihapus (keputusan ini WAJIB dikonfirmasi pada fase design).
4. WHEN fitur filter, pencarian, sortir terbaik/terendah, dan pagination dipakai THEN semuanya SHALL tetap berfungsi terhadap nilai poin baru.

## Catatan & Keputusan yang Masih Terbuka (untuk fase Design)

1. **Nilai cap earliness harian** (mis. +60 menit) dan **faktor skala** (mis. ×3 agar rata-rata ~113 mnt → ~339 poin) — angka pasti ditentukan di design.
2. **Poin akhir negatif** — boleh negatif atau dibatasi minimal 0?
3. **Grade A–E** — dipertahankan, dipetakan ulang dari poin, atau dihapus?
4. **Risiko data tipis** — karena tidak ada syarat jumlah hari minimum (selain eligible 3 bulan), pegawai eligible dengan sangat sedikit hari valid tetapi rata-rata earliness tinggi bisa berperingkat tinggi. Cap per hari mengurangi risiko ini; perlu dikonfirmasi apakah ini dapat diterima atau perlu penyesuaian.
