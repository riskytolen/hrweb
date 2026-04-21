"use client";

import { useState } from "react";
import {
  UserPlus,
  Plus,
  Download,
  Search,
  Filter,
  Mail,
  Phone,
  Briefcase,
  GraduationCap,
  MapPin,
  MoreHorizontal,
  ChevronRight,
  Eye,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { candidates } from "@/lib/mock-data";
import { cn, getInitials, formatShortDate } from "@/lib/utils";

const stages = [
  "Semua",
  "Screening CV",
  "Review Portfolio",
  "Technical Test",
  "Interview HR",
  "Interview User",
  "Offering",
  "Onboarding",
];

const statusVariant: Record<string, "success" | "warning" | "danger" | "default" | "info" | "muted"> = {
  Active: "default",
  Offered: "info",
  Hired: "success",
  Rejected: "danger",
};

const stageColor: Record<string, string> = {
  "Screening CV": "bg-muted text-muted-foreground",
  "Review Portfolio": "bg-accent-light text-accent",
  "Technical Test": "bg-warning-light text-warning",
  "Interview HR": "bg-primary-light text-primary",
  "Interview User": "bg-primary-light text-primary",
  Offering: "bg-success-light text-success",
  Onboarding: "bg-success-light text-success",
};

export default function RecruitmentPage() {
  const [search, setSearch] = useState("");
  const [selectedStage, setSelectedStage] = useState("Semua");
  const [viewMode, setViewMode] = useState<"table" | "pipeline">("table");

  const filtered = candidates.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.position.toLowerCase().includes(search.toLowerCase()) ||
      c.department.toLowerCase().includes(search.toLowerCase());
    const matchStage =
      selectedStage === "Semua" || c.stage === selectedStage;
    return matchSearch && matchStage;
  });

  const activeCount = candidates.filter((c) => c.status === "Active").length;
  const offeredCount = candidates.filter((c) => c.status === "Offered").length;
  const hiredCount = candidates.filter((c) => c.status === "Hired").length;
  const rejectedCount = candidates.filter((c) => c.status === "Rejected").length;

  // Pipeline stages for pipeline view
  const pipelineStages = [
    "Screening CV",
    "Review Portfolio",
    "Technical Test",
    "Interview HR",
    "Interview User",
    "Offering",
    "Onboarding",
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Rekrutmen"
        description="Kelola proses rekrutmen calon pegawai"
        icon={UserPlus}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={Download} size="sm">
              Export
            </Button>
            <Button icon={Plus} size="sm">
              Tambah Kandidat
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Kandidat</p>
              <p className="text-2xl font-bold text-foreground mt-1">{candidates.length}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-primary-light flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Dalam Proses</p>
              <p className="text-2xl font-bold text-primary mt-1">{activeCount}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-primary-light flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Diterima</p>
              <p className="text-2xl font-bold text-success mt-1">{hiredCount + offeredCount}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-success-light flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-success" />
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Ditolak</p>
              <p className="text-2xl font-bold text-danger mt-1">{rejectedCount}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-danger-light flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-danger" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari nama, posisi, atau departemen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            {["Semua", "Screening CV", "Interview HR", "Interview User", "Technical Test", "Offering"].map((stage) => (
              <button
                key={stage}
                onClick={() => setSelectedStage(stage)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap",
                  selectedStage === stage
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {stage}
              </button>
            ))}
          </div>
          {/* View Toggle */}
          <div className="flex items-center bg-muted rounded-xl p-1">
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium",
                viewMode === "table"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground"
              )}
            >
              Tabel
            </button>
            <button
              onClick={() => setViewMode("pipeline")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium",
                viewMode === "pipeline"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground"
              )}
            >
              Pipeline
            </button>
          </div>
        </div>
      </div>

      {viewMode === "table" ? (
        /* Table View */
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Kandidat</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Posisi</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pengalaman</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tahap</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Sumber</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tanggal Lamar</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((candidate) => (
                  <tr key={candidate.id} className="hover:bg-muted/30 cursor-pointer">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold">
                          {getInitials(candidate.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{candidate.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Mail className="w-3 h-3" />
                              {candidate.email}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-foreground">{candidate.position}</p>
                      <p className="text-xs text-muted-foreground">{candidate.department}</p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm text-foreground">{candidate.experience}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <GraduationCap className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{candidate.education}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn(
                        "inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-lg",
                        stageColor[candidate.stage] || "bg-muted text-muted-foreground"
                      )}>
                        {candidate.stage}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-md">
                        {candidate.source}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">
                      {formatShortDate(candidate.appliedDate)}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={statusVariant[candidate.status] || "muted"}>
                        {candidate.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground">
            Menampilkan {filtered.length} dari {candidates.length} kandidat
          </div>
        </div>
      ) : (
        /* Pipeline View */
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {pipelineStages.map((stage) => {
              const stageCandidates = candidates.filter(
                (c) => c.stage === stage && c.status !== "Rejected"
              );
              return (
                <div key={stage} className="w-72 flex-shrink-0">
                  <div className="bg-card rounded-2xl border border-border overflow-hidden">
                    {/* Stage Header */}
                    <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-foreground">{stage}</h3>
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                          {stageCandidates.length}
                        </span>
                      </div>
                    </div>

                    {/* Candidates */}
                    <div className="p-3 space-y-2 min-h-[120px]">
                      {stageCandidates.length === 0 ? (
                        <div className="text-center py-6 text-xs text-muted-foreground">
                          Tidak ada kandidat
                        </div>
                      ) : (
                        stageCandidates.map((candidate) => (
                          <div
                            key={candidate.id}
                            className="p-3 rounded-xl border border-border hover:border-primary/30 hover:shadow-sm cursor-pointer group bg-card"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                                {getInitials(candidate.name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">
                                  {candidate.name}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {candidate.position}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <Briefcase className="w-3 h-3 text-muted-foreground" />
                                <span className="text-[10px] text-muted-foreground">{candidate.experience}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                {candidate.source}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">
                                {formatShortDate(candidate.appliedDate)}
                              </span>
                              <Badge variant={statusVariant[candidate.status] || "muted"} size="sm">
                                {candidate.status}
                              </Badge>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
