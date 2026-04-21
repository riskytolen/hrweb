"use client";

import { ClipboardCheck, Download, Calendar } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { attendanceRecords, type AttendanceRecord } from "@/lib/mock-data";

const statusVariant: Record<string, "success" | "warning" | "danger" | "info" | "muted"> = {
  Hadir: "success",
  Terlambat: "warning",
  Izin: "info",
  Sakit: "danger",
  Alpha: "danger",
};

const columns: Column<AttendanceRecord>[] = [
  {
    key: "employeeName",
    header: "Karyawan",
    render: (item) => (
      <div>
        <p className="font-semibold text-foreground">{item.employeeName}</p>
        <p className="text-xs text-muted-foreground">{item.department}</p>
      </div>
    ),
  },
  {
    key: "date",
    header: "Tanggal",
    render: (item) => (
      <span className="text-muted-foreground">{item.date}</span>
    ),
  },
  {
    key: "checkIn",
    header: "Masuk",
    render: (item) => (
      <span className={item.checkIn === "-" ? "text-muted-foreground" : "font-medium text-foreground"}>
        {item.checkIn}
      </span>
    ),
  },
  {
    key: "checkOut",
    header: "Keluar",
    render: (item) => (
      <span className={item.checkOut === "-" ? "text-muted-foreground" : "font-medium text-foreground"}>
        {item.checkOut}
      </span>
    ),
  },
  {
    key: "workHours",
    header: "Jam Kerja",
    render: (item) => (
      <span className="text-muted-foreground">{item.workHours}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (item) => (
      <Badge variant={statusVariant[item.status] || "muted"}>
        {item.status}
      </Badge>
    ),
  },
];

export default function AttendancePage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Absensi Pegawai"
        description="Pantau kehadiran dan jam kerja pegawai"
        icon={ClipboardCheck}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={Calendar} size="sm">
              Pilih Tanggal
            </Button>
            <Button variant="outline" icon={Download} size="sm">
              Export
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Hadir", value: "235", total: "248", color: "text-success", bg: "bg-success-light" },
          { label: "Terlambat", value: "5", total: "248", color: "text-warning", bg: "bg-warning-light" },
          { label: "Izin", value: "4", total: "248", color: "text-primary", bg: "bg-primary-light" },
          { label: "Sakit", value: "4", total: "248", color: "text-danger", bg: "bg-danger-light" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-card rounded-2xl border border-border p-4 flex items-center gap-4"
          >
            <div className={`w-12 h-12 rounded-xl ${stat.bg} flex items-center justify-center`}>
              <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{stat.label}</p>
              <p className="text-xs text-muted-foreground">dari {stat.total} pegawai</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={attendanceRecords}
      />
    </div>
  );
}
