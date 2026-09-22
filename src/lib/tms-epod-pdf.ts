/**
 * Laporan PDF e-POD (client-side).
 *
 * Data diambil dari `/api/tms/epod/by-task/[taskId]/export` yang hanya
 * tersedia setelah seluruh e-POD selesai. Foto bukti ditanam ke PDF setelah
 * diunduh dari signed URL dan dinormalkan ke JPEG agar hemat ukuran.
 */

import {
  EPOD_ASSIGNMENT_STATUS_LABEL,
  EPOD_RESULT_LABEL,
  formatDistance,
  type EpodAssignment,
  type EpodEvidence,
  type EpodStop,
  type EpodSubmission,
} from "./tms-epod";
import {
  formatCapturedPointTemperature,
  indexPointTemperaturesBySequence,
  type TmsRoutePointTemperature,
} from "./tms-point-temperature";

/** Lebar maksimum sisi foto di dalam PDF (px). */
const PHOTO_MAX_DIMENSION = 1280;
/** Kualitas JPEG untuk foto di dalam PDF. */
const PHOTO_JPEG_QUALITY = 0.85;
/** Jumlah foto per baris pada lampiran. */
const PHOTOS_PER_ROW = 2;

export interface EpodExportEvidence extends EpodEvidence {
  signedUrl: string | null;
}

export interface EpodAssignmentExportData {
  assignment: EpodAssignment;
  driverName: string | null;
  helperName: string | null;
  stops: EpodStop[];
  currentByStop: Record<string, EpodSubmission>;
  evidenceBySubmission: Record<string, EpodExportEvidence[]>;
  pointTemperatures: TmsRoutePointTemperature[];
}

export async function fetchEpodExportData(taskId: string): Promise<EpodAssignmentExportData> {
  const response = await fetch(
    `/api/tms/epod/by-task/${encodeURIComponent(taskId)}/export`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as {
    data?: EpodAssignmentExportData;
    error?: string;
  };
  if (!response.ok || payload.error || !payload.data) {
    throw new Error(payload.error ?? "Gagal menyiapkan data laporan e-POD.");
  }
  return payload.data;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(parsed),
  );
}

