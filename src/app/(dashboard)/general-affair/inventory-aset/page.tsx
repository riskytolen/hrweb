"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Package,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Check,
  Eye,
  CircleCheckBig,
  AlertTriangle,
  FileDown,
  ArrowRightLeft,
  Undo2,
  MapPin,
  Boxes,
  Tag,
  DollarSign,
  CalendarDays,
  Hash,
  LayoutGrid,
  Table as TableIcon,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { cn } from "@/lib/utils";
import {
  supabase,
  type DbGaAsset,
  type DbGaAssetCategory,
  type DbGaAssetLocation,
  type DbGaAssetAssignment,
} from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

const PAGE_SIZE = 24;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_BATCH_QUANTITY = 100;
const ASSET_PHOTO_BUCKET = "ga-asset-photos";
const inputClass =
  "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

type AssetStatus = "Aktif" | "Rusak" | "Tidak Aktif";
type Kondisi = "Baik" | "Rusak Ringan" | "Rusak Berat";

const statusStyle: Record<AssetStatus, string> = {
  Aktif: "bg-success/10 text-success border-success/20",
  Rusak: "bg-warning/10 text-warning border-warning/20",
  "Tidak Aktif": "bg-muted text-muted-foreground border-border",
};

const kondisiStyle: Record<Kondisi, string> = {
  Baik: "bg-success/10 text-success",
  "Rusak Ringan": "bg-warning/10 text-warning",
  "Rusak Berat": "bg-danger/10 text-danger",
};

type FormState = {
  jumlah_item: string;
  category_id: number | null;
  nama_aset: string;
  merek: string;
  model: string;
  serial_number: string;
  spesifikasi: string;
  tanggal_beli: string;
  harga_beli: string;
  kondisi: Kondisi;
  status: AssetStatus;
  lokasi_id: number | null;
  catatan: string;
};

type AssignmentFormState = {
  pegawai_id: string;
  division_id: string;
  lokasi_id: string;
  catatan: string;
};

const emptyForm: FormState = {
  jumlah_item: "1",
  category_id: null,
  nama_aset: "",
  merek: "",
  model: "",
  serial_number: "",
  spesifikasi: "",
  tanggal_beli: "",
  harga_beli: "",
  kondisi: "Baik",
  status: "Aktif",
  lokasi_id: null,
  catatan: "",
};

const emptyAssignmentForm: AssignmentFormState = {
  pegawai_id: "",
  division_id: "",
  lokasi_id: "",
  catatan: "",
};

