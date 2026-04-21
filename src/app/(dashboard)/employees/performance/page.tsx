"use client";

import { useState } from "react";
import {
  Award,
  Download,
  Filter,
  Star,
  TrendingUp,
  TrendingDown,
  Minus,
  MoreHorizontal,
  ChevronRight,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { cn, getInitials } from "@/lib/utils";

interface PerformanceRecord {
  id: string;
  name: string;
  department: string;
  position: string;
  rating: number;
  trend: "up" | "down" | "stable";
  kpiScore: number;
  attendance: number;
  taskCompletion: number;
  period: string;
  status: string;
}

const performanceData: PerformanceRecord[] = [
  {
    id: "ID57201",
    name: "Budi Santoso",
    department: "Engineering",
    position: "Senior Software Engineer",
    rating: 4.8,
    trend: "up",
    kpiScore: 95,
    attendance: 98,
    taskCompletion: 92,
    period: "Q1 2024",
    status: "Excellent",
  },
  {
    id: "ID57202",
    name: "Siti Nurhaliza",
    department: "Marketing",
    position: "Marketing Manager",
    rating: 4.5,
    trend: "up",
    kpiScore: 90,
    attendance: 96,
    taskCompletion: 88,
    period: "Q1 2024",
    status: "Excellent",
  },
  {
    id: "ID57203",
    name: "Ahmad Fauzi",
    department: "Sales",
    position: "Sales Executive",
    rating: 3.8,
    trend: "stable",
    kpiScore: 78,
    attendance: 88,
    taskCompletion: 75,
    period: "Q1 2024",
    status: "Good",
  },
  {
    id: "ID57205",
    name: "Rizky Pratama",
    department: "Engineering",
    position: "Frontend Developer",
    rating: 4.2,
    trend: "up",
    kpiScore: 85,
    attendance: 97,
    taskCompletion: 90,
    period: "Q1 2024",
    status: "Very Good",
  },
  {
    id: "ID57206",
    name: "Maya Anggraini",
    department: "Finance",
    position: "Financial Analyst",
    rating: 4.0,
    trend: "stable",
    kpiScore: 82,
    attendance: 95,
    taskCompletion: 85,
    period: "Q1 2024",
    status: "Very Good",
  },
  {
    id: "ID57207",
    name: "Hendra Wijaya",
    department: "Operations",
    position: "Operations Manager",
    rating: 4.6,
    trend: "up",
    kpiScore: 92,
    attendance: 99,
    taskCompletion: 94,
    period: "Q1 2024",
    status: "Excellent",
  },
  {
    id: "ID57209",
    name: "Andi Setiawan",
    department: "Engineering",
    position: "Backend Developer",
    rating: 3.5,
    trend: "down",
    kpiScore: 72,
    attendance: 90,
    taskCompletion: 70,
    period: "Q1 2024",
    status: "Good",
  },
  {
    id: "ID57210",
    name: "Rina Wulandari",
    department: "Marketing",
    position: "Content Strategist",
    rating: 3.2,
    trend: "down",
    kpiScore: 68,
    attendance: 85,
    taskCompletion: 65,
    period: "Q1 2024",
    status: "Needs Improvement",
  },
  {
    id: "ID57211",
    name: "Fajar Nugroho",
    department: "Sales",
    position: "Account Manager",
    rating: 4.3,
    trend: "up",
    kpiScore: 88,
    attendance: 94,
    taskCompletion: 86,
    period: "Q1 2024",
    status: "Very Good",
  },
  {
    id: "ID57204",
    name: "Dewi Lestari",
    department: "HR",
    position: "HR Specialist",
    rating: 4.1,
    trend: "stable",
    kpiScore: 84,
    attendance: 96,
    taskCompletion: 82,
    period: "Q1 2024",
    status: "Very Good",
  },
];

const statusVariant: Record<string, "success" | "default" | "warning" | "danger"> = {
  Excellent: "success",
  "Very Good": "default",
  Good: "warning",
  "Needs Improvement": "danger",
};

function RatingStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            "w-3.5 h-3.5",
            star <= Math.round(rating)
              ? "fill-warning text-warning"
              : "text-border fill-transparent"
          )}
        />
      ))}
      <span className="text-xs font-bold text-foreground ml-1">{rating.toFixed(1)}</span>
    </div>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-foreground w-8 text-right">{value}%</span>
    </div>
  );
}

