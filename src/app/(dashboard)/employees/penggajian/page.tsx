import { redirect } from "next/navigation";

export default function PenggajianIndex() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  redirect(`/employees/penggajian/draft?period=${y}-${m}`);
}
