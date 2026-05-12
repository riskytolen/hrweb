const req = { tanggal_mulai: "2026-05-11", tanggal_selesai: "2026-05-12" };
const dates = [];
const [sy, sm, sd] = req.tanggal_mulai.split("-").map(Number);
const [ey, em, ed] = req.tanggal_selesai.split("-").map(Number);
const startMs = Date.UTC(sy, sm - 1, sd);
const endMs = Date.UTC(ey, em - 1, ed);
for (let ms = startMs; ms <= endMs; ms += 86400000) {
const dt = new Date(ms);
dates.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`);
}
console.log(dates);
