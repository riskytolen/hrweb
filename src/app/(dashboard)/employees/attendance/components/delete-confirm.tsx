"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Trash2 } from "lucide-react";
import Portal from "@/components/ui/Portal";
import Button from "@/components/ui/Button";

export type DeleteConfirmHandle = {
  open: (item: { id: number; nama: string }) => void;
};

type DeleteConfirmProps = {
  onConfirm: (item: { id: number; nama: string }) => Promise<void> | void;
};

export const DeleteConfirm = forwardRef<DeleteConfirmHandle, DeleteConfirmProps>(function DeleteConfirm(
  { onConfirm },
  ref,
) {
  const [item, setItem] = useState<{ id: number; nama: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useImperativeHandle(ref, () => ({
    open: (next) => setItem(next),
  }));

  const handleConfirm = async () => {
    if (!item) return;
    setLoading(true);
    await onConfirm(item);
    setLoading(false);
    setItem(null);
  };

  const handleCancel = () => {
    if (loading) return;
    setItem(null);
  };

  if (!item) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCancel} />
        <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
          <div className="p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-danger" /></div>
            <h3 className="text-base font-bold text-foreground">Hapus Data Absen?</h3>
            <p className="text-sm text-muted-foreground mt-2">Data <span className="font-semibold text-foreground">&ldquo;{item.nama}&rdquo;</span> akan dihapus permanen.</p>
          </div>
          <div className="flex items-center gap-3 px-6 pb-6">
            <Button variant="outline" size="sm" className="flex-1" onClick={handleCancel} disabled={loading}>Batal</Button>
            <Button variant="danger" size="sm" icon={Trash2} className="flex-1" onClick={handleConfirm} disabled={loading}>
              {loading ? "Menghapus..." : "Hapus"}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
});