function formatRupiah(value?: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function formatTanggal(date?: string | null): string {
  if (!date) return "-";
  return new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function uploadAssetPhoto(assetId: number, file: File) {
  const timestamp = Date.now();
  const path = `asset-photos/${assetId}/${timestamp}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(ASSET_PHOTO_BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  const { data } = await supabase.storage.from(ASSET_PHOTO_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  const signedUrl = data?.signedUrl || "";
  return { foto_url: signedUrl, foto_path: path };
}

async function getSignedPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(ASSET_PHOTO_BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function parseRupiahInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

const MAX_HARGA_BELI = 999_999_999_999;

function formatRupiahInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  // Hapus leading zero berlebih (sisakan 0 tunggal bila hanya 0)
  const normalized = digits.replace(/^0+(?=\d)/, "");
  if (!normalized) return "0";
  // Batasi agar tidak melebihi numeric(14,2) secara visual
  const capped = normalized.length > 12 ? normalized.slice(0, 12) : normalized;
  return capped.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatRupiahForDisplay(value: string): string {
  return formatRupiahInput(value);
}

function normalizeAssetName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function formatDistinctList(values: string[], max = 3): string {
  const cleaned = values.filter((v) => v && v !== "-");
  const unique = [...new Set(cleaned)];
  if (unique.length === 0) return "-";
  if (unique.length <= max) return unique.join(", ");
  return `${unique.slice(0, max).join(", ")} +${unique.length - max}`;
}

function formatHargaPerUnit(min: number | null, max: number | null, missingCount: number, totalCount: number): string {
  if (missingCount === totalCount) return "Belum ada harga";
  if (min == null || max == null) return "-";
  if (min === max) return formatRupiah(min);
  return `${formatRupiah(min)} – ${formatRupiah(max)}`;
}

type GroupedAsset = {
  key: string;
  displayName: string;
  assets: DbGaAsset[];
  count: number;
  totalNilai: number;
  minHarga: number | null;
  maxHarga: number | null;
  missingPriceCount: number;
  categories: string[];
  distinctMerek: string[];
  distinctModel: string[];
  merekModelLabel: string;
  locations: string[];
  statusCounts: Record<AssetStatus, number>;
  statusLabel: string;
  kodeSample: string;
};

export default function InventoryAsetPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("inventory-aset");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AssetStatus | "Semua">("Semua");
  const [kondisiFilter, setKondisiFilter] = useState<Kondisi | "Semua">("Semua");
  const [categoryFilter, setCategoryFilter] = useState<string>("Semua");
  const [locationFilter, setLocationFilter] = useState<string>("Semua");
  const [assignedFilter, setAssignedFilter] = useState<"Semua" | "Ditempatkan" | "Belum Ditempatkan">("Semua");
  const [page, setPage] = useState(1);

  const [assets, setAssets] = useState<DbGaAsset[]>([]);
  const [categories, setCategories] = useState<DbGaAssetCategory[]>([]);
  const [locations, setLocations] = useState<DbGaAssetLocation[]>([]);
  const [assignments, setAssignments] = useState<DbGaAssetAssignment[]>([]);
  const [pegawaiList, setPegawaiList] = useState<{ id: string; nama: string }[]>([]);
  const [divisionList, setDivisionList] = useState<{ id: number; nama: string }[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [removePhoto, setRemovePhoto] = useState(false);
  const batchQuantity = editingId ? 1 : Number(form.jumlah_item) || 0;
  const isBatchCreate = !editingId && batchQuantity > 1;

  const [viewMode, setViewMode] = useState<"laporan" | "unit">("laporan");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [detailAsset, setDetailAsset] = useState<DbGaAsset | null>(null);
  const [detailSignedUrl, setDetailSignedUrl] = useState<string | null>(null);

  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showLocationManager, setShowLocationManager] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState({ nama: "", kode_prefix: "", deskripsi: "" });
  const [locationDraft, setLocationDraft] = useState({ nama: "", alamat: "", keterangan: "" });
  const [masterSaving, setMasterSaving] = useState(false);
  const [masterError, setMasterError] = useState("");

  const [assignmentAsset, setAssignmentAsset] = useState<DbGaAsset | null>(null);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(emptyAssignmentForm);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; kode: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; label: string } | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({
    show: false,
    title: "",
    message: "",
    type: "success",
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (showForm || detailAsset || deleteConfirm || assignmentAsset || showCategoryManager || showLocationManager || previewMedia) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm, detailAsset, deleteConfirm, assignmentAsset, showCategoryManager, showLocationManager, previewMedia]);

  useEffect(() => {
    return () => { if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview); };
  }, [photoPreview]);

  const resetPhotoState = useCallback((preview = "") => {
    setPhotoFile(null);
    setPhotoPreview(preview);
    setRemovePhoto(false);
  }, []);

  const handlePhotoSelect = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setFormError("Foto aset harus berupa file gambar."); return; }
    if (file.size > MAX_FILE_SIZE) { setFormError("Ukuran foto maksimal 5 MB."); return; }
    setFormError("");
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setRemovePhoto(false);
  };

  const handleBatchQuantityChange = (value: string) => {
    const digits = value.replace(/\D/g, "");
    const quantity = digits ? Math.min(Number(digits), MAX_BATCH_QUANTITY) : 0;
    setForm((current) => ({
      ...current,
      jumlah_item: quantity ? String(quantity) : "",
      serial_number: quantity > 1 ? "" : current.serial_number,
    }));
    if (quantity > 1) resetPhotoState();
  };

  const fetchAll = useCallback(async () => {
    const [{ data: catData }, { data: locData }, { data: assetData }, { data: assignData }, { data: pegData }, { data: divData }] =
      await Promise.all([
        supabase.from("ga_asset_categories").select("*").order("sort_order"),
        supabase.from("ga_asset_locations").select("*").order("sort_order"),
        supabase.from("ga_assets").select("*, ga_asset_categories(id, nama, kode_prefix), ga_asset_locations(id, nama)").order("kode_aset"),
        supabase.from("ga_asset_assignments").select("*").order("created_at", { ascending: false }),
        supabase.from("pegawai").select("id, nama").eq("status", "Aktif").order("nama"),
        supabase.from("divisions").select("id, nama").order("nama"),
      ]);
    if (catData) setCategories(catData as DbGaAssetCategory[]);
    if (locData) setLocations(locData as DbGaAssetLocation[]);
    if (assetData) setAssets(assetData as DbGaAsset[]);
    if (assignData) setAssignments(assignData as DbGaAssetAssignment[]);
    if (pegData) setPegawaiList(pegData as { id: string; nama: string }[]);
    if (divData) setDivisionList(divData as { id: number; nama: string }[]);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchAll();
      setLoading(false);
    })();
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!detailAsset?.foto_path) { setDetailSignedUrl(null); return; }
      const url = await getSignedPhotoUrl(detailAsset.foto_path);
      if (!cancelled) setDetailSignedUrl(url || detailAsset.foto_url || null);
    })();
    return () => { cancelled = true; };
  }, [detailAsset]);

  const activeAssignmentByAsset = useMemo(() => {
    const map = new Map<number, DbGaAssetAssignment>();
    for (const a of assignments) if (a.status === "Aktif" && !map.has(a.asset_id)) map.set(a.asset_id, a);
    return map;
  }, [assignments]);

  const assignmentsByAsset = useMemo(() => {
    const map = new Map<number, DbGaAssetAssignment[]>();
    for (const a of assignments) {
      if (!map.has(a.asset_id)) map.set(a.asset_id, []);
      map.get(a.asset_id)!.push(a);
    }
    return map;
  }, [assignments]);

  const filteredAssets = useMemo(() => {
    const q = search.toLowerCase().trim();
    return assets.filter((a) => {
      const catName = a.ga_asset_categories?.nama || "";
      const locName = a.ga_asset_locations?.nama || "";
      const matchSearch = !q
        || a.kode_aset.toLowerCase().includes(q)
        || a.nama_aset.toLowerCase().includes(q)
        || (a.merek || "").toLowerCase().includes(q)
        || (a.model || "").toLowerCase().includes(q)
        || (a.serial_number || "").toLowerCase().includes(q)
        || catName.toLowerCase().includes(q)
        || locName.toLowerCase().includes(q);
      const matchStatus = statusFilter === "Semua" || a.status === statusFilter;
      const matchKondisi = kondisiFilter === "Semua" || a.kondisi === kondisiFilter;
      const matchCategory = categoryFilter === "Semua" || String(a.category_id) === categoryFilter;
      const matchLocation = locationFilter === "Semua" || String(a.lokasi_id || "") === locationFilter;
      const hasAssignment = activeAssignmentByAsset.has(a.id);
      const matchAssigned = assignedFilter === "Semua"
        || (assignedFilter === "Ditempatkan" && hasAssignment)
        || (assignedFilter === "Belum Ditempatkan" && !hasAssignment);
      return matchSearch && matchStatus && matchKondisi && matchCategory && matchLocation && matchAssigned;
    });
  }, [assets, search, statusFilter, kondisiFilter, categoryFilter, locationFilter, assignedFilter, activeAssignmentByAsset]);

  const pagedAssets = useMemo(() => filteredAssets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredAssets, page]);

  const summary = useMemo(() => {
    const total = assets.length;
    const aktif = assets.filter((a) => a.status === "Aktif").length;
    const rusak = assets.filter((a) => a.status === "Rusak").length;
    const tidakAktif = assets.filter((a) => a.status === "Tidak Aktif").length;
    const ditempatkan = activeAssignmentByAsset.size;
    const belumDitempatkan = Math.max(0, aktif - ditempatkan);
    const totalNilaiCompany = assets.reduce((sum, a) => sum + (a.harga_beli || 0), 0);
    const tanpaHargaCompany = assets.filter((a) => a.harga_beli == null).length;
    const totalUnitPerusahaan = total;
    return { total, aktif, rusak, tidakAktif, ditempatkan, belumDitempatkan, totalNilaiCompany, tanpaHargaCompany, totalUnitPerusahaan };
  }, [assets, activeAssignmentByAsset]);

  const groupedRows = useMemo<GroupedAsset[]>(() => {
    const map = new Map<string, DbGaAsset[]>();
    for (const a of filteredAssets) {
      const key = normalizeAssetName(a.nama_aset);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    const rows: GroupedAsset[] = [];
    for (const [key, list] of map.entries()) {
      const count = list.length;
      const totalNilai = list.reduce((s, x) => s + (x.harga_beli || 0), 0);
      const hargaList = list.map((x) => x.harga_beli).filter((v): v is number => v != null);
      const minHarga = hargaList.length ? Math.min(...hargaList) : null;
      const maxHarga = hargaList.length ? Math.max(...hargaList) : null;
      const missingPriceCount = list.filter((x) => x.harga_beli == null).length;
      const categories = [...new Set(list.map((x) => x.ga_asset_categories?.nama || "-"))];
      const distinctMerek = [...new Set(list.map((x) => (x.merek || "").trim()).filter(Boolean))];
      const distinctModel = [...new Set(list.map((x) => (x.model || "").trim()).filter(Boolean))];
      const merekModelPairs = [...new Set(list.map((x) => {
        const merek = (x.merek || "").trim();
        const model = (x.model || "").trim();
        if (merek && model) return `${merek} / ${model}`;
        if (merek) return merek;
        if (model) return model;
        return "-";
      }))];
      const merekModelLabel = formatDistinctList(merekModelPairs, 2);
      const locations = [...new Set(list.map((x) => x.ga_asset_locations?.nama || "-"))];
      const statusCounts = list.reduce((acc, x) => {
        const s = x.status as AssetStatus;
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {} as Record<AssetStatus, number>);
      const statusLabel = (["Aktif", "Rusak", "Tidak Aktif"] as AssetStatus[])
        .filter((s) => statusCounts[s])
        .map((s) => `${s} ${statusCounts[s]}`)
        .join(" • ") || "-";
      const displayName = list[0].nama_aset.trim().replace(/\s+/g, " ");
      const sortedKode = [...list].sort((a, b) => a.kode_aset.localeCompare(b.kode_aset)).map((x) => x.kode_aset);
      const kodeSample = sortedKode.length <= 3 ? sortedKode.join(", ") : `${sortedKode.slice(0, 2).join(", ")} +${sortedKode.length - 2}`;
      rows.push({
        key,
        displayName,
        assets: [...list].sort((a, b) => a.kode_aset.localeCompare(b.kode_aset)),
        count,
        totalNilai,
        minHarga,
        maxHarga,
        missingPriceCount,
        categories,
        distinctMerek,
        distinctModel,
        merekModelLabel,
        locations,
        statusCounts,
        statusLabel,
        kodeSample,
      });
    }
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "id"));
  }, [filteredAssets]);

  const pagedGroups = useMemo(() => groupedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [groupedRows, page]);

  const filteredSummary = useMemo(() => {
    const totalUnit = filteredAssets.length;
    const totalNilai = filteredAssets.reduce((s, a) => s + (a.harga_beli || 0), 0);
    const tanpaHarga = filteredAssets.filter((a) => a.harga_beli == null).length;
    const groupCount = groupedRows.length;
    const totalNilaiCompany = summary.totalNilaiCompany;
    return { totalUnit, totalNilai, tanpaHarga, groupCount, totalNilaiCompany };
  }, [filteredAssets, groupedRows, summary.totalNilaiCompany]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError("");
    resetPhotoState();
    setShowForm(true);
  };

  const openEdit = (a: DbGaAsset) => {
    setForm({
      jumlah_item: "1",
      category_id: a.category_id,
      nama_aset: a.nama_aset,
      merek: a.merek || "",
      model: a.model || "",
      serial_number: a.serial_number || "",
      spesifikasi: a.spesifikasi || "",
      tanggal_beli: a.tanggal_beli || "",
      harga_beli: a.harga_beli != null ? formatRupiahForDisplay(String(a.harga_beli)) : "",
      kondisi: a.kondisi as Kondisi,
      status: a.status as AssetStatus,
      lokasi_id: a.lokasi_id,
      catatan: a.catatan || "",
    });
    setEditingId(a.id);
    setFormError("");
    resetPhotoState(a.foto_url || "");
    setShowForm(true);
  };

  const openAssign = (asset: DbGaAsset) => {
    const active = activeAssignmentByAsset.get(asset.id);
    setAssignmentAsset(asset);
    setAssignmentForm({
      pegawai_id: active?.pegawai_id || "",
      division_id: active?.division_id ? String(active.division_id) : "",
      lokasi_id: String(asset.lokasi_id || active?.lokasi_id || locations[0]?.id || ""),
      catatan: "",
    });
    setAssignmentError("");
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.category_id) { setFormError("Kategori wajib dipilih."); return; }
    if (!form.nama_aset.trim()) { setFormError("Nama aset wajib diisi."); return; }
    if (!form.lokasi_id) { setFormError("Lokasi wajib dipilih."); return; }
    const jumlahItem = editingId ? 1 : Number(form.jumlah_item);
    if (!Number.isInteger(jumlahItem) || jumlahItem < 1 || jumlahItem > MAX_BATCH_QUANTITY) {
      setFormError(`Jumlah item harus antara 1 dan ${MAX_BATCH_QUANTITY}.`);
      return;
    }
    if (jumlahItem > 1 && photoFile) { setFormError("Foto hanya dapat diupload saat menambah satu aset."); return; }
    const hargaNum = parseRupiahInput(form.harga_beli);
    if (form.harga_beli && hargaNum == null) { setFormError("Harga beli tidak valid."); return; }
    if (hargaNum != null && hargaNum < 0) { setFormError("Harga beli tidak boleh negatif."); return; }
    if (hargaNum != null && hargaNum > MAX_HARGA_BELI) { setFormError(`Harga beli maksimal ${formatRupiah(MAX_HARGA_BELI)}.`); return; }

    setFormSaving(true);
    try {
      if (editingId) {
        const { data: oldRow } = await supabase.from("ga_assets").select("*").eq("id", editingId).maybeSingle();
        const oldAsset = oldRow as DbGaAsset | null;
        let finalPayload: Record<string, unknown> = {
          category_id: form.category_id,
          nama_aset: form.nama_aset.trim(),
          merek: form.merek.trim() || null,
          model: form.model.trim() || null,
          serial_number: form.serial_number.trim() || null,
          spesifikasi: form.spesifikasi.trim() || null,
          tanggal_beli: form.tanggal_beli || null,
          harga_beli: hargaNum,
          kondisi: form.kondisi,
          status: form.status,
          lokasi_id: form.lokasi_id,
          catatan: form.catatan.trim() || null,
        };
        let newPhotoPath: string | null = null;
        let photoAdded = false, photoReplaced = false, photoRemoved = false;

        if (photoFile) {
          const uploaded = await uploadAssetPhoto(editingId, photoFile);
          newPhotoPath = uploaded.foto_path;
          finalPayload = { ...finalPayload, ...uploaded };
          photoAdded = !oldAsset?.foto_path;
          photoReplaced = Boolean(oldAsset?.foto_path);
        } else if (removePhoto && oldAsset?.foto_path) {
          finalPayload = { ...finalPayload, foto_url: null, foto_path: null };
          photoRemoved = true;
        }

        const { error } = await supabase.from("ga_assets").update(finalPayload).eq("id", editingId);
        if (error) {
          if (newPhotoPath) await supabase.storage.from(ASSET_PHOTO_BUCKET).remove([newPhotoPath]);
          if (error.message.toLowerCase().includes("unique") || error.message.toLowerCase().includes("duplicate")) setFormError("Kode aset bentrok. Coba simpan ulang.");
          else setFormError(error.message);
          setFormSaving(false);
          return;
        }

        if ((photoReplaced || photoRemoved) && oldAsset?.foto_path) {
          await supabase.storage.from(ASSET_PHOTO_BUCKET).remove([oldAsset.foto_path]);
        }

        await logAudit({
          supabase, action: "update", entityType: "ga_assets", entityId: String(editingId),
          entityLabel: (oldAsset?.kode_aset || finalPayload.nama_aset) as string,
          oldData: oldRow as Record<string, unknown>,
          newData: finalPayload,
          metadata: { photo_added: photoAdded, photo_replaced: photoReplaced, photo_removed: photoRemoved },
        });
        showToast("success", "Aset Diperbarui", `${(oldAsset?.kode_aset || "").toString()} berhasil diperbarui.`);
      } else {
        const payload: Record<string, unknown> = {
          nama_aset: form.nama_aset.trim(),
          category_id: form.category_id,
          merek: form.merek.trim() || null,
          model: form.model.trim() || null,
          serial_number: jumlahItem === 1 ? form.serial_number.trim() || null : null,
          spesifikasi: form.spesifikasi.trim() || null,
          tanggal_beli: form.tanggal_beli || null,
          harga_beli: hargaNum,
          kondisi: form.kondisi,
          status: form.status,
          lokasi_id: form.lokasi_id,
          catatan: form.catatan.trim() || null,
        };

        const { data: insertedData, error } = await supabase.rpc("create_ga_assets_batch", {
          p_category_id: form.category_id,
          p_nama_aset: payload.nama_aset,
          p_jumlah: jumlahItem,
          p_merek: payload.merek,
          p_model: payload.model,
          p_serial_number: payload.serial_number,
          p_spesifikasi: payload.spesifikasi,
          p_tanggal_beli: payload.tanggal_beli,
          p_harga_beli: payload.harga_beli,
          p_kondisi: payload.kondisi,
          p_status: payload.status,
          p_lokasi_id: payload.lokasi_id,
          p_catatan: payload.catatan,
        });
        const inserted = (insertedData || []) as { asset_id: number; kode_aset: string }[];
        if (error || inserted.length !== jumlahItem) {
          if (error?.message.toLowerCase().includes("unique")) setFormError("Kode aset bentrok. Coba simpan ulang.");
          else setFormError(error?.message || "Jumlah aset yang tersimpan tidak sesuai. Seluruh proses dibatalkan.");
          setFormSaving(false);
          return;
        }

        const firstAsset = inserted[0];
        const lastAsset = inserted[inserted.length - 1];
        let photoPayload: { foto_url: string; foto_path: string } | null = null;
        let photoWarning = "";
        if (photoFile && jumlahItem === 1) {
          try {
            const uploaded = await uploadAssetPhoto(firstAsset.asset_id, photoFile);
            const { error: photoUpdateError } = await supabase.from("ga_assets").update(uploaded).eq("id", firstAsset.asset_id);
            if (photoUpdateError) {
              await supabase.storage.from(ASSET_PHOTO_BUCKET).remove([uploaded.foto_path]);
              photoWarning = ` Foto gagal disimpan: ${photoUpdateError.message}`;
            } else photoPayload = uploaded;
          } catch (photoErr) {
            photoWarning = ` Foto gagal diupload: ${photoErr instanceof Error ? photoErr.message : "Terjadi kesalahan."}`;
          }
        }

        await logAudit({
          supabase, action: "create", entityType: "ga_assets", entityId: String(firstAsset.asset_id),
          entityLabel: jumlahItem === 1 ? firstAsset.kode_aset : `${firstAsset.kode_aset} - ${lastAsset.kode_aset}`,
          newData: { ...payload, ...(photoPayload || {}) },
          metadata: {
            quantity: jumlahItem,
            asset_ids: inserted.map((item) => item.asset_id),
            asset_codes: inserted.map((item) => item.kode_aset),
            photo_added: Boolean(photoPayload),
          },
        });
        showToast(
          "success",
          jumlahItem === 1 ? "Aset Ditambahkan" : `${jumlahItem} Aset Ditambahkan`,
          jumlahItem === 1
            ? `${firstAsset.kode_aset} berhasil disimpan.${photoWarning}`
            : `${firstAsset.kode_aset} sampai ${lastAsset.kode_aset} berhasil dibuat sebagai aset individual.`,
        );
      }
      setShowForm(false);
      resetPhotoState();
      await fetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    if (assignmentsByAsset.get(deleteConfirm.id)?.length) {
      showToast("error", "Tidak Bisa Hapus", "Aset dengan riwayat penempatan tidak boleh dihapus. Nonaktifkan saja.");
      return;
    }
    setDeleting(true);
    const { data: oldRow } = await supabase.from("ga_assets").select("*").eq("id", deleteConfirm.id).maybeSingle();
    const { error } = await supabase.from("ga_assets").delete().eq("id", deleteConfirm.id);
    if (error) { showToast("error", "Gagal Menghapus", error.message); setDeleting(false); return; }
    const oldPhotoPath = (oldRow as DbGaAsset | null)?.foto_path;
    if (oldPhotoPath) await supabase.storage.from(ASSET_PHOTO_BUCKET).remove([oldPhotoPath]);
    await logAudit({
      supabase, action: "delete", entityType: "ga_assets", entityId: String(deleteConfirm.id),
      entityLabel: deleteConfirm.kode, oldData: oldRow as Record<string, unknown>,
    });
    showToast("success", "Aset Dihapus", `${deleteConfirm.kode} berhasil dihapus.`);
    setDeleting(false);
    setDeleteConfirm(null);
    await fetchAll();
  };

  const handleTransfer = async () => {
    if (!assignmentAsset) return;
    setAssignmentError("");
    if (!assignmentForm.lokasi_id) { setAssignmentError("Lokasi penempatan wajib dipilih."); return; }
    setAssignmentSaving(true);
    try {
      const { error } = await supabase.rpc("transfer_ga_asset", {
        p_asset_id: assignmentAsset.id,
        p_pegawai_id: assignmentForm.pegawai_id || null,
        p_division_id: assignmentForm.division_id ? Number(assignmentForm.division_id) : null,
        p_lokasi_id: Number(assignmentForm.lokasi_id),
        p_catatan: assignmentForm.catatan || null,
      });
      if (error) { setAssignmentError(error.message); setAssignmentSaving(false); return; }
      await logAudit({
        supabase, action: "update", entityType: "ga_asset_assignments", entityId: String(assignmentAsset.id),
        entityLabel: assignmentAsset.kode_aset,
        newData: assignmentForm as unknown as Record<string, unknown>,
        metadata: { action: "transfer" },
      });
      showToast("success", "Penempatan Disimpan", `${assignmentAsset.kode_aset} berhasil ditempatkan.`);
      setAssignmentAsset(null);
      await fetchAll();
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setAssignmentSaving(false);
    }
  };

  const handleReturn = async () => {
    if (!assignmentAsset) return;
    setAssignmentError("");
    setAssignmentSaving(true);
    try {
      const { error } = await supabase.rpc("return_ga_asset", { p_asset_id: assignmentAsset.id, p_catatan: assignmentForm.catatan || null });
      if (error) { setAssignmentError(error.message); setAssignmentSaving(false); return; }
      await logAudit({
        supabase, action: "update", entityType: "ga_asset_assignments", entityId: String(assignmentAsset.id),
        entityLabel: assignmentAsset.kode_aset,
        metadata: { action: "return" },
      });
      showToast("success", "Aset Dikembalikan", `${assignmentAsset.kode_aset} berhasil dikembalikan.`);
      setAssignmentAsset(null);
      await fetchAll();
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setAssignmentSaving(false);
    }
  };

  const handleCreateCategory = async () => {
    setMasterError("");
    if (!categoryDraft.nama.trim()) { setMasterError("Nama kategori wajib diisi."); return; }
    if (!/^[A-Z0-9]{2,10}$/.test(categoryDraft.kode_prefix.trim().toUpperCase())) { setMasterError("Prefix harus 2-10 karakter A-Z/0-9."); return; }
    setMasterSaving(true);
    const { error } = await supabase.from("ga_asset_categories").insert({
      nama: categoryDraft.nama.trim(),
      kode_prefix: categoryDraft.kode_prefix.trim().toUpperCase(),
      deskripsi: categoryDraft.deskripsi.trim() || null,
    });
    if (error) setMasterError(error.message);
    else {
      setCategoryDraft({ nama: "", kode_prefix: "", deskripsi: "" });
      await fetchAll();
      showToast("success", "Kategori Ditambahkan", categoryDraft.nama.trim());
    }
    setMasterSaving(false);
  };

  const handleCreateLocation = async () => {
    setMasterError("");
    if (!locationDraft.nama.trim()) { setMasterError("Nama lokasi wajib diisi."); return; }
    setMasterSaving(true);
    const { error } = await supabase.from("ga_asset_locations").insert({
      nama: locationDraft.nama.trim(),
      alamat: locationDraft.alamat.trim() || null,
      keterangan: locationDraft.keterangan.trim() || null,
    });
    if (error) setMasterError(error.message);
    else {
      setLocationDraft({ nama: "", alamat: "", keterangan: "" });
      await fetchAll();
      showToast("success", "Lokasi Ditambahkan", locationDraft.nama.trim());
    }
    setMasterSaving(false);
  };

  const toggleCategoryStatus = async (c: DbGaAssetCategory) => {
    const next = c.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    const { error } = await supabase.from("ga_asset_categories").update({ status: next }).eq("id", c.id);
    if (!error) fetchAll();
  };

  const toggleLocationStatus = async (l: DbGaAssetLocation) => {
    const next = l.status === "Aktif" ? "Tidak Aktif" : "Aktif";
    const { error } = await supabase.from("ga_asset_locations").update({ status: next }).eq("id", l.id);
    if (!error) fetchAll();
  };

  const handleExportPdf = async () => {
    const isLaporan = viewMode === "laporan";
    const hasData = isLaporan ? groupedRows.length > 0 : filteredAssets.length > 0;
    if (!hasData) { showToast("error", "Tidak Ada Data", "Tidak ada aset yang cocok dengan filter."); return; }
    setPdfExporting(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();

      doc.setFillColor(59, 130, 246);
      doc.rect(14, 10, pw - 28, 1.5, "F");
      doc.setFontSize(18);
      doc.setTextColor(30);
      doc.setFont("helvetica", "bold");
      doc.text(isLaporan ? "Laporan Ringkas Aset" : "Inventory Aset", 14, 22);
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont("helvetica", "normal");
      doc.text(`General Affair — ${new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} • Nilai perusahaan: ${formatRupiah(summary.totalNilaiCompany)}`, 14, 30);
      doc.text(isLaporan ? `${groupedRows.length} jenis • ${filteredAssets.length} unit` : `${filteredAssets.length} aset`, pw - 14, 22, { align: "right" });

      const totalHarga = filteredAssets.reduce((sum, a) => sum + (a.harga_beli || 0), 0);
      const cardItems = isLaporan
        ? [
            { label: "Jenis Aset", value: String(groupedRows.length), tc: [59, 130, 246], bg: [235, 245, 255] },
            { label: "Total Unit", value: String(filteredAssets.length), tc: [34, 197, 94], bg: [235, 255, 240] },
            { label: "Tanpa Harga", value: String(filteredAssets.filter((a) => a.harga_beli == null).length), tc: [245, 158, 11], bg: [255, 250, 235] },
            { label: "Subtotal Nilai", value: formatRupiah(totalHarga), tc: [15, 118, 110], bg: [240, 253, 250] },
            { label: "Nilai Perusahaan", value: formatRupiah(summary.totalNilaiCompany), tc: [13, 110, 110], bg: [230, 255, 250] },
          ]
        : [
            { label: "Total Aset", value: String(filteredAssets.length), tc: [59, 130, 246], bg: [235, 245, 255] },
            { label: "Aktif", value: String(filteredAssets.filter((a) => a.status === "Aktif").length), tc: [34, 197, 94], bg: [235, 255, 240] },
            { label: "Rusak", value: String(filteredAssets.filter((a) => a.status === "Rusak").length), tc: [245, 158, 11], bg: [255, 250, 235] },
            { label: "Tidak Aktif", value: String(filteredAssets.filter((a) => a.status === "Tidak Aktif").length), tc: [120, 120, 120], bg: [245, 247, 250] },
            { label: "Total Nilai", value: formatRupiah(totalHarga), tc: [15, 118, 110], bg: [240, 253, 250] },
          ];
      const cardW = (pw - 28 - 12) / 5;
      const cardY = 36;
      cardItems.forEach((c, i) => {
        const x = 14 + i * (cardW + 3);
        doc.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
        doc.setDrawColor(210);
        doc.roundedRect(x, cardY, cardW, 14, 2, 2, "FD");
        doc.setFontSize(7);
        doc.setTextColor(100);
        doc.setFont("helvetica", "normal");
        doc.text(c.label, x + 3, cardY + 5);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(c.tc[0], c.tc[1], c.tc[2]);
        doc.text(c.value, x + 3, cardY + 12);
      });

      let cursorY = cardY + 22;
      const chips: string[] = [];
      chips.push(isLaporan ? "Mode: Laporan Ringkas (Nama Aset saja)" : "Mode: Per Unit");
      if (search) chips.push(`Cari: "${search}"`);
      if (statusFilter !== "Semua") chips.push(`Status: ${statusFilter}`);
      if (kondisiFilter !== "Semua") chips.push(`Kondisi: ${kondisiFilter}`);
      if (categoryFilter !== "Semua") chips.push(`Kategori: ${categories.find((c) => String(c.id) === categoryFilter)?.nama || categoryFilter}`);
      if (locationFilter !== "Semua") chips.push(`Lokasi: ${locations.find((l) => String(l.id) === locationFilter)?.nama || locationFilter}`);
      if (assignedFilter !== "Semua") chips.push(`Penempatan: ${assignedFilter}`);
      doc.setFillColor(245, 247, 250);
      doc.setDrawColor(210);
      doc.roundedRect(14, cursorY, pw - 28, 7, 2, 2, "FD");
      doc.setFontSize(7);
      doc.setTextColor(90);
      doc.setFont("helvetica", "normal");
      doc.text(chips.join("    "), 18, cursorY + 4.5);
      cursorY += 11;

      let headers: string[] = [];
      let colWidths: number[] = [];
      let rows: string[][] = [];
      if (isLaporan) {
        headers = ["No", "Nama Aset", "Kategori", "Merek / Model", "Jumlah", "Status", "Lokasi", "Harga Satuan", "Total Nilai"];
        colWidths = [8, 44, 28, 36, 14, 32, 28, 34, 34];
        rows = groupedRows.map((g, i) => [
          String(i + 1),
          g.displayName,
          formatDistinctList(g.categories),
          g.merekModelLabel,
          String(g.count),
          g.statusLabel,
          formatDistinctList(g.locations),
          formatHargaPerUnit(g.minHarga, g.maxHarga, g.missingPriceCount, g.count),
          formatRupiah(g.totalNilai),
        ]);
      } else {
        headers = ["No", "Kode", "Nama Aset", "Kategori", "Merek", "Serial", "Tanggal Beli", "Harga", "Kondisi", "Status", "Lokasi", "Penempatan"];
        colWidths = [8, 18, 40, 24, 22, 24, 22, 24, 20, 18, 24, 28];
        rows = filteredAssets.map((a, i) => {
          const cat = a.ga_asset_categories?.nama || "-";
          const loc = a.ga_asset_locations?.nama || "-";
          const assign = activeAssignmentByAsset.get(a.id);
          const placement = assign ? `${assign.pegawai_nama || assign.divisi_nama || assign.lokasi_nama || "-"} @ ${assign.lokasi_nama || "-"}` : "-";
          return [
            String(i + 1),
            a.kode_aset,
            a.nama_aset,
            cat,
            a.merek || "-",
            a.serial_number || "-",
            formatTanggal(a.tanggal_beli),
            a.harga_beli != null ? formatRupiah(a.harga_beli) : "-",
            a.kondisi,
            a.status,
            loc,
            placement,
          ];
        });
      }

      autoTable(doc, {
        head: [headers],
        body: rows,
        startY: cursorY,
        columnStyles: Object.fromEntries(colWidths.map((w, i) => [i, { cellWidth: w }])),
        styles: { fontSize: 6.5, cellPadding: 1.5, valign: "middle", lineColor: [220, 220, 220], lineWidth: 0.1 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold", fontSize: 6.5 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14, bottom: 14 },
      });

      // Footer per mode dengan total nilai perusahaan tetap
      const footerY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      doc.setFontSize(7);
      doc.setTextColor(90);
      doc.setFont("helvetica", "normal");
      if (isLaporan) {
        doc.text(`Subtotal terfilter: ${filteredAssets.length} unit • ${groupedRows.length} jenis • ${formatRupiah(totalHarga)}${filteredSummary.tanpaHarga ? ` • ${filteredSummary.tanpaHarga} tanpa harga` : ""}`, 14, footerY);
        doc.text(`Nilai perusahaan (semua status): ${formatRupiah(summary.totalNilaiCompany)}`, 14, footerY + 4);
      }

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(200);
        doc.line(14, ph - 12, pw - 14, ph - 12);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text("HRM System — General Affair / Inventory Aset", 14, ph - 6);
        doc.text(`Halaman ${i} dari ${pageCount}`, pw - 14, ph - 6, { align: "right" });
      }
      doc.save(`inventory_aset_${isLaporan ? "laporan_ringkas" : "per_unit"}_${new Date().toISOString().slice(0, 10)}.pdf`);
      const exportedCount = isLaporan ? groupedRows.length : filteredAssets.length;
      showToast("success", "Export Berhasil", `${exportedCount} ${isLaporan ? "jenis" : "aset"} diexport ke PDF (${isLaporan ? "Laporan Ringkas" : "Per Unit"}).`);
      await logAudit({ supabase, action: "export", entityType: "ga_assets", entityLabel: `Export ${exportedCount} ${isLaporan ? "jenis" : "aset"} (${isLaporan ? "ringkas" : "unit"})`, metadata: { count: exportedCount, mode: isLaporan ? "laporan" : "unit", totalHarga, nilaiPerusahaan: summary.totalNilaiCompany } });
    } catch (err) {
      showToast("error", "Gagal Export", err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setPdfExporting(false);
    }
  };

  const renderAssetCard = (asset: DbGaAsset) => {
    const assign = activeAssignmentByAsset.get(asset.id);
    const catName = asset.ga_asset_categories?.nama || "-";
    const locName = asset.ga_asset_locations?.nama || "-";
    return (
      <div key={asset.id} className="bg-card rounded-3xl border border-border overflow-hidden hover:shadow-md transition-shadow flex flex-col">
        <div className="h-36 bg-muted/30 flex items-center justify-center overflow-hidden">
          {asset.foto_url ? (
            <img src={asset.foto_url} alt={asset.nama_aset} className="w-full h-full object-cover" />
          ) : (
            <Package className="w-10 h-10 text-muted-foreground/30" />
          )}
        </div>
        <div className="p-4 space-y-3 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-primary font-mono">{asset.kode_aset}</p>
              <p className="text-sm font-bold text-foreground truncate">{asset.nama_aset}</p>
              <p className="text-[11px] text-muted-foreground truncate">{catName} • {asset.merek || "-"} {asset.model ? `/ ${asset.model}` : ""}</p>
            </div>
            <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold border", statusStyle[asset.status as AssetStatus])}>{asset.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-xl bg-muted/40 px-2.5 py-2">
              <p className="text-muted-foreground">Kondisi</p>
              <p className={cn("inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold mt-1", kondisiStyle[asset.kondisi as Kondisi])}>{asset.kondisi}</p>
            </div>
            <div className="rounded-xl bg-muted/40 px-2.5 py-2">
              <p className="text-muted-foreground">Lokasi</p>
              <p className="font-semibold text-foreground truncate">{locName}</p>
            </div>
          </div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p className="flex items-center gap-1"><Hash className="w-3 h-3" /> SN: <span className="text-foreground font-medium truncate">{asset.serial_number || "-"}</span></p>
            <p className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Beli: <span className="text-foreground">{formatTanggal(asset.tanggal_beli)}</span></p>
            <p className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> Harga: <span className="text-foreground">{formatRupiah(asset.harga_beli)}</span></p>
            <p className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3" /> Ditempatkan: <span className="text-foreground truncate">{assign ? `${assign.pegawai_nama || assign.divisi_nama || "-"} @ ${assign.lokasi_nama}` : "Belum ditempatkan"}</span></p>
          </div>
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => setDetailAsset(asset)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Detail"><Eye className="w-4 h-4" /></button>
            {canEdit && <button onClick={() => openEdit(asset)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="w-4 h-4" /></button>}
            {canEdit && <button onClick={() => openAssign(asset)} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary" title="Penempatan"><ArrowRightLeft className="w-4 h-4" /></button>}
          </div>
          {canEdit && (
            <button onClick={() => setDeleteConfirm({ id: asset.id, kode: asset.kode_aset })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus"><Trash2 className="w-4 h-4" /></button>
          )}
        </div>
      </div>
    );
  };

  return (
    <RouteGuard permission="inventory-aset">
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          title="Inventory Aset"
          description="Kelola aset per unit, penempatan, dan riwayat serah terima"
          icon={Package}
          actions={
            <div className="flex items-center gap-2">
              <Button icon={FileDown} variant="outline" size="sm" onClick={handleExportPdf} disabled={pdfExporting}>
                {pdfExporting ? "Export..." : "Export PDF"}
              </Button>
              {canEdit && <Button icon={Boxes} variant="outline" size="sm" onClick={() => setShowCategoryManager(true)}>Kategori</Button>}
              {canEdit && <Button icon={MapPin} variant="outline" size="sm" onClick={() => setShowLocationManager(true)}>Lokasi</Button>}
              {canInput && <Button icon={Plus} size="sm" onClick={openAdd}>Tambah Aset</Button>}
            </div>
          }
        />

        {toast.show && (
          <Portal>
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
              <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]", toast.type === "error" ? "border-danger/20" : "border-success/20")}>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
                  {toast.type === "error" ? <AlertTriangle className="w-5 h-5 text-danger" /> : <CircleCheckBig className="w-5 h-5 text-success" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{toast.title}</p>
                  {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
                </div>
                <button onClick={() => setToast({ show: false, title: "", message: "", type: "success" })} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </Portal>
        )}

        <div className="bg-gradient-to-br from-teal-600 to-cyan-600 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80 flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> Total Nilai Aset Perusahaan</p>
              <p className="text-2xl lg:text-3xl font-extrabold mt-1">{formatRupiah(summary.totalNilaiCompany)}</p>
              <p className="text-xs text-white/80 mt-1">Dari {summary.total} unit tercatat (semua status) • {summary.tanpaHargaCompany > 0 ? `${summary.tanpaHargaCompany} unit tanpa harga` : "Semua unit sudah ada harga"}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="bg-white/15 backdrop-blur rounded-xl px-4 py-3 min-w-[110px]">
                <p className="text-[10px] uppercase tracking-wider text-white/70">Total Unit</p>
                <p className="text-lg font-bold">{summary.total}</p>
              </div>
              <div className="bg-white/15 backdrop-blur rounded-xl px-4 py-3 min-w-[110px]">
                <p className="text-[10px] uppercase tracking-wider text-white/70">Jenis Aset</p>
                <p className="text-lg font-bold">{groupedRows.length} <span className="text-xs font-normal text-white/70">nama</span></p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="bg-card rounded-2xl border border-border p-4"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Aset</p><p className="text-xl font-bold text-foreground mt-1">{summary.total}</p><p className="text-[10px] text-muted-foreground mt-1">{summary.totalNilaiCompany ? formatRupiah(summary.totalNilaiCompany) : "-"}</p></div>
          <div className="bg-card rounded-2xl border border-border p-4"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Aktif</p><p className="text-xl font-bold text-success mt-1">{summary.aktif}</p></div>
          <div className="bg-card rounded-2xl border border-border p-4"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Rusak</p><p className="text-xl font-bold text-warning mt-1">{summary.rusak}</p></div>
          <div className="bg-card rounded-2xl border border-border p-4"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tidak Aktif</p><p className="text-xl font-bold text-muted-foreground mt-1">{summary.tidakAktif}</p></div>
          <div className="bg-card rounded-2xl border border-border p-4"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ditempatkan</p><p className="text-xl font-bold text-primary mt-1">{summary.ditempatkan}</p></div>
          <div className="bg-card rounded-2xl border border-border p-4"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Belum Ditempatkan</p><p className="text-xl font-bold text-warning mt-1">{summary.belumDitempatkan}</p><p className="text-[10px] text-muted-foreground mt-1">{summary.tanpaHargaCompany ? `${summary.tanpaHargaCompany} tanpa harga` : ""}</p></div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" placeholder="Cari kode, nama, merek, serial, kategori, lokasi..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
            </div>
            <Select value={categoryFilter} onChange={(v) => { setCategoryFilter(v); setPage(1); }} options={[{ value: "Semua", label: "Semua Kategori" }, ...categories.map((c) => ({ value: String(c.id), label: c.nama }))]} className="w-44" />
            <Select value={statusFilter} onChange={(v) => { setStatusFilter(v as AssetStatus | "Semua"); setPage(1); }} options={["Semua", "Aktif", "Rusak", "Tidak Aktif"].map((v) => ({ value: v, label: v === "Semua" ? "Semua Status" : v }))} className="w-40" />
            <Select value={kondisiFilter} onChange={(v) => { setKondisiFilter(v as Kondisi | "Semua"); setPage(1); }} options={["Semua", "Baik", "Rusak Ringan", "Rusak Berat"].map((v) => ({ value: v, label: v === "Semua" ? "Semua Kondisi" : v }))} className="w-44" />
            <Select value={locationFilter} onChange={(v) => { setLocationFilter(v); setPage(1); }} options={[{ value: "Semua", label: "Semua Lokasi" }, ...locations.filter((l) => l.status === "Aktif").map((l) => ({ value: String(l.id), label: l.nama }))]} className="w-44" />
            <Select value={assignedFilter} onChange={(v) => { setAssignedFilter(v as "Semua" | "Ditempatkan" | "Belum Ditempatkan"); setPage(1); }} options={["Semua", "Ditempatkan", "Belum Ditempatkan"].map((v) => ({ value: v, label: v === "Semua" ? "Semua Penempatan" : v }))} className="w-44" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 p-1 bg-muted rounded-xl">
              <button
                onClick={() => { setViewMode("laporan"); setPage(1); setExpandedGroups(new Set()); }}
                className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors", viewMode === "laporan" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground")}
              >
                <TableIcon className="w-3.5 h-3.5" /> Laporan Ringkas
              </button>
              <button
                onClick={() => { setViewMode("unit"); setPage(1); }}
                className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors", viewMode === "unit" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground")}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Per Unit
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground font-medium">
                {viewMode === "laporan" ? `${filteredSummary.groupCount} jenis` : `${filteredSummary.totalUnit} unit`} terfilter
              </span>
              <span className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary font-bold">
                Subtotal: {formatRupiah(filteredSummary.totalNilai)}
              </span>
              {filteredSummary.tanpaHarga > 0 && (
                <span className="px-2.5 py-1.5 rounded-lg bg-warning/10 text-warning font-medium">
                  {filteredSummary.tanpaHarga} tanpa harga
                </span>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          viewMode === "laporan" ? (
            <div className="bg-card rounded-2xl border border-border p-4 animate-pulse space-y-3">
              <div className="h-6 bg-muted rounded w-32" />
              <div className="h-32 bg-muted rounded-2xl" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-card rounded-3xl border border-border p-4 animate-pulse space-y-3">
                  <div className="h-36 bg-muted rounded-2xl" /><div className="h-4 bg-muted rounded w-24" /><div className="h-3 bg-muted rounded w-40" /><div className="h-20 bg-muted rounded-2xl" />
                </div>
              ))}
            </div>
          )
        ) : filteredAssets.length === 0 ? (
          <div className="bg-card rounded-3xl border border-border p-12 text-center">
            <Package className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-sm font-bold text-foreground">{assets.length === 0 ? "Belum ada aset" : "Tidak ada aset yang cocok"}</p>
            <p className="text-xs text-muted-foreground mt-1">{assets.length === 0 ? "Klik Tambah Aset untuk mulai." : "Coba ubah filter atau kata kunci pencarian."}</p>
          </div>
        ) : viewMode === "laporan" ? (
          <div className="space-y-4">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 border-b border-border">
                    <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="px-3 py-3 text-left min-w-[180px]">Nama Aset</th>
                      <th className="px-3 py-3 text-left min-w-[130px]">Kategori</th>
                      <th className="px-3 py-3 text-left min-w-[150px]">Merek / Model</th>
                      <th className="px-3 py-3 text-center min-w-[80px]">Jumlah</th>
                      <th className="px-3 py-3 text-left min-w-[140px]">Status</th>
                      <th className="px-3 py-3 text-left min-w-[130px]">Lokasi</th>
                      <th className="px-3 py-3 text-right min-w-[140px]">Harga per Unit</th>
                      <th className="px-3 py-3 text-right min-w-[150px]">Total Nilai</th>
                      <th className="px-3 py-3 text-center w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {pagedGroups.map((g) => {
                      const isExpanded = expandedGroups.has(g.key);
                      return (
                        <>
                          <tr key={g.key} className="hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-3">
                              <p className="text-sm font-bold text-foreground">{g.displayName}</p>
                              <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[220px]">{g.kodeSample}</p>
                            </td>
                            <td className="px-3 py-3 text-foreground">{formatDistinctList(g.categories)}</td>
                            <td className="px-3 py-3 text-foreground">{g.merekModelLabel}</td>
                            <td className="px-3 py-3 text-center">
                              <span className="inline-flex items-center justify-center min-w-[36px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold text-xs border border-primary/20">{g.count}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-[11px] text-foreground font-medium">{g.statusLabel}</span>
                              {g.missingPriceCount > 0 && <span className="ml-1 text-[10px] text-warning">• {g.missingPriceCount} tanpa harga</span>}
                            </td>
                            <td className="px-3 py-3 text-foreground">{formatDistinctList(g.locations)}</td>
                            <td className="px-3 py-3 text-right">
                              <span className={cn("font-semibold", g.missingPriceCount === g.count ? "text-warning" : "text-foreground")}>
                                {formatHargaPerUnit(g.minHarga, g.maxHarga, g.missingPriceCount, g.count)}
                              </span>
                              {g.missingPriceCount > 0 && g.missingPriceCount !== g.count && (
                                <span className="block text-[10px] text-muted-foreground">+ {g.missingPriceCount} tanpa harga</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="font-bold text-foreground">{formatRupiah(g.totalNilai)}</span>
                              {g.missingPriceCount > 0 && g.missingPriceCount !== g.count && (
                                <span className="block text-[10px] text-muted-foreground">tanpa {g.missingPriceCount} unit</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <button onClick={() => toggleGroup(g.key)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title={isExpanded ? "Sembunyikan" : "Lihat unit"}>
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${g.key}-expanded`} className="bg-muted/20">
                              <td colSpan={9} className="px-3 py-3">
                                <div className="rounded-xl border border-border bg-card overflow-hidden">
                                  <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
                                    <p className="text-xs font-bold text-foreground">Rincian {g.count} unit — {g.displayName}</p>
                                    <span className="text-[11px] text-muted-foreground">Total: {formatRupiah(g.totalNilai)}</span>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead className="bg-muted/30">
                                        <tr className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                          <th className="px-3 py-2 text-left">Kode</th>
                                          <th className="px-3 py-2 text-left">Merek / Model</th>
                                          <th className="px-3 py-2 text-left">Lokasi</th>
                                          <th className="px-3 py-2 text-left">Status</th>
                                          <th className="px-3 py-2 text-right">Harga</th>
                                          <th className="px-3 py-2 text-center">Aksi</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-border/40">
                                        {g.assets.map((a) => (
                                          <tr key={a.id} className="hover:bg-muted/20">
                                            <td className="px-3 py-2 font-mono font-semibold text-primary">{a.kode_aset}</td>
                                            <td className="px-3 py-2 text-foreground">{[a.merek, a.model].filter(Boolean).join(" / ") || "-"}</td>
                                            <td className="px-3 py-2 text-foreground">{a.ga_asset_locations?.nama || "-"}</td>
                                            <td className="px-3 py-2"><span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border", statusStyle[a.status as AssetStatus])}>{a.status}</span></td>
                                            <td className="px-3 py-2 text-right font-medium text-foreground">{formatRupiah(a.harga_beli)}</td>
                                            <td className="px-3 py-2">
                                              <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => setDetailAsset(a)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Detail"><Eye className="w-3.5 h-3.5" /></button>
                                                {canEdit && <button onClick={() => openEdit(a)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>}
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pagedGroups.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">Tidak ada kelompok yang cocok.</div>
              )}
              <div className="px-3 py-3 bg-muted/20 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  Menampilkan {pagedGroups.length} dari {groupedRows.length} jenis • {filteredSummary.totalUnit} unit • Total {formatRupiah(filteredSummary.totalNilai)}
                </span>
                <span className="text-muted-foreground">Nilai perusahaan (semua status): <span className="font-bold text-foreground">{formatRupiah(summary.totalNilaiCompany)}</span></span>
              </div>
            </div>
            <Pagination currentPage={page} totalItems={groupedRows.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pagedAssets.map((a) => renderAssetCard(a))}
            </div>
            <Pagination currentPage={page} totalItems={filteredAssets.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </div>
        )}

        {showForm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
              <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Package className="w-5 h-5 text-primary" /></div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">{editingId ? "Edit Aset" : "Tambah Aset"}</h3>
                      <p className="text-xs text-muted-foreground">{editingId ? "Perbarui data aset" : "Buat satu atau beberapa aset dengan kode unik"}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {formError && <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{formError}</div>}
                  <div className="rounded-2xl border border-border bg-muted/20 p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-28 w-36 flex-shrink-0 overflow-hidden rounded-2xl border border-border bg-card flex items-center justify-center">
                        {photoPreview ? <img src={photoPreview} alt="Preview foto aset" className="h-full w-full object-cover" /> : <Package className="h-10 w-10 text-muted-foreground/30" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-foreground">Foto Aset</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {isBatchCreate ? "Foto ditambahkan melalui edit masing-masing aset setelah batch dibuat." : "Upload foto utama aset. Maksimal 5 MB (JPG/PNG/WEBP)."}
                        </p>
                        {removePhoto && <p className="mt-1 text-[10px] font-semibold text-danger">Foto lama akan dihapus saat disimpan.</p>}
                        {photoFile && <p className="mt-1 truncate text-[10px] font-semibold text-success">{photoFile.name}</p>}
                        {!isBatchCreate && <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90">
                            <Boxes className="h-3.5 w-3.5" />
                            {photoPreview ? "Ganti Foto" : "Upload Foto"}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { handlePhotoSelect(e.target.files); e.target.value = ""; }} />
                          </label>
                          {photoPreview && !photoFile && !removePhoto && <button onClick={() => setRemovePhoto(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Hapus Foto</button>}
                          {photoPreview && (photoFile || removePhoto) && <button onClick={() => resetPhotoState(editingId ? (assets.find((a) => a.id === editingId)?.foto_url || "") : "")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Batal</button>}
                        </div>}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {!editingId && (
                      <div className="sm:col-span-2 rounded-2xl border border-primary/20 bg-primary/5 p-3">
                        <label className="text-xs font-semibold text-foreground mb-1 block">Jumlah Item <span className="text-danger">*</span></label>
                        <input
                          value={form.jumlah_item}
                          onChange={(e) => handleBatchQuantityChange(e.target.value)}
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="1"
                          className={cn(inputClass, "max-w-32 bg-card")}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Maksimal {MAX_BATCH_QUANTITY}. Setiap item dibuat sebagai aset individual dengan kode unik.
                        </p>
                      </div>
                    )}
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1 block">Kategori <span className="text-danger">*</span></label>
                      <Select value={form.category_id ? String(form.category_id) : ""} onChange={(v) => setForm({ ...form, category_id: v ? Number(v) : null })} options={[{ value: "", label: "Pilih kategori" }, ...categories.filter((c) => c.status === "Aktif").map((c) => ({ value: String(c.id), label: `${c.nama} (${c.kode_prefix})` }))]} className="w-full" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1 block">Lokasi <span className="text-danger">*</span></label>
                      <Select value={form.lokasi_id ? String(form.lokasi_id) : ""} onChange={(v) => setForm({ ...form, lokasi_id: v ? Number(v) : null })} options={[{ value: "", label: "Pilih lokasi" }, ...locations.filter((l) => l.status === "Aktif").map((l) => ({ value: String(l.id), label: l.nama }))]} className="w-full" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold text-foreground mb-1 block">Nama Aset <span className="text-danger">*</span></label>
                      <input value={form.nama_aset} onChange={(e) => setForm({ ...form, nama_aset: e.target.value })} placeholder="Contoh: Laptop Dell Latitude 5430" className={inputClass} />
                    </div>
                    <div><label className="text-xs font-semibold text-foreground mb-1 block">Merek</label><input value={form.merek} onChange={(e) => setForm({ ...form, merek: e.target.value })} placeholder="Dell, Lenovo, IKEA..." className={inputClass} /></div>
                    <div><label className="text-xs font-semibold text-foreground mb-1 block">Model/Tipe</label><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Latitude 5430, Ergo Chair..." className={inputClass} /></div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1 block">Serial Number</label>
                      <input
                        value={form.serial_number}
                        onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                        placeholder={isBatchCreate ? "Diisi setelah aset dibuat" : "SN123456"}
                        disabled={isBatchCreate}
                        className={cn(inputClass, isBatchCreate && "cursor-not-allowed opacity-60")}
                      />
                      {isBatchCreate && <p className="text-[10px] text-muted-foreground mt-1">Serial dikosongkan agar dapat diisi per item melalui edit.</p>}
                    </div>
                    <div><label className="text-xs font-semibold text-foreground mb-1 block">Tanggal Beli</label><input type="date" value={form.tanggal_beli} onChange={(e) => setForm({ ...form, tanggal_beli: e.target.value })} className={inputClass} /></div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1 block">Harga Beli per Item (Rp)</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">Rp</span>
                        <input
                          value={form.harga_beli}
                          onChange={(e) => setForm({ ...form, harga_beli: formatRupiahInput(e.target.value) })}
                          placeholder="200.000"
                          inputMode="numeric"
                          autoComplete="off"
                          className={cn(inputClass, "pl-10")}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Contoh: 200.000 • Kosongkan bila belum ada harga.</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1 block">Kondisi</label>
                      <Select value={form.kondisi} onChange={(v) => setForm({ ...form, kondisi: v as Kondisi })} options={["Baik", "Rusak Ringan", "Rusak Berat"].map((v) => ({ value: v, label: v }))} className="w-full" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1 block">Status</label>
                      <Select value={form.status} onChange={(v) => setForm({ ...form, status: v as AssetStatus })} options={["Aktif", "Rusak", "Tidak Aktif"].map((v) => ({ value: v, label: v }))} className="w-full" />
                    </div>
                    <div className="sm:col-span-2"><label className="text-xs font-semibold text-foreground mb-1 block">Spesifikasi</label><textarea value={form.spesifikasi} onChange={(e) => setForm({ ...form, spesifikasi: e.target.value })} placeholder="RAM 16GB, SSD 512GB, warna hitam..." rows={2} className={inputClass} /></div>
                    <div className="sm:col-span-2"><label className="text-xs font-semibold text-foreground mb-1 block">Catatan</label><textarea value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} placeholder="Catatan internal GA..." rows={2} className={inputClass} /></div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                  <Button size="sm" icon={Check} onClick={handleSave} disabled={formSaving}>
                    {formSaving ? "Menyimpan..." : editingId ? "Simpan" : batchQuantity > 1 ? `Tambah ${batchQuantity} Aset` : "Tambah Aset"}
                  </Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {detailAsset && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetailAsset(null)} />
              <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Tag className="w-5 h-5 text-primary" /></div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">{detailAsset.kode_aset} — {detailAsset.nama_aset}</h3>
                      <p className="text-xs text-muted-foreground">{detailAsset.ga_asset_categories?.nama || "-"} • {detailAsset.ga_asset_locations?.nama || "-"}</p>
                    </div>
                  </div>
                  <button onClick={() => setDetailAsset(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div className="rounded-2xl overflow-hidden border border-border bg-muted/20">
                    {detailSignedUrl || detailAsset.foto_url ? (
                      <img src={detailSignedUrl || detailAsset.foto_url || ""} alt={detailAsset.nama_aset} className="w-full max-h-[320px] object-cover" />
                    ) : (
                      <div className="h-40 flex items-center justify-center text-muted-foreground"><Package className="w-10 h-10" /></div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Merek/Model</p><p className="font-semibold text-foreground">{detailAsset.merek || "-"} {detailAsset.model ? `/ ${detailAsset.model}` : ""}</p></div>
                    <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Serial</p><p className="font-semibold text-foreground">{detailAsset.serial_number || "-"}</p></div>
                    <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Tanggal Beli</p><p className="font-semibold text-foreground">{formatTanggal(detailAsset.tanggal_beli)}</p></div>
                    <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Harga</p><p className="font-semibold text-foreground">{formatRupiah(detailAsset.harga_beli)}</p></div>
                    <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Kondisi</p><p className="font-semibold text-foreground">{detailAsset.kondisi}</p></div>
                    <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Status</p><p className="font-semibold text-foreground">{detailAsset.status}</p></div>
                    <div className="sm:col-span-2 rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Spesifikasi</p><p className="font-medium text-foreground whitespace-pre-wrap">{detailAsset.spesifikasi || "-"}</p></div>
                    <div className="sm:col-span-2 rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Catatan</p><p className="font-medium text-foreground whitespace-pre-wrap">{detailAsset.catatan || "-"}</p></div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-foreground flex items-center gap-2"><ArrowRightLeft className="w-4 h-4" /> Riwayat Penempatan</h4>
                    <div className="mt-3 space-y-2">
                      {(assignmentsByAsset.get(detailAsset.id) || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">Belum ada riwayat penempatan.</p>
                      ) : (
                        (assignmentsByAsset.get(detailAsset.id) || []).map((a) => (
                          <div key={a.id} className="rounded-xl border border-border p-3 bg-muted/20">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-foreground">{a.pegawai_nama || a.divisi_nama || "-"} <span className="text-muted-foreground font-normal">@ {a.lokasi_nama || "-"}</span></p>
                              <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold", a.status === "Aktif" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{a.status}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">{formatTanggal(a.tanggal_serah)} — {a.tanggal_kembali ? formatTanggal(a.tanggal_kembali) : "sekarang"} {a.catatan ? `• ${a.catatan}` : ""}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
                  <Button variant="outline" size="sm" onClick={() => setDetailAsset(null)}>Tutup</Button>
                  {canEdit && <Button size="sm" icon={ArrowRightLeft} onClick={() => { const a = detailAsset; setDetailAsset(null); if (a) openAssign(a); }}>Atur Penempatan</Button>}
                </div>
              </div>
            </div>
          </Portal>
        )}

        {assignmentAsset && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !assignmentSaving && setAssignmentAsset(null)} />
              <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><ArrowRightLeft className="w-5 h-5 text-primary" /></div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">Penempatan Aset</h3>
                      <p className="text-xs text-muted-foreground">{assignmentAsset.kode_aset} — {assignmentAsset.nama_aset}</p>
                    </div>
                  </div>
                  <button onClick={() => !assignmentSaving && setAssignmentAsset(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-5 space-y-3">
                  {assignmentError && <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{assignmentError}</div>}
                  <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                    Penempatan aktif sebelumnya akan otomatis ditutup saat transfer. Gunakan kembalikan jika aset masuk gudang.
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1 block">Pegawai (opsional)</label>
                    <Select value={assignmentForm.pegawai_id} onChange={(v) => setAssignmentForm({ ...assignmentForm, pegawai_id: v })} options={[{ value: "", label: "Tanpa PIC pegawai" }, ...pegawaiList.map((p) => ({ value: p.id, label: `${p.id} — ${p.nama}` }))]} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1 block">Divisi (opsional)</label>
                    <Select value={assignmentForm.division_id} onChange={(v) => setAssignmentForm({ ...assignmentForm, division_id: v })} options={[{ value: "", label: "Tanpa divisi" }, ...divisionList.map((d) => ({ value: String(d.id), label: d.nama }))]} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1 block">Lokasi <span className="text-danger">*</span></label>
                    <Select value={assignmentForm.lokasi_id} onChange={(v) => setAssignmentForm({ ...assignmentForm, lokasi_id: v })} options={[{ value: "", label: "Pilih lokasi" }, ...locations.filter((l) => l.status === "Aktif").map((l) => ({ value: String(l.id), label: l.nama }))]} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1 block">Catatan</label>
                    <textarea value={assignmentForm.catatan} onChange={(e) => setAssignmentForm({ ...assignmentForm, catatan: e.target.value })} rows={2} placeholder="Alasan transfer / kondisi serah..." className={inputClass} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 p-5 border-t border-border">
                  <Button variant="outline" size="sm" icon={Undo2} onClick={handleReturn} disabled={assignmentSaving}>Kembalikan</Button>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setAssignmentAsset(null)} disabled={assignmentSaving}>Batal</Button>
                    <Button size="sm" icon={Check} onClick={handleTransfer} disabled={assignmentSaving}>{assignmentSaving ? "Menyimpan..." : "Simpan"}</Button>
                  </div>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {showCategoryManager && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCategoryManager(false)} />
              <div className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Boxes className="w-5 h-5 text-primary" /></div><h3 className="text-base font-bold text-foreground">Kategori Aset</h3></div>
                  <button onClick={() => setShowCategoryManager(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {masterError && <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{masterError}</div>}
                  <div className="rounded-2xl border border-border p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label className="text-xs font-semibold text-foreground mb-1 block">Nama Kategori</label><input value={categoryDraft.nama} onChange={(e) => setCategoryDraft({ ...categoryDraft, nama: e.target.value })} placeholder="Elektronik" className={inputClass} /></div>
                      <div><label className="text-xs font-semibold text-foreground mb-1 block">Prefix Kode</label><input value={categoryDraft.kode_prefix} onChange={(e) => setCategoryDraft({ ...categoryDraft, kode_prefix: e.target.value.toUpperCase() })} placeholder="EL" className={inputClass} /></div>
                      <div className="sm:col-span-2"><label className="text-xs font-semibold text-foreground mb-1 block">Deskripsi</label><input value={categoryDraft.deskripsi} onChange={(e) => setCategoryDraft({ ...categoryDraft, deskripsi: e.target.value })} placeholder="Dekripsi kategori" className={inputClass} /></div>
                    </div>
                    <Button size="sm" icon={Plus} onClick={handleCreateCategory} disabled={masterSaving}>{masterSaving ? "Menyimpan..." : "Tambah Kategori"}</Button>
                  </div>
                  <div className="space-y-2">
                    {categories.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                        <div><p className="text-sm font-bold text-foreground">{c.nama} <span className="text-xs font-mono text-primary">({c.kode_prefix})</span></p><p className="text-xs text-muted-foreground">{c.deskripsi || "-"} • Seq: {c.next_sequence}</p></div>
                        <button onClick={() => toggleCategoryStatus(c)} className={cn("px-2.5 py-1 rounded-full text-xs font-bold", c.status === "Aktif" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{c.status}</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-end p-5 border-t border-border"><Button variant="outline" size="sm" onClick={() => setShowCategoryManager(false)}>Tutup</Button></div>
              </div>
            </div>
          </Portal>
        )}

        {showLocationManager && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLocationManager(false)} />
              <div className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><MapPin className="w-5 h-5 text-primary" /></div><h3 className="text-base font-bold text-foreground">Lokasi Aset</h3></div>
                  <button onClick={() => setShowLocationManager(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {masterError && <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{masterError}</div>}
                  <div className="rounded-2xl border border-border p-3 space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      <div><label className="text-xs font-semibold text-foreground mb-1 block">Nama Lokasi</label><input value={locationDraft.nama} onChange={(e) => setLocationDraft({ ...locationDraft, nama: e.target.value })} placeholder="Ruang IT" className={inputClass} /></div>
                      <div><label className="text-xs font-semibold text-foreground mb-1 block">Alamat</label><input value={locationDraft.alamat} onChange={(e) => setLocationDraft({ ...locationDraft, alamat: e.target.value })} placeholder="Lantai 2, Gedung A" className={inputClass} /></div>
                      <div><label className="text-xs font-semibold text-foreground mb-1 block">Keterangan</label><input value={locationDraft.keterangan} onChange={(e) => setLocationDraft({ ...locationDraft, keterangan: e.target.value })} placeholder="Keterangan tambahan" className={inputClass} /></div>
                    </div>
                    <Button size="sm" icon={Plus} onClick={handleCreateLocation} disabled={masterSaving}>{masterSaving ? "Menyimpan..." : "Tambah Lokasi"}</Button>
                  </div>
                  <div className="space-y-2">
                    {locations.map((l) => (
                      <div key={l.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                        <div><p className="text-sm font-bold text-foreground">{l.nama}</p><p className="text-xs text-muted-foreground">{l.alamat || l.keterangan || "-"}</p></div>
                        <button onClick={() => toggleLocationStatus(l)} className={cn("px-2.5 py-1 rounded-full text-xs font-bold", l.status === "Aktif" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{l.status}</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-end p-5 border-t border-border"><Button variant="outline" size="sm" onClick={() => setShowLocationManager(false)}>Tutup</Button></div>
              </div>
            </div>
          </Portal>
        )}

        {deleteConfirm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
              <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl p-6">
                <h3 className="text-base font-bold text-foreground">Hapus Aset?</h3>
                <p className="text-sm text-muted-foreground mt-2">Aset <span className="font-mono font-bold text-foreground">{deleteConfirm.kode}</span> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.</p>
                <p className="text-xs text-muted-foreground mt-2">Aset dengan riwayat penempatan tidak dapat dihapus; gunakan status Tidak Aktif.</p>
                <div className="flex items-center justify-end gap-2 mt-6">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                  <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="bg-danger text-white hover:bg-danger/90">{deleting ? "Menghapus..." : "Hapus"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {previewMedia && (
          <Portal>
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewMedia(null)} />
              <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <p className="text-sm font-bold text-foreground truncate">{previewMedia.label}</p>
                  <button onClick={() => setPreviewMedia(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-4 flex items-center justify-center bg-muted/20">
                  <img src={previewMedia.url} alt={previewMedia.label} className="max-h-[70vh] object-contain rounded-xl" />
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    </RouteGuard>
  );
}
