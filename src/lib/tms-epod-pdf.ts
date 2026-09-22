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
  type EpodAssignmentStatus,
  type EpodDeliveryResult,
  type EpodEvidence,
  type EpodItem,
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

type Rgb = [number, number, number];

const NAVY: Rgb = [15, 42, 76];
const BLUE: Rgb = [37, 99, 235];
const BLUE_LIGHT: Rgb = [239, 246, 255];
const SLATE: Rgb = [71, 85, 105];
const SLATE_LIGHT: Rgb = [241, 245, 249];
const BORDER: Rgb = [226, 232, 240];
const INK: Rgb = [30, 41, 59];
const MUTED: Rgb = [120, 130, 145];
const GREEN: Rgb = [22, 163, 74];
const GREEN_LIGHT: Rgb = [240, 253, 244];
const AMBER: Rgb = [180, 83, 9];
const AMBER_LIGHT: Rgb = [255, 251, 235];
const RED: Rgb = [185, 28, 28];
const RED_LIGHT: Rgb = [254, 242, 242];

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

interface RenderedImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Unduh foto dari signed URL dan ubah menjadi JPEG data URL beserta dimensinya. */
async function toJpegImage(signedUrl: string): Promise<RenderedImage | null> {
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
    return {
      dataUrl: canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
}

const ACTOR_LABEL: Record<EpodSubmission["actorType"], string> = {
  WEB_ADMIN: "Admin Web",
  DRIVER: "Driver",
  HELPER: "Helper",
};

interface BadgeTone {
  fg: Rgb;
  bg: Rgb;
}

function statusTone(status: EpodAssignmentStatus): BadgeTone {
  switch (status) {
    case "COMPLETED":
      return { fg: GREEN, bg: GREEN_LIGHT };
    case "CANCELLED":
      return { fg: RED, bg: RED_LIGHT };
    case "IN_PROGRESS":
    case "CLAIMED":
      return { fg: BLUE, bg: BLUE_LIGHT };
    default:
      return { fg: SLATE, bg: SLATE_LIGHT };
  }
}

function resultTone(result: EpodDeliveryResult): BadgeTone {
  switch (result) {
    case "DELIVERED":
      return { fg: GREEN, bg: GREEN_LIGHT };
    case "PARTIAL":
      return { fg: AMBER, bg: AMBER_LIGHT };
    default:
      return { fg: RED, bg: RED_LIGHT };
  }
}

export async function exportEpodPdf(taskId: string): Promise<void> {
  const data = await fetchEpodExportData(taskId);
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const footerY = pageHeight - 13;
  const bottomLimit = footerY - 6;
  const contentTop = 32;

  const {
    assignment,
    driverName,
    helperName,
    stops,
    currentByStop,
    evidenceBySubmission,
    pointTemperatures,
  } = data;
  const temperatureBySequence = indexPointTemperaturesBySequence(pointTemperatures);
  const taskLabel = assignment.taskNumber ?? assignment.taskId;

  let logo: HTMLImageElement | null = null;
  try {
    const image = new Image();
    image.src = "/jamslogistics.png";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("logo"));
    });
    logo = image;
  } catch {
    logo = null;
  }

  const drawHeader = () => {
    if (logo) {
      doc.addImage(logo, "PNG", margin, 11, 30, 11);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text("JAMS LOGISTICS", margin, 18);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text("LAPORAN BUKTI PENGIRIMAN", pageWidth - margin, 15, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(`e-POD • ${taskLabel}`, pageWidth - margin, 20, { align: "right" });
    doc.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.setLineWidth(0.7);
    doc.line(margin, 26, pageWidth - margin, 26);
    doc.setLineWidth(0.2);
  };

  let y = contentTop;
  drawHeader();

  const newPage = () => {
    doc.addPage();
    drawHeader();
    y = contentTop;
  };
  const ensure = (needed: number) => {
    if (y + needed > bottomLimit) newPage();
  };

  const lastAutoTableY = (): number => {
    const holder = doc as unknown as { lastAutoTable?: { finalY?: number } };
    return holder.lastAutoTable?.finalY ?? y;
  };

  const badge = (
    text: string,
    x: number,
    top: number,
    tone: BadgeTone,
    align: "left" | "right" = "left",
  ): void => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const width = doc.getTextWidth(text) + 7;
    const height = 6.4;
    const left = align === "right" ? x - width : x;
    doc.setFillColor(tone.bg[0], tone.bg[1], tone.bg[2]);
    doc.roundedRect(left, top, width, height, 3.2, 3.2, "F");
    doc.setTextColor(tone.fg[0], tone.fg[1], tone.fg[2]);
    doc.text(text, left + width / 2, top + height / 2 + 1.05, { align: "center" });
  };

  const sectionTitle = (text: string) => {
    ensure(11);
    doc.setFillColor(SLATE_LIGHT[0], SLATE_LIGHT[1], SLATE_LIGHT[2]);
    doc.roundedRect(margin, y, contentWidth, 7, 1.2, 1.2, "F");
    doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.rect(margin, y, 1.6, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text(text.toUpperCase(), margin + 4, y + 4.8);
    y += 10;
  };

  const metaGrid = (pairs: Array<[string, string]>) => {
    const gap = 6;
    const colW = (contentWidth - gap) / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      const rowPairs = pairs.slice(i, i + 2);
      const lines = rowPairs.map(([, value]) => doc.splitTextToSize(value, colW - 2).length);
      const rowH = 5 + Math.max(...lines) * 4 + 3;
      ensure(rowH);
      rowPairs.forEach(([label, value], column) => {
        const x = margin + column * (colW + gap);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.6);
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        doc.text(label.toUpperCase(), x, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        doc.text(doc.splitTextToSize(value, colW - 2), x, y + 4);
      });
      y += rowH;
    }
  };

  const panel = (label: string, text: string, tone: BadgeTone) => {
    const lines = doc.splitTextToSize(text, contentWidth - 8);
    const height = 6 + lines.length * 4.2 + 2;
    ensure(height + 2);
    doc.setFillColor(tone.bg[0], tone.bg[1], tone.bg[2]);
    doc.roundedRect(margin, y, contentWidth, height, 1.5, 1.5, "F");
    doc.setFillColor(tone.fg[0], tone.fg[1], tone.fg[2]);
    doc.rect(margin, y, 1.6, height, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.setTextColor(tone.fg[0], tone.fg[1], tone.fg[2]);
    doc.text(label.toUpperCase(), margin + 4, y + 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(lines, margin + 4, y + 8.5);
    y += height + 3;
  };

  const tableBase = {
    theme: "grid" as const,
    styles: {
      fontSize: 8,
      cellPadding: 1.8,
      lineColor: BORDER,
      lineWidth: 0.1,
      textColor: INK,
      valign: "middle" as const,
      overflow: "linebreak" as const,
    },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: "bold" as const, fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] as Rgb },
    margin: { top: contentTop, bottom: 18, left: margin, right: margin },
    willDrawPage: (hook: { pageNumber: number }) => {
      if (hook.pageNumber > 1) drawHeader();
    },
  };

  const itemsTable = (items: EpodItem[]) => {
    autoTable(doc, {
      ...tableBase,
      startY: y,
      head: [["Barang", "Qty", "Satuan"]],
      body: items.map((item) => [item.name, String(item.quantity), item.unit ?? "-"]),
      columnStyles: {
        1: { halign: "right", cellWidth: 18 },
        2: { halign: "center", cellWidth: 24 },
      },
    });
    y = lastAutoTableY() + 4;
  };

  const routeTable = () => {
    autoTable(doc, {
      ...tableBase,
      startY: y,
      head: [["No", "Titik", "Tipe", "Hasil", "Suhu", "Waktu"]],
      body: stops.map((stop) => {
        const submission = currentByStop[stop.id] ?? null;
        const isDelivery = stop.stopType === "DELIVERY";
        const temperature = temperatureBySequence.get(stop.sequence);
        const temperatureLabel = formatCapturedPointTemperature(temperature);
        const result = isDelivery
          ? submission?.result
            ? EPOD_RESULT_LABEL[submission.result]
            : "Belum ada"
          : "Loading";
        return [
          String(stop.sequence),
          stop.pointName ?? "Titik",
          isDelivery ? "Pengantaran" : "Loading",
          result,
          temperature && temperatureLabel ? temperatureLabel : "-",
          submission ? formatDateTime(submission.capturedAtServer) : "-",
        ];
      }),
      columnStyles: {
        0: { halign: "center", cellWidth: 10 },
        1: { cellWidth: 48 },
        2: { cellWidth: 24 },
        3: { cellWidth: 24 },
        4: { cellWidth: 22 },
        5: { cellWidth: "auto" },
      },
    });
    y = lastAutoTableY() + 6;
  };

  const photos = async (evidence: EpodExportEvidence[]) => {
    const usable = evidence.filter((item) => item.signedUrl);
    if (usable.length === 0) return;
    const gap = 5;
    const boxW = (contentWidth - gap) / PHOTOS_PER_ROW;
    const boxH = boxW * 0.74;
    const rendered = await Promise.all(
      usable.map((item) => toJpegImage(item.signedUrl as string)),
    );

    for (let index = 0; index < usable.length; index += PHOTOS_PER_ROW) {
      ensure(boxH + 9);
      for (let column = 0; column < PHOTOS_PER_ROW; column += 1) {
        const position = index + column;
        if (position >= usable.length) break;
        const x = margin + column * (boxW + gap);
        doc.setFillColor(250, 251, 253);
        doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
        doc.setLineWidth(0.2);
        doc.roundedRect(x, y, boxW, boxH, 1.5, 1.5, "FD");

        const image = rendered[position];
        if (image) {
          const scale = Math.min((boxW - 2) / image.width, (boxH - 2) / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          try {
            doc.addImage(
              image.dataUrl,
              "JPEG",
              x + (boxW - width) / 2,
              y + (boxH - height) / 2,
              width,
              height,
            );
          } catch {
            // lewati foto yang gagal dirender
          }
        } else {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
          doc.text("Foto tidak tersedia", x + boxW / 2, y + boxH / 2, { align: "center" });
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.6);
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        doc.text(`Foto ${position + 1}`, x, y + boxH + 3.2);
      }
      y += boxH + 8;
    }
  };

  // ─── Hero: nomor FO + status ───
  const heroHeight = 20;
  doc.setFillColor(BLUE_LIGHT[0], BLUE_LIGHT[1], BLUE_LIGHT[2]);
  doc.roundedRect(margin, y, contentWidth, heroHeight, 2, 2, "F");
  doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.rect(margin, y, 1.8, heroHeight, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text("NOMOR FO", margin + 5, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(taskLabel, margin + 5, y + 14.5);
  badge(
    EPOD_ASSIGNMENT_STATUS_LABEL[assignment.status],
    margin + contentWidth - 5,
    y + 6.8,
    statusTone(assignment.status),
    "right",
  );
  y += heroHeight + 6;

  // ─── Ringkasan FO ───
  sectionTitle("Informasi Pengiriman");
  metaGrid([
    ["No. Kendaraan", assignment.licensePlate ?? "-"],
    ["Driver (vendor)", assignment.vendorDriverName ?? "-"],
    ["Petugas e-POD", driverName ?? helperName ?? "Belum ditetapkan"],
    [
      "Progress e-POD",
      `${assignment.deliveryDoneCount} dari ${assignment.deliveryTotalCount} titik pengantaran`,
    ],
    ["Jumlah Titik", `${stops.length} titik`],
    ["Snapshot", formatDateTime(assignment.snapshotAt)],
    ["Selesai Loading", formatDateTime(assignment.loadingCompletedAt)],
  ]);
  y += 3;

  sectionTitle("Ringkasan Rute");
  routeTable();

  // ─── Detail per titik ───
  sectionTitle("Detail Titik");

  for (const stop of stops) {
    const submission = currentByStop[stop.id] ?? null;
    const evidence = submission ? evidenceBySubmission[submission.id] ?? [] : [];
    const isDelivery = stop.stopType === "DELIVERY";
    const temperature = temperatureBySequence.get(stop.sequence);
    const temperatureLabel = formatCapturedPointTemperature(temperature);

    ensure(20);
    const barHeight = 9;
    const barColor = isDelivery ? BLUE : SLATE;
    doc.setFillColor(barColor[0], barColor[1], barColor[2]);
    doc.roundedRect(margin, y, contentWidth, barHeight, 1.5, 1.5, "F");
    doc.setFillColor(255, 255, 255);
    doc.circle(margin + 5, y + barHeight / 2, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(barColor[0], barColor[1], barColor[2]);
    doc.text(String(stop.sequence), margin + 5, y + barHeight / 2 + 1.1, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    const pointName = doc.splitTextToSize(stop.pointName ?? "Titik", contentWidth - 70)[0] ?? "";
    doc.text(pointName, margin + 10, y + barHeight / 2 + 1.3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(
      isDelivery ? "PENGANTARAN" : "LOADING",
      margin + contentWidth - 4,
      y + barHeight / 2 + 1.1,
      { align: "right" },
    );
    y += barHeight + 4;

    panel("Alamat", stop.address ?? "-", { fg: SLATE, bg: SLATE_LIGHT });

    if (temperature && temperatureLabel) {
      metaGrid([
        ["Suhu kendaraan", temperatureLabel],
        ["Waktu ukur suhu", formatDateTime(temperature.measuredAt)],
      ]);
    }

    if (!submission) {
      panel("Status", "Belum ada bukti e-POD untuk titik ini.", { fg: AMBER, bg: AMBER_LIGHT });
      y += 3;
      continue;
    }

    const pairs: Array<[string, string]> = [];
    if (isDelivery) {
      pairs.push([
        "Hasil",
        submission.result ? EPOD_RESULT_LABEL[submission.result] : "-",
      ]);
      pairs.push(["Penerima", submission.recipientName ?? "-"]);
    } else {
      pairs.push(["Status", "Bukti loading terkirim"]);
    }
    pairs.push(["Diinput oleh", ACTOR_LABEL[submission.actorType]]);
    pairs.push(["Waktu server", formatDateTime(submission.capturedAtServer)]);
    if (submission.capturedAtDevice) {
      pairs.push(["Waktu perangkat", formatDateTime(submission.capturedAtDevice)]);
    }
    if (submission.distanceMeters !== null) {
      pairs.push(["Jarak dari titik", formatDistance(submission.distanceMeters)]);
    }
    metaGrid(pairs);

    if (isDelivery && submission.result) {
      badge(
        EPOD_RESULT_LABEL[submission.result],
        margin,
        y - 1,
        resultTone(submission.result),
      );
      y += 9;
    }

    if (submission.geofenceOk === false) {
      panel("Peringatan lokasi", "Pengambilan bukti dilakukan di luar radius titik.", {
        fg: RED,
        bg: RED_LIGHT,
      });
    }
    if (submission.outOfRadiusReason) {
      panel("Alasan luar radius", submission.outOfRadiusReason, { fg: AMBER, bg: AMBER_LIGHT });
    }
    if (submission.note) {
      panel("Catatan", submission.note, { fg: SLATE, bg: SLATE_LIGHT });
    }

    if (submission.items.length > 0) {
      ensure(12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text(`Barang (${submission.items.length})`, margin, y);
      y += 4;
      itemsTable(submission.items);
    }

    if (evidence.length > 0) {
      ensure(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text(`Foto Bukti (${evidence.length})`, margin, y);
      y += 5;
      await photos(evidence);
    }
    y += 4;
  }

  // ─── Footer semua halaman ───
  const printedAt = formatDateTime(new Date().toISOString());
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.3);
    doc.line(margin, footerY, pageWidth - margin, footerY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(`Dicetak ${printedAt}`, margin, footerY + 4.5);
    doc.text("Dokumen dibuat otomatis oleh sistem e-POD", pageWidth / 2, footerY + 4.5, {
      align: "center",
    });
    doc.text(`Halaman ${page} dari ${totalPages}`, pageWidth - margin, footerY + 4.5, {
      align: "right",
    });
  }

  const safeNumber = taskLabel.replace(/[^\w-]+/g, "_");
  doc.save(`e-POD_${safeNumber}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