async function loadImageSource(blob: Blob): Promise<HTMLImageElement | ImageBitmap | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // jatuh ke fallback elemen Image
    }
  }
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/** Unduh foto dari signed URL dan ubah menjadi JPEG data URL. */
async function toJpegDataUrl(signedUrl: string): Promise<string | null> {
  try {
    const response = await fetch(signedUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    const source = await loadImageSource(blob);
    if (!source) return null;

    const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
  } catch {
    return null;
  }
}

const ACTOR_LABEL: Record<EpodSubmission["actorType"], string> = {
  WEB_ADMIN: "Admin Web",
  DRIVER: "Driver",
  HELPER: "Helper",
};

export async function exportEpodPdf(taskId: string): Promise<void> {
  const data = await fetchEpodExportData(taskId);
  const { default: jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 18;
  const accent: [number, number, number] = [41, 128, 185];
  const { assignment, driverName, helperName, stops, currentByStop, evidenceBySubmission, pointTemperatures } = data;
  const temperatureBySequence = indexPointTemperaturesBySequence(pointTemperatures);
  let y = margin;

  const newPage = () => {
    doc.addPage();
    y = margin;
  };
  const ensure = (needed: number) => {
    if (y + needed > bottomLimit) newPage();
  };

  const sectionTitle = (text: string) => {
    ensure(12);
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(text, margin + 2, y + 5.2);
    y += 11;
  };

  const labelValue = (label: string, value: string, labelWidth = 40) => {
    ensure(6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(label, margin, y);
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(value, contentWidth - labelWidth - 2);
    doc.text(lines, margin + labelWidth, y);
    y += Math.max(4.6, lines.length * 4.4);
  };

  const paragraph = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60);
    for (const line of doc.splitTextToSize(text, contentWidth)) {
      ensure(5);
      doc.text(line, margin, y);
      y += 4.4;
    }
    doc.setTextColor(0);
  };

  const itemsTable = (items: EpodSubmission["items"]) => {
    const nameWidth = contentWidth - 40;
    ensure(8 + items.length * 5);
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(margin, y - 4, contentWidth, 5.5, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Barang", margin + 2, y);
    doc.text("Qty", margin + nameWidth + 12, y, { align: "right" });
    doc.text("Satuan", margin + contentWidth - 2, y, { align: "right" });
    y += 5.5;
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    for (const item of items) {
      ensure(5);
      const firstLine = doc.splitTextToSize(item.name, nameWidth)[0] ?? "";
      doc.text(firstLine, margin + 2, y);
      doc.text(String(item.quantity), margin + nameWidth + 12, y, { align: "right" });
      doc.text(item.unit ?? "-", margin + contentWidth - 2, y, { align: "right" });
      y += 4.4;
    }
    y += 2;
  };

  const photos = async (evidence: EpodExportEvidence[]) => {
    const usable = evidence.filter((item) => item.signedUrl);
    if (usable.length === 0) return;
    const gap = 4;
    const width = (contentWidth - gap * (PHOTOS_PER_ROW - 1)) / PHOTOS_PER_ROW;
    const height = width * 0.72;

    for (let index = 0; index < usable.length; index += PHOTOS_PER_ROW) {
      const row = usable.slice(index, index + PHOTOS_PER_ROW);
      ensure(height + 8);
      for (let column = 0; column < row.length; column += 1) {
        const item = row[column];
        if (!item.signedUrl) continue;
        const dataUrl = await toJpegDataUrl(item.signedUrl);
        const x = margin + column * (width + gap);
        if (dataUrl) {
          try {
            doc.addImage(dataUrl, "JPEG", x, y, width, height);
          } catch {
            // lewati foto yang gagal dirender
          }
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text(`Foto ${index + column + 1}`, x, y + height + 3);
      }
      y += height + 8;
    }
  };

  // ─── Kop ───
  try {
    const logo = new Image();
    logo.src = "/jamslogistics.png";
    await new Promise<void>((resolve, reject) => {
      logo.onload = () => resolve();
      logo.onerror = () => reject(new Error("logo"));
    });
    doc.addImage(logo, "PNG", margin, y, 40, 14);
    y += 17;
  } catch {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text("JAMS LOGISTICS", margin, y + 6);
    y += 11;
  }

  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(0);
  doc.text("LAPORAN BUKTI PENGIRIMAN (e-POD)", pageWidth / 2, y, { align: "center" });
  y += 9;

  // ─── Ringkasan ───
  sectionTitle("Ringkasan FO");
  labelValue("No. FO", assignment.taskNumber ?? assignment.taskId);
  labelValue("No. Kendaraan", assignment.licensePlate ?? "-");
  labelValue("Driver (vendor)", assignment.vendorDriverName ?? "-");
  labelValue("Driver", driverName ?? "Belum ditetapkan");
  labelValue("Helper", helperName ?? "Belum ditetapkan");
  labelValue("Snapshot", formatDateTime(assignment.snapshotAt));
  labelValue("Status e-POD", EPOD_ASSIGNMENT_STATUS_LABEL[assignment.status]);
  labelValue(
    "Progress e-POD",
    `${assignment.deliveryDoneCount} dari ${assignment.deliveryTotalCount} titik pengantaran`,
  );
  labelValue("Jumlah Titik", `${stops.length} titik`);
  y += 3;

  // ─── Detail per titik ───
  for (const stop of stops) {
    const submission = currentByStop[stop.id] ?? null;
    const evidence = submission ? evidenceBySubmission[submission.id] ?? [] : [];
    const isDelivery = stop.stopType === "DELIVERY";

    sectionTitle(
      `Titik ${stop.sequence} — ${stop.pointName ?? "Titik"} (${isDelivery ? "Pengantaran" : "Loading"})`,
    );
    labelValue("Alamat", stop.address ?? "-");

    const temperature = temperatureBySequence.get(stop.sequence);
    const temperatureLabel = formatCapturedPointTemperature(temperature);
    if (temperature && temperatureLabel) {
      labelValue(
        "Suhu kendaraan",
        `${temperatureLabel} (diukur ${formatDateTime(temperature.measuredAt)})`,
      );
    }

    if (!submission) {
      paragraph("Belum ada bukti e-POD untuk titik ini.");
      y += 4;
      continue;
    }

    if (isDelivery) {
      labelValue("Hasil", submission.result ? EPOD_RESULT_LABEL[submission.result] : "-");
      labelValue("Penerima", submission.recipientName ?? "-");
    } else {
      labelValue("Status", "Bukti loading terkirim");
    }

    if (submission.items.length > 0) {
      ensure(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(`Barang (${submission.items.length})`, margin, y);
      y += 5;
      itemsTable(submission.items);
    }

    if (submission.note) labelValue("Catatan", submission.note);
    if (submission.outOfRadiusReason) labelValue("Alasan luar radius", submission.outOfRadiusReason);
    if (submission.distanceMeters !== null) {
      labelValue(
        "Jarak dari titik",
        `${formatDistance(submission.distanceMeters)}${submission.geofenceOk === false ? " (di luar radius)" : ""}`,
      );
    }
    labelValue("Waktu server", formatDateTime(submission.capturedAtServer));
    if (submission.capturedAtDevice) {
      labelValue("Waktu perangkat", formatDateTime(submission.capturedAtDevice));
    }
    labelValue("Diinput oleh", ACTOR_LABEL[submission.actorType]);
    y += 2;

    if (evidence.length > 0) {
      ensure(6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(`Foto Bukti (${evidence.length})`, margin, y);
      y += 6;
      await photos(evidence);
    }
    y += 4;
  }

  // ─── Footer semua halaman ───
  const printedAt = formatDateTime(new Date().toISOString());
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(130);
    doc.text(`Dicetak: ${printedAt}`, margin, pageHeight - 8);
    doc.text(`Halaman ${page} dari ${totalPages}`, pageWidth - margin, pageHeight - 8, {
      align: "right",
    });
  }

  const safeNumber = (assignment.taskNumber ?? assignment.taskId).replace(/[^\w-]+/g, "_");
  doc.save(`e-POD_${safeNumber}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