export default function PerformancePage() {
  const [selectedPeriod, setSelectedPeriod] = useState("Q1 2024");

  const avgRating = (performanceData.reduce((sum, p) => sum + p.rating, 0) / performanceData.length).toFixed(1);
  const excellentCount = performanceData.filter((p) => p.status === "Excellent").length;
  const needsImprovementCount = performanceData.filter((p) => p.status === "Needs Improvement").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kinerja Pegawai"
        description="Evaluasi dan monitoring kinerja pegawai"
        icon={Award}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={Filter} size="sm">
              {selectedPeriod}
            </Button>
            <Button variant="outline" icon={Download} size="sm">
              Export
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Rata-rata Rating</p>
          <div className="flex items-end gap-2 mt-2">
            <p className="text-2xl font-bold text-foreground">{avgRating}</p>
            <span className="text-xs text-muted-foreground mb-1">/ 5.0</span>
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={cn(
                    "w-3 h-3",
                    s <= Math.round(Number(avgRating))
                      ? "fill-warning text-warning"
                      : "text-border fill-transparent"
                  )}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Pegawai Dinilai</p>
          <p className="text-2xl font-bold text-foreground mt-2">{performanceData.length}</p>
          <p className="text-xs text-muted-foreground mt-1.5">Periode {selectedPeriod}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Excellent</p>
          <p className="text-2xl font-bold text-success mt-2">{excellentCount}</p>
          <p className="text-xs text-muted-foreground mt-1.5">pegawai berprestasi</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-xs text-muted-foreground font-medium">Perlu Perbaikan</p>
          <p className="text-2xl font-bold text-danger mt-2">{needsImprovementCount}</p>
          <p className="text-xs text-muted-foreground mt-1.5">perlu perhatian</p>
        </div>
      </div>

      {/* Performance Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  Pegawai
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  Rating
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  KPI Score
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  Kehadiran
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  Penyelesaian Tugas
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  Tren
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  Status
                </th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {performanceData.map((record) => (
                <tr key={record.id} className="hover:bg-muted/30 cursor-pointer">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold">
                        {getInitials(record.name)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{record.name}</p>
                        <p className="text-xs text-muted-foreground">{record.department} - {record.position}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <RatingStars rating={record.rating} />
                  </td>
                  <td className="px-5 py-4 w-36">
                    <ProgressBar
                      value={record.kpiScore}
                      color={record.kpiScore >= 85 ? "bg-success" : record.kpiScore >= 70 ? "bg-warning" : "bg-danger"}
                    />
                  </td>
                  <td className="px-5 py-4 w-36">
                    <ProgressBar
                      value={record.attendance}
                      color={record.attendance >= 95 ? "bg-primary" : record.attendance >= 85 ? "bg-warning" : "bg-danger"}
                    />
                  </td>
                  <td className="px-5 py-4 w-36">
                    <ProgressBar
                      value={record.taskCompletion}
                      color={record.taskCompletion >= 85 ? "bg-accent" : record.taskCompletion >= 70 ? "bg-warning" : "bg-danger"}
                    />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1">
                      {record.trend === "up" ? (
                        <div className="flex items-center gap-1 text-success">
                          <TrendingUp className="w-4 h-4" />
                          <span className="text-xs font-semibold">Naik</span>
                        </div>
                      ) : record.trend === "down" ? (
                        <div className="flex items-center gap-1 text-danger">
                          <TrendingDown className="w-4 h-4" />
                          <span className="text-xs font-semibold">Turun</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Minus className="w-4 h-4" />
                          <span className="text-xs font-semibold">Stabil</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant={statusVariant[record.status] || "muted"}>
                      {record.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground inline-flex items-center gap-1 text-xs">
                      <span className="hidden lg:inline text-primary font-medium">Detail</span>
                      <ChevronRight className="w-4 h-4 text-primary" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          Menampilkan {performanceData.length} pegawai - Periode {selectedPeriod}
        </div>
      </div>
    </div>
  );
}
