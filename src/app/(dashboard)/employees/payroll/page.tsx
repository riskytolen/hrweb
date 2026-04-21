"use client";

import { CreditCard, Download, Send, Calculator } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { payrollRecords, type PayrollRecord } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils";

const statusVariant: Record<string, "success" | "warning" | "muted"> = {
  Paid: "success",
  Pending: "warning",
  Draft: "muted",
};

const columns: Column<PayrollRecord>[] = [
  {
    key: "employeeName",
    header: "Karyawan",
    render: (item) => (
      <div>
        <p className="font-semibold text-foreground">{item.employeeName}</p>
        <p className="text-xs text-muted-foreground">{item.position}</p>
      </div>
    ),
  },
  {
    key: "department",
    header: "Departemen",
    render: (item) => (
      <span className="text-muted-foreground">{item.department}</span>
    ),
  },
  {
    key: "baseSalary",
    header: "Gaji Pokok",
    render: (item) => (
      <span className="font-medium text-foreground">
        {formatCurrency(item.baseSalary)}
      </span>
    ),
  },
  {
    key: "allowance",
    header: "Tunjangan",
    render: (item) => (
      <span className="text-success font-medium">
        +{formatCurrency(item.allowance)}
      </span>
    ),
  },
  {
    key: "deduction",
    header: "Potongan",
    render: (item) => (
      <span className="text-danger font-medium">
        -{formatCurrency(item.deduction)}
      </span>
    ),
  },
  {
    key: "netSalary",
    header: "Gaji Bersih",
    render: (item) => (
      <span className="font-bold text-foreground">
        {formatCurrency(item.netSalary)}
      </span>
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

export default function PayrollPage() {
  const totalPayroll = payrollRecords.reduce((sum, r) => sum + r.netSalary, 0);
  const paidCount = payrollRecords.filter((r) => r.status === "Paid").length;
  const pendingCount = payrollRecords.filter((r) => r.status === "Pending").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Penggajian"
        description="Kelola penggajian pegawai perusahaan"
        icon={CreditCard}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={Calculator} size="sm">
              Hitung Gaji
            </Button>
            <Button variant="outline" icon={Download} size="sm">
              Export
            </Button>
            <Button icon={Send} size="sm">
              Proses Gaji
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Total Penggajian</p>
          <p className="text-xl font-bold text-foreground mt-1">
            {formatCurrency(totalPayroll)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Periode Maret 2024</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Sudah Dibayar</p>
          <p className="text-xl font-bold text-success mt-1">{paidCount}</p>
          <p className="text-xs text-muted-foreground mt-1">pegawai</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Menunggu Proses</p>
          <p className="text-xl font-bold text-warning mt-1">{pendingCount}</p>
          <p className="text-xs text-muted-foreground mt-1">pegawai</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Rata-rata Gaji</p>
          <p className="text-xl font-bold text-foreground mt-1">
            {formatCurrency(totalPayroll / payrollRecords.length)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">per pegawai</p>
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={payrollRecords}
      />
    </div>
  );
}
