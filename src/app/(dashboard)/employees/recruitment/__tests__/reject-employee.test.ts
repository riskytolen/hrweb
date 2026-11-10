import { describe, expect, it, vi } from "vitest";
import { deactivateRejectedEmployee } from "../reject-employee";

function mockDb(error: { message: string } | null = null) {
  const single = vi.fn().mockResolvedValue({ data: error ? null : { id: "ID68945" }, error });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { db: { from } as unknown as Parameters<typeof deactivateRejectedEmployee>[0], from, update, eq, single };
}

describe("penolakan pelamar dengan riwayat payroll", () => {
  it.each(["Training", "Tidak Aktif"])("%s yang belum pernah aktif keluar sehari setelah Training", async (status) => {
    const mock = mockDb();
    await deactivateRejectedEmployee(mock.db, { id: "ID68945", status, tanggal_bergabung: null, tanggal_keluar: "2026-11-10" }, "2026-11-10", "2026-10-09");
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ status: "Tidak Aktif", tanggal_keluar: "2026-10-10" }));
  });

  it("akhir Training pada akhir tahun menggunakan tanggal kalender berikutnya", async () => {
    const mock = mockDb();
    await deactivateRejectedEmployee(mock.db, { id: "emp", status: "Training", tanggal_keluar: null }, "2027-01-05", "2026-12-31");
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ tanggal_keluar: "2027-01-01" }));
  });

  it("menonaktifkan pegawai Training tanpa menghapus atau mengubah slip periode mana pun", async () => {
    const mock = mockDb();
    const result = await deactivateRejectedEmployee(mock.db, { id: "ID68945", status: "Training", tanggal_keluar: null }, "2026-11-10");
    expect(result.error).toBeNull();
    // Mock tidak menyediakan DELETE: penolakan harus berhasil hanya dengan UPDATE pegawai.
    expect(mock.from.mock.calls).toEqual([["pegawai"]]);
    expect(mock.update).toHaveBeenCalledWith({ status: "Tidak Aktif", tanggal_keluar: "2026-11-10", tanggal_bergabung: null });
    expect(mock.eq).toHaveBeenCalledWith("id", "ID68945");
  });

  it("mempertahankan tanggal nonaktif lama dan tanggal bergabung pegawai yang pernah aktif", async () => {
    const mock = mockDb();
    await deactivateRejectedEmployee(mock.db, { id: "emp", status: "Tidak Aktif", tanggal_keluar: "2026-11-08" }, "2026-11-10");
    expect(mock.update).toHaveBeenCalledWith({ status: "Tidak Aktif", tanggal_keluar: "2026-11-08" });
  });

  it("mengembalikan kegagalan penyimpanan agar status pelamar dapat dipulihkan", async () => {
    const error = { message: "Tidak memiliki izin" };
    const mock = mockDb(error);
    const result = await deactivateRejectedEmployee(mock.db, { id: "emp", status: "Training", tanggal_keluar: null }, "2026-11-10");
    expect(result.error).toEqual(error);
  });
});
