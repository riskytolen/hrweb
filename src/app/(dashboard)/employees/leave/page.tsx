"use client";

import { CalendarDays, Plus, Download, Check, X, Clock, Filter } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { leaveRequests, type LeaveRequest } from "@/lib/mock-data";
import { formatShortDate, getInitials } from "@/lib/utils";

const statusVariant: Record<string, "success" | "warning" | "danger" | "muted"> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "danger",
};

const typeVariant: Record<string, "default" | "danger" | "info" | "muted"> = {
  "Cuti Tahunan": "default",
  "Cuti Sakit": "danger",
  Izin: "info",
};

const columns: Column<LeaveRequest>[] = [
  {
    key: "employeeName",
    header: "Pegawai",
    render: (item) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-[10px] font-bold">
          {getInitials(item.employeeName)}
        </div>
        <div>
          <p className="font-semibold text-foreground">{item.employeeName}</p>
          <p className="text-xs text-muted-foreground">{item.department}</p>
        </div>
      </div>
    ),
  },
  {
    key: "type",
    header: "Jenis",
    render: (item) => (
      <Badge variant={typeVariant[item.type] || "muted"}>
        {item.type}
      </Badge>
    ),
  },
  {
    key: "startDate",
    header: "Periode",
    render: (item) => (
      <div>
        <p className="text-sm text-foreground">
          {formatShortDate(item.startDate)} - {formatShortDate(item.endDate)}
        </p>
        <p className="text-xs text-muted-foreground">{item.days} hari</p>
      </div>
    ),
  },
  {
    key: "reason",
    header: "Alasan",
    render: (item) => (
      <span className="text-sm text-muted-foreground">{item.reason}</span>
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
  {
    key: "actions",
    header: "Aksi",
    className: "text-center",
    render: (item) =>
      item.status === "Pending" ? (
        <div className="flex items-center justify-center gap-1">
          <button className="p-1.5 rounded-lg bg-success-light text-success hover:bg-success hover:text-white" title="Setujui">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 rounded-lg bg-danger-light text-danger hover:bg-danger hover:text-white" title="Tolak">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
  },
];

export default function LeavePage() {
  const pendingCount = leaveRequests.filter((l) => l.status === "Pending").length;
  const approvedCount = leaveRequests.filter((l) => l.status === "Approved").length;
  const rejectedCount = leaveRequests.filter((l) => l.status === "Rejected").length;
  const totalDays = leaveRequests
    .filter((l) => l.status === "Approved")
    .reduce((sum, l) => sum + l.days, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Cuti & Izin"
        description="Kelola pengajuan cuti dan izin pegawai"
        icon={CalendarDays}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={Download} size="sm">
              Export
            </Button>
            <Button icon={Plus} size="sm">
              Ajukan Cuti
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-warning-light flex items-center justify-center">
              <Clock className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Menunggu Persetujuan</p>
              <p className="text-xl font-bold text-warning">{pendingCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success-light flex items-center justify-center">
              <Check className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Disetujui</p>
              <p className="text-xl font-bold text-success">{approvedCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-danger-light flex items-center justify-center">
              <X className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Ditolak</p>
              <p className="text-xl font-bold text-danger">{rejectedCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary-light flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Hari Cuti</p>
              <p className="text-xl font-bold text-primary">{totalDays} hari</p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={leaveRequests}
      />
    </div>
  );
}
