"use client";

import { Wallet } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";

export default function IncomePage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pendapatan Pegawai"
        description="Kelola komponen pendapatan, tunjangan, dan potongan pegawai"
        icon={Wallet}
      />

      <div className="bg-card rounded-2xl border border-border p-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary-light flex items-center justify-center mx-auto mb-4">
          <Wallet className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Segera Hadir</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Modul pendapatan pegawai sedang dalam pengembangan. Fitur ini akan mencakup pengelolaan gaji pokok, tunjangan, lembur, bonus, dan potongan.
        </p>
      </div>
    </div>
  );
}
