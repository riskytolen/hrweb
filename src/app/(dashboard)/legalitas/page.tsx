"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FileText,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  CircleCheckBig,
  Eye,
  Download,
  Archive,
  ArchiveRestore,
  History,
  File,
  FileImage,
  Settings2,
  Check,
  Upload,
  ExternalLink,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type {
  DbCompanyLegalCategory,
  DbCompanyLegalDocument,
  DbCompanyLegalDocumentVersion,
  DbCompanyLegalDocumentFile,
} from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";
import { logAudit } from "@/lib/audit";

type LegalDoc = DbCompanyLegalDocument & {
  company_legal_categories?: DbCompanyLegalCategory | null;
};

type VersionWithFiles = DbCompanyLegalDocumentVersion & {
  company_legal_document_files?: DbCompanyLegalDocumentFile[];
};

const PAGE_SIZE = 10;
const BUCKET = "company-legal-documents" as const;
const MAX_FILES_PER_VERSION = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME: string[] = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

const inputClass =
  "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const labelClass = "text-xs font-semibold text-foreground mb-1.5 block";

function formatTanggal(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFileIcon(mime: string) {
  if (mime === "application/pdf") return File;
  return FileImage;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

function extFromName(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function mimeForFile(file: File): string {
  // Normalize browser mime; trust file.type but fallback to extension
  if (ALLOWED_MIME.includes(file.type)) return file.type;
  const ext = extFromName(file.name);
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return file.type || "application/octet-stream";
}

function isAllowedFile(file: File): { ok: boolean; reason?: string } {
  const mime = mimeForFile(file);
  if (!ALLOWED_MIME.includes(mime)) {
    return { ok: false, reason: `Tipe file tidak didukung: ${file.name} (${mime || "unknown"})` };
  }
  const ext = extFromName(file.name);
  if (!ALLOWED_EXT.includes(ext)) {
    return { ok: false, reason: `Ekstensi tidak didukung: ${file.name}` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: `${file.name} melebihi 10 MB` };
  }
  if (file.size === 0) {
    return { ok: false, reason: `${file.name} kosong` };
  }
  return { ok: true };
}

export default function LegalitasPage() {
  const { getPermissionLevel, user } = useAuth();
  const permLevel = getPermissionLevel("legalitas");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const canView = permLevel !== "none";

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<DbCompanyLegalCategory[]>([]);
  const [docs, setDocs] = useState<LegalDoc[]>([]);
  const [versions, setVersions] = useState<DbCompanyLegalDocumentVersion[]>([]);
  const [files, setFiles] = useState<DbCompanyLegalDocumentFile[]>([]);

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<number | "Semua">("Semua");
  const [filterStatus, setFilterStatus] = useState<"Semua" | "Aktif" | "Diarsipkan">("Semua");
  const [page, setPage] = useState(1);

  // Toast
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

  // body scroll lock for modals
  const [showForm, setShowForm] = useState(false);
  const [showCategoryManage, setShowCategoryManage] = useState(false);
  const [showDetail, setShowDetail] = useState<LegalDoc | null>(null);
  const [showVersion, setShowVersion] = useState<LegalDoc | null>(null);
  const [preview, setPreview] = useState<{ path: string; name: string; mime: string; url: string } | null>(null);

  useEffect(() => {
    const anyOpen = showForm || showCategoryManage || !!showDetail || !!showVersion || !!preview;
    if (anyOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm, showCategoryManage, showDetail, showVersion, preview]);

  // Forms
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{ category_id: number | ""; judul: string; catatan: string }>({
    category_id: "",
    judul: "",
    catatan: "",
  });
  const [formFiles, setFormFiles] = useState<File[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Version form
  const [versionCatatan, setVersionCatatan] = useState("");
  const [versionFiles, setVersionFiles] = useState<File[]>([]);
  const [versionSaving, setVersionSaving] = useState(false);
  const [versionError, setVersionError] = useState("");

  // Category form
  const [catForm, setCatForm] = useState<{ id: number | null; nama: string; deskripsi: string; status: "Aktif" | "Tidak Aktif" }>({
    id: null, nama: "", deskripsi: "", status: "Aktif",
  });
  const [catSaving, setCatSaving] = useState(false);
  const [catDeleteId, setCatDeleteId] = useState<number | null>(null);

  // Delete/archive
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; judul: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<{ doc: LegalDoc; nextStatus: "Aktif" | "Diarsipkan" } | null>(null);

  // Fetch
  const fetchAll = useCallback(async () => {
    const [catRes, docRes, verRes, fileRes] = await Promise.all([
      supabase.from("company_legal_categories").select("*").order("sort_order").order("nama"),
      supabase.from("company_legal_documents").select("*, company_legal_categories(id, nama, status)").order("updated_at", { ascending: false }),
      supabase.from("company_legal_document_versions").select("*").order("version_no", { ascending: true }),
      supabase.from("company_legal_document_files").select("*").order("sort_order").order("created_at"),
    ]);
    if (catRes.error) showToast("error", "Gagal Memuat Kategori", catRes.error.message);
    else if (catRes.data) setCategories(catRes.data as DbCompanyLegalCategory[]);
    if (docRes.error) showToast("error", "Gagal Memuat Dokumen", docRes.error.message);
    else if (docRes.data) setDocs(docRes.data as unknown as LegalDoc[]);
    if (verRes.error) {/* ignore */}
    else if (verRes.data) setVersions(verRes.data as DbCompanyLegalDocumentVersion[]);
    if (fileRes.error) {/* ignore */}
    else if (fileRes.data) setFiles(fileRes.data as DbCompanyLegalDocumentFile[]);
  }, [showToast]);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  // Derived stats
  const activeCount = useMemo(() => docs.filter(d => d.status === "Aktif").length, [docs]);
  const archivedCount = useMemo(() => docs.filter(d => d.status === "Diarsipkan").length, [docs]);
  const totalFiles = useMemo(() => files.length, [files]);

  // File counts per doc
  const fileCountByDoc = useMemo(() => {
    const versionById = new Map<number, number>();
    versions.forEach(v => versionById.set(v.id, v.document_id));
    const counts = new Map<number, number>();
    files.forEach(f => {
      const docId = versionById.get(f.version_id);
      if (docId) counts.set(docId, (counts.get(docId) || 0) + 1);
    });
    return counts;
  }, [versions, files]);

  const versionCountByDoc = useMemo(() => {
    const m = new Map<number, number>();
    versions.forEach(v => m.set(v.document_id, (m.get(v.document_id) || 0) + 1));
    return m;
  }, [versions]);

  // Filters
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return docs.filter(d => {
      const catName = (d.company_legal_categories?.nama || "").toLowerCase();
      const matchSearch = !q || d.judul.toLowerCase().includes(q) || (d.catatan || "").toLowerCase().includes(q) || catName.includes(q);
      const matchCat = filterCat === "Semua" || d.category_id === filterCat;
      const matchStatus = filterStatus === "Semua" || d.status === filterStatus;
      return matchSearch && matchCat && matchStatus;
    });
  }, [docs, search, filterCat, filterStatus]);

  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  const openAdd = () => {
    setForm({ category_id: categories.find(c => c.status === "Aktif")?.id || "", judul: "", catatan: "" });
    setFormFiles([]);
    setFormError("");
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (doc: LegalDoc) => {
    setForm({ category_id: doc.category_id, judul: doc.judul, catatan: doc.catatan || "" });
    setFormFiles([]);
    setFormError("");
    setEditingId(doc.id);
    setShowForm(true);
  };

  const openDetail = (doc: LegalDoc) => {
    setShowDetail(doc);
  };

  const openVersion = (doc: LegalDoc) => {
    setVersionCatatan("");
    setVersionFiles([]);
    setVersionError("");
    setShowVersion(doc);
  };

  // Category manage
  const startEditCategory = (c: DbCompanyLegalCategory) => {
    setCatForm({ id: c.id, nama: c.nama, deskripsi: c.deskripsi || "", status: c.status });
  };
  const resetCatForm = () => setCatForm({ id: null, nama: "", deskripsi: "", status: "Aktif" });

  const handleSaveCategory = async () => {
    const nama = catForm.nama.trim();
    if (!nama) { showToast("error", "Nama kategori wajib diisi"); return; }
    if (!canEdit) { showToast("error", "Tidak Diizinkan", "Hanya role Edit yang dapat mengelola kategori."); return; }
    setCatSaving(true);
    try {
      if (catForm.id) {
        const old = categories.find(c => c.id === catForm.id);
        const { error } = await supabase.from("company_legal_categories").update({
          nama,
          deskripsi: catForm.deskripsi.trim() || null,
          status: catForm.status,
          updated_by: user?.id ?? null,
        }).eq("id", catForm.id);
        if (error) { showToast("error", "Gagal Menyimpan Kategori", error.message); setCatSaving(false); return; }
        await logAudit({
          supabase,
          action: "update",
          entityType: "company_legal_categories",
          entityId: catForm.id,
          entityLabel: nama,
          oldData: old as unknown as Record<string, unknown>,
          newData: { nama, deskripsi: catForm.deskripsi, status: catForm.status } as unknown as Record<string, unknown>,
        });
        showToast("success", "Kategori Diperbarui", nama);
      } else {
        const maxSort = categories.reduce((a, c) => Math.max(a, c.sort_order), 0);
        const { data, error } = await supabase.from("company_legal_categories").insert({
          nama,
          deskripsi: catForm.deskripsi.trim() || null,
          status: catForm.status,
          sort_order: maxSort + 1,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        }).select("id").single();
        if (error) { showToast("error", "Gagal Menambah Kategori", error.message); setCatSaving(false); return; }
        await logAudit({
          supabase,
          action: "create",
          entityType: "company_legal_categories",
          entityId: data?.id ?? null,
          entityLabel: nama,
          newData: { nama, deskripsi: catForm.deskripsi, status: catForm.status } as unknown as Record<string, unknown>,
        });
        showToast("success", "Kategori Ditambahkan", nama);
      }
      resetCatForm();
      await fetchAll();
    } finally { setCatSaving(false); }
  };

  const handleDeleteCategory = async (id: number) => {
    if (!canEdit) { showToast("error", "Tidak Diizinkan"); return; }
    const inUse = docs.some(d => d.category_id === id);
    if (inUse) { showToast("error", "Kategori Dipakai", "Tidak dapat menghapus kategori yang masih digunakan dokumen."); return; }
    const cat = categories.find(c => c.id === id);
    const { error } = await supabase.from("company_legal_categories").delete().eq("id", id);
    if (error) { showToast("error", "Gagal Menghapus Kategori", error.message); return; }
    await logAudit({
      supabase,
      action: "delete",
      entityType: "company_legal_categories",
      entityId: id,
      entityLabel: cat?.nama || String(id),
      oldData: cat as unknown as Record<string, unknown>,
    });
    showToast("success", "Kategori Dihapus");
    setCatDeleteId(null);
    resetCatForm();
    await fetchAll();
  };

  // Document save (create or edit metadata)
  const handleSaveDoc = async () => {
    setFormError("");
    const judul = form.judul.trim();
    if (!judul) { setFormError("Judul wajib diisi."); return; }
    if (judul.length > 300) { setFormError("Judul maksimal 300 karakter."); return; }
    if (!form.category_id) { setFormError("Pilih kategori."); return; }
    const cat = categories.find(c => c.id === form.category_id);
    if (!cat || cat.status !== "Aktif") { setFormError("Kategori tidak valid atau tidak aktif."); return; }

    // Edit existing doc metadata
    if (editingId) {
      if (!canEdit) { setFormError("Hanya role Edit yang dapat mengubah dokumen."); return; }
      const old = docs.find(d => d.id === editingId);
      setFormSaving(true);
      try {
        const { error } = await supabase.from("company_legal_documents").update({
          category_id: form.category_id as number,
          judul,
          catatan: form.catatan.trim() || null,
          updated_by: user?.id ?? null,
        }).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        await logAudit({
          supabase,
          action: "update",
          entityType: "company_legal_documents",
          entityId: editingId,
          entityLabel: judul,
          oldData: old as unknown as Record<string, unknown>,
          newData: { category_id: form.category_id, judul, catatan: form.catatan } as unknown as Record<string, unknown>,
        });
        showToast("success", "Dokumen Diperbarui", judul);
        setShowForm(false);
        await fetchAll();
      } finally { setFormSaving(false); }
      return;
    }

    // Create new doc with files
    if (!canInput) { setFormError("Tidak memiliki izin menambah dokumen."); return; }
    if (formFiles.length === 0) { setFormError("Upload minimal 1 file (maks 10)."); return; }
    if (formFiles.length > MAX_FILES_PER_VERSION) { setFormError(`Maksimal ${MAX_FILES_PER_VERSION} file per dokumen.`); return; }
    for (const f of formFiles) {
      const chk = isAllowedFile(f);
      if (!chk.ok) { setFormError(chk.reason || "File tidak valid"); return; }
    }

    setFormSaving(true);
    let createdDocId: number | null = null;
    let createdVersionId: number | null = null;
    const uploadedPaths: string[] = [];
    try {
      // Try RPC first for atomic doc+version, fallback to direct insert
      const { data: rpcData, error: rpcErr } = await supabase.rpc("create_company_legal_document", {
        p_category_id: form.category_id as number,
        p_judul: judul,
        p_catatan: form.catatan.trim() || null,
      });
      if (!rpcErr && rpcData) {
        createdDocId = rpcData as unknown as number;
        // fetch its version
        const { data: vData } = await supabase
          .from("company_legal_document_versions")
          .select("id, version_no")
          .eq("document_id", createdDocId)
          .order("version_no", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (vData) createdVersionId = (vData as { id: number }).id;
      } else {
        // Direct insert path
        // If RPC failed due to permission or missing, try direct
        const { data: docData, error: docErr } = await supabase
          .from("company_legal_documents")
          .insert({
            category_id: form.category_id as number,
            judul,
            catatan: form.catatan.trim() || null,
            status: "Aktif",
            current_version_no: 1,
            file_count: 0,
            created_by: user?.id ?? null,
            updated_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (docErr || !docData) { setFormError(docErr?.message || "Gagal membuat dokumen."); setFormSaving(false); return; }
        createdDocId = (docData as { id: number }).id;
        const { data: verData, error: verErr } = await supabase
          .from("company_legal_document_versions")
          .insert({
            document_id: createdDocId,
            version_no: 1,
            catatan: null,
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (verErr || !verData) {
          // rollback doc
          await supabase.from("company_legal_documents").delete().eq("id", createdDocId);
          setFormError(verErr?.message || "Gagal membuat versi awal."); setFormSaving(false); return;
        }
        createdVersionId = (verData as { id: number }).id;
      }

      if (!createdDocId || !createdVersionId) { setFormError("Gagal menyiapkan dokumen."); setFormSaving(false); return; }

      // Upload files to storage
      let sort = 0;
      for (const file of formFiles) {
        const ext = extFromName(file.name) || ".bin";
        const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? (crypto as unknown as { randomUUID: () => string }).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `company-legal/${createdDocId}/v1/${uuid}${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: mimeForFile(file) });
        if (upErr) {
          // cleanup uploaded
          if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
          // delete version/doc will cascade, but need to delete doc
          await supabase.from("company_legal_documents").delete().eq("id", createdDocId);
          setFormError(`Gagal upload ${file.name}: ${upErr.message}`);
          setFormSaving(false);
          return;
        }
        uploadedPaths.push(path);
        const mime = mimeForFile(file);
        const { error: fErr } = await supabase.from("company_legal_document_files").insert({
          version_id: createdVersionId,
          file_path: path,
          file_name: file.name,
          mime_type: mime,
          file_size_bytes: file.size,
          sort_order: sort++,
        });
        if (fErr) {
          if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
          await supabase.from("company_legal_documents").delete().eq("id", createdDocId);
          setFormError(fErr.message);
          setFormSaving(false);
          return;
        }
      }

      // update file_count
      await supabase.from("company_legal_documents").update({ file_count: formFiles.length, updated_by: user?.id ?? null }).eq("id", createdDocId);

      await logAudit({
        supabase,
        action: "create",
        entityType: "company_legal_documents",
        entityId: createdDocId,
        entityLabel: judul,
        newData: { judul, category_id: form.category_id, catatan: form.catatan, files: formFiles.length } as unknown as Record<string, unknown>,
        metadata: { version: 1, file_paths: uploadedPaths } as unknown as Record<string, unknown>,
      });

      showToast("success", "Dokumen Dibuat", judul);
      setShowForm(false);
      setFormFiles([]);
      await fetchAll();
    } catch (e) {
      if (createdDocId && uploadedPaths.length) {
        try { await supabase.storage.from(BUCKET).remove(uploadedPaths); } catch {}
        try { await supabase.from("company_legal_documents").delete().eq("id", createdDocId); } catch {}
      }
      setFormError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setFormSaving(false);
    }
  };

  // Add new version
  const handleAddVersion = async () => {
    if (!showVersion) return;
    setVersionError("");
    if (!canInput) { setVersionError("Tidak memiliki izin menambah versi."); return; }
    if (showVersion.status === "Diarsipkan") { setVersionError("Dokumen diarsipkan tidak dapat ditambah versi."); return; }
    if (versionFiles.length === 0) { setVersionError("Upload minimal 1 file."); return; }
    if (versionFiles.length > MAX_FILES_PER_VERSION) { setVersionError(`Maksimal ${MAX_FILES_PER_VERSION} file.`); return; }
    for (const f of versionFiles) {
      const chk = isAllowedFile(f);
      if (!chk.ok) { setVersionError(chk.reason || "File tidak valid"); return; }
    }

    setVersionSaving(true);
    const docId = showVersion.id;
    let newVersionId: number | null = null;
    let newVersionNo: number | null = null;
    const uploadedPaths: string[] = [];
    const oldVersions = versions.filter(v => v.document_id === docId);
    const oldFiles = files.filter(f => oldVersions.some(v => v.id === f.version_id));
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("create_company_legal_document_version", {
        p_document_id: docId,
        p_catatan: versionCatatan.trim() || null,
      });
      if (!rpcErr && rpcData) {
        newVersionId = rpcData as unknown as number;
        const { data: vRow } = await supabase.from("company_legal_document_versions").select("id, version_no").eq("id", newVersionId).maybeSingle();
        if (vRow) newVersionNo = (vRow as { version_no: number }).version_no;
      } else {
        // fallback manual
        const nextNo = (showVersion.current_version_no || oldVersions.length || 0) + 1;
        const { data: verData, error: verErr } = await supabase
          .from("company_legal_document_versions")
          .insert({ document_id: docId, version_no: nextNo, catatan: versionCatatan.trim() || null, created_by: user?.id ?? null })
          .select("id, version_no")
          .single();
        if (verErr || !verData) { setVersionError(verErr?.message || "Gagal membuat versi."); setVersionSaving(false); return; }
        newVersionId = (verData as { id: number }).id;
        newVersionNo = (verData as { version_no: number }).version_no;
        await supabase.from("company_legal_documents").update({ current_version_no: newVersionNo, updated_by: user?.id ?? null }).eq("id", docId);
      }

      if (!newVersionId || !newVersionNo) { setVersionError("Gagal menyiapkan versi."); setVersionSaving(false); return; }

      let sort = 0;
      for (const file of versionFiles) {
        const ext = extFromName(file.name) || ".bin";
        const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? (crypto as unknown as { randomUUID: () => string }).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `company-legal/${docId}/v${newVersionNo}/${uuid}${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: mimeForFile(file) });
        if (upErr) {
          if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
          // rollback version
          await supabase.from("company_legal_document_versions").delete().eq("id", newVersionId);
          // restore current_version_no
          const maxNo = oldVersions.length ? Math.max(...oldVersions.map(v => v.version_no)) : 1;
          await supabase.from("company_legal_documents").update({ current_version_no: maxNo }).eq("id", docId);
          setVersionError(`Gagal upload ${file.name}: ${upErr.message}`);
          setVersionSaving(false);
          return;
        }
        uploadedPaths.push(path);
        const { error: fErr } = await supabase.from("company_legal_document_files").insert({
          version_id: newVersionId,
          file_path: path,
          file_name: file.name,
          mime_type: mimeForFile(file),
          file_size_bytes: file.size,
          sort_order: sort++,
        });
        if (fErr) {
          if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
          await supabase.from("company_legal_document_versions").delete().eq("id", newVersionId);
          const maxNo = oldVersions.length ? Math.max(...oldVersions.map(v => v.version_no)) : 1;
          await supabase.from("company_legal_documents").update({ current_version_no: maxNo }).eq("id", docId);
          setVersionError(fErr.message);
          setVersionSaving(false);
          return;
        }
      }

      await supabase.from("company_legal_documents").update({ file_count: (fileCountByDoc.get(docId) || 0) + versionFiles.length, updated_by: user?.id ?? null }).eq("id", docId);

      await logAudit({
        supabase,
        action: "create",
        entityType: "company_legal_document_versions",
        entityId: newVersionId,
        entityLabel: `${showVersion.judul} v${newVersionNo}`,
        newData: { document_id: docId, version_no: newVersionNo, catatan: versionCatatan, files: versionFiles.length } as unknown as Record<string, unknown>,
        metadata: { file_paths: uploadedPaths } as unknown as Record<string, unknown>,
      });

      showToast("success", "Versi Baru Ditambahkan", `${showVersion.judul} v${newVersionNo}`);
      setShowVersion(null);
      setVersionFiles([]);
      setVersionCatatan("");
      await fetchAll();
      // if detail is open for same doc, keep it open but refresh happens via state
      if (showDetail && showDetail.id === docId) {
        const refreshed = await supabase.from("company_legal_documents").select("*, company_legal_categories(id, nama, status)").eq("id", docId).maybeSingle();
        if (refreshed.data) setShowDetail(refreshed.data as unknown as LegalDoc);
      }
    } catch (e) {
      if (newVersionId && uploadedPaths.length) {
        try { await supabase.storage.from(BUCKET).remove(uploadedPaths); } catch {}
        try { await supabase.from("company_legal_document_versions").delete().eq("id", newVersionId); } catch {}
      }
      setVersionError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally { setVersionSaving(false); }
  };

  // Archive / Restore
  const handleArchive = async () => {
    if (!archiveConfirm) return;
    if (!canEdit) { showToast("error", "Tidak Diizinkan", "Hanya Edit yang dapat mengarsipkan."); return; }
    const { doc, nextStatus } = archiveConfirm;
    const old = { ...doc };
    const { error } = await supabase.from("company_legal_documents").update({ status: nextStatus, updated_by: user?.id ?? null }).eq("id", doc.id);
    if (error) { showToast("error", "Gagal", error.message); return; }
    await logAudit({
      supabase,
      action: "status_change",
      entityType: "company_legal_documents",
      entityId: doc.id,
      entityLabel: doc.judul,
      oldData: old as unknown as Record<string, unknown>,
      newData: { status: nextStatus } as unknown as Record<string, unknown>,
    });
    showToast("success", nextStatus === "Diarsipkan" ? "Dokumen Diarsipkan" : "Dokumen Dipulihkan", doc.judul);
    setArchiveConfirm(null);
    if (showDetail && showDetail.id === doc.id) setShowDetail({ ...showDetail, status: nextStatus });
    await fetchAll();
  };

  // Delete (hard)
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    if (!canEdit) { showToast("error", "Tidak Diizinkan", "Hanya Edit yang dapat menghapus permanen."); return; }
    setDeleting(true);
    const doc = docs.find(d => d.id === deleteConfirm.id);
    const vers = versions.filter(v => v.document_id === deleteConfirm.id);
    const versIds = vers.map(v => v.id);
    const filePaths = files.filter(f => versIds.includes(f.version_id)).map(f => f.file_path);
    try {
      if (filePaths.length) {
        const { error: remErr } = await supabase.storage.from(BUCKET).remove(filePaths);
        // storage delete errors are logged but not blocking DB delete
        if (remErr) console.warn("storage remove error", remErr);
      }
      const { error } = await supabase.from("company_legal_documents").delete().eq("id", deleteConfirm.id);
      if (error) { showToast("error", "Gagal Menghapus", error.message); setDeleting(false); return; }
      await logAudit({
        supabase,
        action: "delete",
        entityType: "company_legal_documents",
        entityId: deleteConfirm.id,
        entityLabel: doc?.judul || String(deleteConfirm.id),
        oldData: doc as unknown as Record<string, unknown>,
        metadata: { file_paths: filePaths, versions: vers.length } as unknown as Record<string, unknown>,
      });
      showToast("success", "Dokumen Dihapus", deleteConfirm.judul);
      if (showDetail && showDetail.id === deleteConfirm.id) setShowDetail(null);
      setDeleteConfirm(null);
      await fetchAll();
    } finally { setDeleting(false); }
  };

  // Preview / download via signed URL
  const handlePreview = async (path: string, name: string, mime: string) => {
    if (!canView) { showToast("error", "Tidak Diizinkan"); return; }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { showToast("error", "Gagal Membuat Preview", error?.message || "Tidak ada URL"); return; }
    if (mime === "application/pdf" || mime.startsWith("image/")) {
      setPreview({ path, name, mime, url: data.signedUrl });
    } else {
      window.open(data.signedUrl, "_blank");
    }
    // audit preview as update? we use manual log via audit not auto; just log as "export" for trace
    // fire and forget
    logAudit({
      supabase,
      action: "export",
      entityType: "company_legal_document_files",
      entityId: path,
      entityLabel: name,
      metadata: { action: "preview", mime } as unknown as Record<string, unknown>,
    }).catch(() => {});
  };

  const handleDownload = async (path: string, name: string) => {
    if (!canView) { showToast("error", "Tidak Diizinkan"); return; }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300, { download: name } as unknown as object);
    // some SDKs need download option; fallback without
    let url = data?.signedUrl;
    if (error || !url) {
      const r2 = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
      if (r2.error || !r2.data?.signedUrl) { showToast("error", "Gagal Membuat Link Download", (error || r2.error)?.message); return; }
      url = r2.data.signedUrl;
    }
    const a = document.createElement("a");
    a.href = url as string;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    logAudit({
      supabase,
      action: "export",
      entityType: "company_legal_document_files",
      entityId: path,
      entityLabel: name,
      metadata: { action: "download" } as unknown as Record<string, unknown>,
    }).catch(() => {});
  };

  const detailVersions: VersionWithFiles[] = useMemo(() => {
    if (!showDetail) return [];
    const vs = versions.filter(v => v.document_id === showDetail.id).sort((a, b) => b.version_no - a.version_no);
    return vs.map(v => ({ ...v, company_legal_document_files: files.filter(f => f.version_id === v.id).sort((a,b)=>a.sort_order-b.sort_order) }));
  }, [showDetail, versions, files]);

  const canManageCategory = canEdit;

  if (!canView) {
    // RouteGuard will handle, but keep safe
  }

  return (
    <RouteGuard permission="legalitas">
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Legalitas"
          description="Arsip softcopy perusahaan — sertifikasi, akta, dan dokumen resmi lainnya"
          icon={FileText}
          actions={
            <div className="flex items-center gap-2">
              {canManageCategory && (
                <Button variant="outline" size="sm" icon={Settings2} onClick={() => setShowCategoryManage(true)}>
                  Kategori
                </Button>
              )}
              {canInput && (
                <Button icon={Plus} size="sm" onClick={openAdd}>
                  Tambah Dokumen
                </Button>
              )}
            </div>
          }
        />

        {/* Toast */}
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

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><FileText className="w-5 h-5 text-primary" /></div>
              <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Total Dokumen</p><p className="text-lg font-bold text-foreground">{loading ? "-" : docs.length}</p></div>
            </div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center"><Check className="w-5 h-5 text-success" /></div>
              <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Aktif</p><p className="text-lg font-bold text-success">{loading ? "-" : activeCount}</p></div>
            </div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center"><Archive className="w-5 h-5 text-warning" /></div>
              <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Diarsipkan</p><p className="text-lg font-bold text-warning">{loading ? "-" : archivedCount}</p></div>
            </div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center"><File className="w-5 h-5 text-indigo-500" /></div>
              <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Total File</p><p className="text-lg font-bold text-foreground">{loading ? "-" : totalFiles}</p></div>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="bg-card rounded-2xl border border-border p-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                placeholder="Cari judul, catatan, atau kategori..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
              />
              {search && <button onClick={() => setSearch("")} className="p-1 rounded hover:bg-muted"><X className="w-3 h-3 text-muted-foreground" /></button>}
            </div>
            <div className="flex items-center gap-2">
              <select value={filterCat === "Semua" ? "Semua" : String(filterCat)} onChange={(e) => { setFilterCat(e.target.value === "Semua" ? "Semua" : Number(e.target.value)); setPage(1); }} className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs text-foreground outline-none">
                <option value="Semua">Semua Kategori</option>
                {categories.map(c => <option key={c.id} value={String(c.id)}>{c.nama}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value as typeof filterStatus); setPage(1); }} className="px-2 py-2 rounded-xl border border-border bg-muted/30 text-xs text-foreground outline-none">
                <option value="Semua">Semua Status</option>
                <option value="Aktif">Aktif</option>
                <option value="Diarsipkan">Diarsipkan</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4" style={{ opacity: 1 - i * 0.12 }}>
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-2/3" /></div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              ))}
            </div>
          ) : paged.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Belum ada dokumen</p>
              <p className="text-xs text-muted-foreground mt-1">{filtered.length === 0 && docs.length > 0 ? "Tidak ada hasil filter." : canInput ? "Tambah dokumen pertama untuk memulai arsip." : "Menunggu dokumen dari tim."}</p>
              {canInput && filtered.length === 0 && docs.length === 0 && <Button icon={Plus} size="sm" className="mt-4" onClick={openAdd}>Tambah Dokumen</Button>}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">#</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">Dokumen</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">Kategori</th>
                      <th className="text-center px-3 py-3 font-semibold text-muted-foreground text-xs">Versi</th>
                      <th className="text-center px-3 py-3 font-semibold text-muted-foreground text-xs">File</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">Status</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((doc, idx) => {
                      const vc = versionCountByDoc.get(doc.id) || 0;
                      const fc = fileCountByDoc.get(doc.id) || 0;
                      return (
                        <tr key={doc.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-3 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                          <td className="px-4 py-3 max-w-[360px]">
                            <button onClick={() => openDetail(doc)} className="text-left">
                              <p className="font-semibold text-foreground line-clamp-1 hover:text-primary">{doc.judul}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{doc.catatan || <span className="italic text-muted-foreground/60">Tanpa catatan</span>}</p>
                              <p className="text-[10px] text-muted-foreground/70 mt-1">{formatTanggal(doc.updated_at)}</p>
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex px-2 py-1 rounded-full text-[11px] font-medium bg-indigo-500/10 text-indigo-600">
                              {doc.company_legal_categories?.nama || "-"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center text-xs font-medium">v{doc.current_version_no} <span className="text-muted-foreground">({vc})</span></td>
                          <td className="px-3 py-3 text-center text-xs">{fc}</td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex px-2 py-1 rounded-full text-[11px] font-semibold", doc.status === "Aktif" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                              {doc.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openDetail(doc)} title="Detail & file" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary"><Eye className="w-3.5 h-3.5" /></button>
                              {canInput && doc.status !== "Diarsipkan" && (
                                <button onClick={() => openVersion(doc)} title="Tambah versi" className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary"><History className="w-3.5 h-3.5" /></button>
                              )}
                              {canEdit && (
                                <>
                                  <button onClick={() => openEdit(doc)} title="Edit" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setArchiveConfirm({ doc, nextStatus: doc.status === "Aktif" ? "Diarsipkan" : "Aktif" })} title={doc.status === "Aktif" ? "Arsipkan" : "Pulihkan"} className="p-1.5 rounded-lg hover:bg-warning/10 text-muted-foreground hover:text-warning">
                                    {doc.status === "Aktif" ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                                  </button>
                                  <button onClick={() => setDeleteConfirm({ id: doc.id, judul: doc.judul })} title="Hapus permanen" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border">
                {paged.map(doc => {
                  const vc = versionCountByDoc.get(doc.id) || 0;
                  const fc = fileCountByDoc.get(doc.id) || 0;
                  return (
                    <div key={doc.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground text-sm line-clamp-2" onClick={() => openDetail(doc)}>{doc.judul}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-500/10 text-indigo-600">{doc.company_legal_categories?.nama}</span>
                            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold", doc.status === "Aktif" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>{doc.status}</span>
                            <span className="text-[10px] text-muted-foreground">v{doc.current_version_no} • {fc} file • {vc} versi</span>
                          </div>
                          {doc.catatan && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.catatan}</p>}
                          <p className="text-[10px] text-muted-foreground/70 mt-1">{formatTanggal(doc.updated_at)}</p>
                        </div>
                        <button onClick={() => openDetail(doc)} className="p-2 rounded-xl bg-muted text-muted-foreground flex-shrink-0"><Eye className="w-4 h-4" /></button>
                      </div>
                      <div className="flex items-center gap-1 mt-3">
                        {canInput && doc.status !== "Diarsipkan" && <Button variant="outline" size="sm" icon={History} onClick={() => openVersion(doc)} className="flex-1">Versi Baru</Button>}
                        {canEdit && <Button variant="outline" size="sm" icon={Pencil} onClick={() => openEdit(doc)} className="flex-1">Edit</Button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {!loading && filtered.length > PAGE_SIZE && (
            <div className="p-3 border-t border-border">
              <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          )}
        </div>

        {/* ═══ FORM DOKUMEN ═══ */}
        {showForm && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !formSaving && setShowForm(false)} />
              <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
                <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                  <button onClick={() => !formSaving && setShowForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                      {editingId ? <Pencil className="w-5 h-5 text-white" /> : <FileText className="w-5 h-5 text-white" />}
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-foreground">{editingId ? "Edit Dokumen" : "Tambah Dokumen"}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">{editingId ? "Ubah judul, kategori, atau catatan" : "Arsip baru — upload softcopy untuk versi 1"}</p>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                  {formError && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{formError}</div>
                  )}

                  <div>
                    <label className={labelClass}>Kategori <span className="text-danger">*</span></label>
                    <select value={form.category_id === "" ? "" : String(form.category_id)} onChange={e => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : "" })} className={inputClass}>
                      <option value="">— Pilih kategori —</option>
                      {categories.filter(c => editingId ? true : c.status === "Aktif").map(c => (
                        <option key={c.id} value={String(c.id)}>{c.nama} {c.status === "Tidak Aktif" ? "(Nonaktif)" : ""}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Judul Dokumen <span className="text-danger">*</span></label>
                    <input type="text" placeholder="Contoh: Sertifikat ISO 9001:2015 - PT Jams Logistic" value={form.judul} onChange={e => setForm({ ...form, judul: e.target.value })} className={inputClass} autoFocus />
                    <p className="text-[10px] text-muted-foreground mt-1">{form.judul.length}/300</p>
                  </div>

                  <div>
                    <label className={labelClass}>Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                    <textarea rows={3} placeholder="Keterangan tambahan dokumen..." value={form.catatan} onChange={e => setForm({ ...form, catatan: e.target.value })} className={cn(inputClass, "resize-none")} />
                  </div>

                  {!editingId && (
                    <div>
                      <label className={labelClass}>Softcopy <span className="text-danger">*</span> <span className="text-muted-foreground font-normal">— PDF / JPG / PNG / WebP, maks 10 MB/file, maks 10 file</span></label>
                      <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-colors">
                        <Upload className="w-6 h-6 text-muted-foreground" />
                        <span className="text-xs font-medium text-foreground">Klik untuk pilih file</span>
                        <span className="text-[10px] text-muted-foreground">atau drop file di sini</span>
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                          onChange={e => {
                            const fl = Array.from(e.target.files || []);
                            const merged = [...formFiles, ...fl].slice(0, MAX_FILES_PER_VERSION);
                            setFormFiles(merged);
                            // reset input to allow re-select same file
                            e.currentTarget.value = "";
                          }}
                          className="hidden"
                        />
                      </label>
                      {formFiles.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          <p className="text-xs font-medium text-foreground">{formFiles.length} file dipilih</p>
                          {formFiles.map((f, i) => {
                            const chk = isAllowedFile(f);
                            return (
                              <div key={`${f.name}-${i}`} className={cn("flex items-center gap-2 p-2 rounded-lg border text-xs", chk.ok ? "bg-card border-border" : "bg-danger-light border-danger/20")}>
                                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                                  {(() => { const I = getFileIcon(mimeForFile(f)); return <I className="w-4 h-4 text-muted-foreground" />; })()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="truncate font-medium text-foreground">{f.name}</p>
                                  <p className={cn("text-[10px]", chk.ok ? "text-muted-foreground" : "text-danger")}>{chk.ok ? `${mimeForFile(f)} • ${formatBytes(f.size)}` : chk.reason}</p>
                                </div>
                                <button onClick={() => setFormFiles(formFiles.filter((_, idx) => idx !== i))} className="p-1 rounded hover:bg-muted flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            );
                          })}
                          <button onClick={() => setFormFiles([])} className="text-xs text-muted-foreground hover:text-danger">Hapus semua</button>
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1.5">Private bucket • preview/download via signed URL 5 menit. Versi baru akan dibuat saat softcopy diupdate.</p>
                    </div>
                  )}

                  {editingId && (
                    <div className="px-3 py-2.5 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
                      <p className="text-xs text-indigo-700 flex items-center gap-1.5"><File className="w-3.5 h-3.5" />Untuk mengganti softcopy, gunakan &ldquo;Versi Baru&rdquo; pada daftar. Edit di sini hanya mengubah metadata.</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                  <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSaveDoc} disabled={formSaving || !form.judul.trim() || !form.category_id}>
                    {formSaving ? "Menyimpan..." : editingId ? "Simpan" : "Buat Dokumen"}
                  </Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* ═══ VERSI BARU ═══ */}
        {showVersion && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !versionSaving && setShowVersion(null)} />
              <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
                <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                  <button onClick={() => !versionSaving && setShowVersion(null)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <History className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-foreground">Versi Baru</h2>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{showVersion.judul} • v{showVersion.current_version_no} → v{showVersion.current_version_no + 1}</p>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                  {versionError && <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{versionError}</div>}
                  <div>
                    <label className={labelClass}>Catatan Versi <span className="text-muted-foreground font-normal">(opsional)</span></label>
                    <textarea rows={2} placeholder="Apa yang diperbarui pada versi ini?" value={versionCatatan} onChange={e => setVersionCatatan(e.target.value)} className={cn(inputClass, "resize-none")} />
                  </div>
                  <div>
                    <label className={labelClass}>File Versi Baru <span className="text-danger">*</span></label>
                    <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-colors">
                      <Upload className="w-6 h-6 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">Pilih file versi baru</span>
                      <span className="text-[10px] text-muted-foreground">Maks 10 file • 10 MB/file</span>
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                        onChange={e => {
                          const fl = Array.from(e.target.files || []);
                          setVersionFiles(prev => [...prev, ...fl].slice(0, MAX_FILES_PER_VERSION));
                          e.currentTarget.value = "";
                        }}
                        className="hidden"
                      />
                    </label>
                    {versionFiles.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {versionFiles.map((f, i) => {
                          const chk = isAllowedFile(f);
                          return (
                            <div key={`${f.name}-${i}`} className={cn("flex items-center gap-2 p-2 rounded-lg border text-xs", chk.ok ? "bg-card border-border" : "bg-danger-light border-danger/20")}>
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                                {(() => { const I = getFileIcon(mimeForFile(f)); return <I className="w-4 h-4 text-muted-foreground" />; })()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="truncate font-medium text-foreground">{f.name}</p>
                                <p className={cn("text-[10px]", chk.ok ? "text-muted-foreground" : "text-danger")}>{chk.ok ? `${mimeForFile(f)} • ${formatBytes(f.size)}` : chk.reason}</p>
                              </div>
                              <button onClick={() => setVersionFiles(versionFiles.filter((_, idx) => idx !== i))} className="p-1 rounded hover:bg-muted"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          );
                        })}
                        <button onClick={() => setVersionFiles([])} className="text-xs text-muted-foreground hover:text-danger">Hapus semua</button>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1.5">Versi lama tetap tersimpan dan dapat dilihat di detail.</p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setShowVersion(null)} disabled={versionSaving}>Batal</Button>
                  <Button size="sm" icon={Check} onClick={handleAddVersion} disabled={versionSaving || versionFiles.length === 0}>
                    {versionSaving ? "Menyimpan..." : "Simpan Versi"}
                  </Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* ═══ DETAIL ═══ */}
        {showDetail && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDetail(null)} />
              <div className="relative w-full max-w-2xl bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
                <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                  <button onClick={() => setShowDetail(null)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                  <div className="flex items-start gap-3 pr-6">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20 flex-shrink-0">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-500/10 text-indigo-600">{showDetail.company_legal_categories?.nama}</span>
                        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold", showDetail.status === "Aktif" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>{showDetail.status}</span>
                        <span className="text-[10px] text-muted-foreground">v{showDetail.current_version_no} • {fileCountByDoc.get(showDetail.id) || 0} file • {versionCountByDoc.get(showDetail.id) || 0} versi</span>
                      </div>
                      <h2 className="text-base font-bold text-foreground mt-1">{showDetail.judul}</h2>
                      <p className="text-xs text-muted-foreground mt-1">{showDetail.catatan || <span className="italic">Tanpa catatan</span>}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1">Diupdate {formatTanggal(showDetail.updated_at)} • Dibuat {formatTanggal(showDetail.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    {canInput && showDetail.status !== "Diarsipkan" && <Button icon={History} size="sm" onClick={() => { setShowDetail(null); openVersion(showDetail!); }}>Versi Baru</Button>}
                    {canEdit && <Button variant="outline" size="sm" icon={Pencil} onClick={() => { setShowDetail(null); openEdit(showDetail!); }}>Edit</Button>}
                  </div>
                </div>

                <div className="px-6 py-4 flex-1 overflow-y-auto space-y-4">
                  {detailVersions.length === 0 ? (
                    <div className="text-center py-10">
                      <File className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Tidak ada versi</p>
                    </div>
                  ) : detailVersions.map(v => (
                    <div key={v.id} className={cn("rounded-2xl border overflow-hidden", v.version_no === showDetail.current_version_no ? "border-primary/20 bg-primary/[0.02]" : "border-border bg-card")}>
                      <div className="px-4 py-3 flex items-center justify-between bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className={cn("px-2 py-1 rounded-full text-[11px] font-bold", v.version_no === showDetail.current_version_no ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>
                            V{v.version_no} {v.version_no === showDetail.current_version_no && "• Terbaru"}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatTanggal(v.created_at)}</span>
                        </div>
                        {v.catatan && <span className="text-xs text-foreground/70 truncate max-w-[180px]" title={v.catatan}>{v.catatan}</span>}
                      </div>
                      <div className="divide-y divide-border/50">
                        {(v.company_legal_document_files || []).length === 0 ? (
                          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Tidak ada file pada versi ini</div>
                        ) : v.company_legal_document_files!.map(f => {
                          const Icon = getFileIcon(f.mime_type);
                          return (
                            <div key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"><Icon className="w-4 h-4 text-muted-foreground" /></div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-foreground truncate" title={f.file_name}>{f.file_name}</p>
                                <p className="text-[10px] text-muted-foreground">{f.mime_type} • {formatBytes(f.file_size_bytes)}</p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => handlePreview(f.file_path, f.file_name, f.mime_type)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary" title="Pratinjau"><Eye className="w-3.5 h-3.5" /></button>
                                <button onClick={() => handleDownload(f.file_path, f.file_name)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary" title="Download"><Download className="w-3.5 h-3.5" /></button>
                                <button onClick={() => handlePreview(f.file_path, f.file_name, f.mime_type)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Buka"><ExternalLink className="w-3.5 h-3.5" /></button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between flex-shrink-0">
                  <p className="text-[10px] text-muted-foreground">Preview & download memakai signed URL 5 menit (private bucket).</p>
                  <Button variant="outline" size="sm" onClick={() => setShowDetail(null)}>Tutup</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* Preview modal */}
        {preview && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreview(null)} />
              <div className="relative w-full max-w-4xl h-[85vh] bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{preview.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{preview.mime} • {preview.path}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="outline" size="sm" icon={Download} onClick={() => handleDownload(preview.path, preview.name)}>Download</Button>
                    <button onClick={() => setPreview(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="flex-1 bg-muted/30 overflow-hidden">
                  {preview.mime === "application/pdf" ? (
                    <iframe src={preview.url} title={preview.name} className="w-full h-full border-0" />
                  ) : preview.mime.startsWith("image/") ? (
                    <div className="w-full h-full flex items-center justify-center p-4 bg-slate-900">
                      <img src={preview.url} alt={preview.name} className="max-w-full max-h-full object-contain rounded-lg shadow-lg" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                      <File className="w-10 h-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Pratinjau tidak tersedia untuk tipe ini. Silakan download.</p>
                      <Button icon={Download} onClick={() => handleDownload(preview.path, preview.name)}>Download</Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* ═══ KATEGORI MANAGE ═══ */}
        {showCategoryManage && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCategoryManage(false)} />
              <div className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
                <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-indigo-500/[0.08] via-transparent to-transparent flex-shrink-0">
                  <button onClick={() => setShowCategoryManage(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <Settings2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-foreground">Kelola Kategori</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Tambah, ubah, atau nonaktifkan kategori dokumen</p>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-5 flex-1 overflow-y-auto space-y-5">
                  {/* Form */}
                  <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                    <h3 className="text-xs font-bold text-foreground">{catForm.id ? "Edit Kategori" : "Tambah Kategori"}</h3>
                    <div>
                      <label className={labelClass}>Nama <span className="text-danger">*</span></label>
                      <input type="text" value={catForm.nama} onChange={e => setCatForm({ ...catForm, nama: e.target.value })} placeholder="Contoh: Sertifikasi" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Deskripsi</label>
                      <input type="text" value={catForm.deskripsi} onChange={e => setCatForm({ ...catForm, deskripsi: e.target.value })} placeholder="Opsional" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Status</label>
                      <div className="flex items-center gap-2">
                        {(["Aktif", "Tidak Aktif"] as const).map(s => (
                          <button key={s} onClick={() => setCatForm({ ...catForm, status: s })} className={cn("flex-1 py-2 rounded-xl text-xs font-semibold border", catForm.status === s ? (s === "Aktif" ? "bg-success/10 border-success/30 text-success" : "bg-warning/10 border-warning/30 text-warning") : "border-border text-muted-foreground")}>{s}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" icon={catForm.id ? Check : Plus} onClick={handleSaveCategory} disabled={catSaving || !catForm.nama.trim()}>{catSaving ? "Menyimpan..." : catForm.id ? "Simpan" : "Tambah"}</Button>
                      {catForm.id && <Button variant="outline" size="sm" onClick={resetCatForm}>Batal Edit</Button>}
                    </div>
                  </div>

                  {/* List */}
                  <div className="space-y-2">
                    {categories.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">Belum ada kategori</p> : categories.map(c => (
                      <div key={c.id} className={cn("flex items-center gap-3 p-3 rounded-xl border", catForm.id === c.id ? "border-primary bg-primary/5" : "border-border bg-card")}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{c.nama}</p>
                          <p className="text-xs text-muted-foreground truncate">{c.deskripsi || <span className="italic">Tanpa deskripsi</span>}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold", c.status === "Aktif" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>{c.status}</span>
                            <span className="text-[10px] text-muted-foreground">{docs.filter(d => d.category_id === c.id).length} dokumen</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => startEditCategory(c)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                          <button
                            onClick={() => setCatDeleteId(c.id)}
                            disabled={docs.some(d => d.category_id === c.id)}
                            title={docs.some(d => d.category_id === c.id) ? "Tidak dapat dihapus: masih dipakai" : "Hapus kategori"}
                            className={cn("p-1.5 rounded-lg", docs.some(d => d.category_id === c.id) ? "text-muted-foreground/30 cursor-not-allowed" : "hover:bg-danger-light text-muted-foreground hover:text-danger")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-border bg-muted/20 flex justify-end flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => { setShowCategoryManage(false); resetCatForm(); }}>Tutup</Button>
                </div>

                {/* inline delete confirm */}
                {catDeleteId !== null && (
                  <div className="absolute inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card rounded-2xl p-6 shadow-2xl w-full max-w-sm">
                      <div className="w-12 h-12 rounded-xl bg-danger/10 flex items-center justify-center mx-auto mb-3"><Trash2 className="w-6 h-6 text-danger" /></div>
                      <h3 className="text-sm font-bold text-center text-foreground">Hapus kategori?</h3>
                      <p className="text-xs text-muted-foreground text-center mt-1">Kategori &ldquo;{categories.find(c => c.id === catDeleteId)?.nama}&rdquo; akan dihapus permanen.</p>
                      <div className="flex items-center gap-2 mt-4">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => setCatDeleteId(null)}>Batal</Button>
                        <Button variant="danger" size="sm" className="flex-1" onClick={() => handleDeleteCategory(catDeleteId!)}>Hapus</Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Portal>
        )}

        {/* Archive confirm */}
        {archiveConfirm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setArchiveConfirm(null)} />
              <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
                <div className="p-6 text-center">
                  <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4", archiveConfirm.nextStatus === "Diarsipkan" ? "bg-warning/10" : "bg-success/10")}>
                    {archiveConfirm.nextStatus === "Diarsipkan" ? <Archive className="w-7 h-7 text-warning" /> : <ArchiveRestore className="w-7 h-7 text-success" />}
                  </div>
                  <h3 className="text-base font-bold text-foreground">{archiveConfirm.nextStatus === "Diarsipkan" ? "Arsipkan Dokumen?" : "Pulihkan Dokumen?"}</h3>
                  <p className="text-sm text-muted-foreground mt-2">&ldquo;<span className="font-semibold text-foreground">{archiveConfirm.doc.judul}</span>&rdquo; akan {archiveConfirm.nextStatus === "Diarsipkan" ? "diarsipkan" : "dipulihkan"}.</p>
                  {archiveConfirm.nextStatus === "Diarsipkan" && <p className="text-xs text-muted-foreground mt-1">Dokumen diarsipkan tidak dapat ditambah versi hingga dipulihkan.</p>}
                </div>
                <div className="flex items-center gap-3 px-6 pb-6">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setArchiveConfirm(null)}>Batal</Button>
                  <Button size="sm" className="flex-1" variant={archiveConfirm.nextStatus === "Diarsipkan" ? "primary" : "primary"} onClick={handleArchive}>{archiveConfirm.nextStatus === "Diarsipkan" ? "Arsipkan" : "Pulihkan"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* Delete confirm hard */}
        {deleteConfirm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
              <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
                <div className="p-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-danger" /></div>
                  <h3 className="text-base font-bold text-foreground">Hapus Permanen?</h3>
                  <p className="text-sm text-muted-foreground mt-2">Dokumen &ldquo;<span className="font-semibold text-foreground">{deleteConfirm.judul}</span>&rdquo; dan semua versi/file akan dihapus permanen termasuk dari storage.</p>
                  <p className="text-xs text-danger mt-2 font-medium">Tindakan ini tidak dapat dibatalkan.</p>
                </div>
                <div className="flex items-center gap-3 px-6 pb-6">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                  <Button variant="danger" size="sm" icon={Trash2} className="flex-1" onClick={handleDelete} disabled={deleting}>{deleting ? "Menghapus..." : "Hapus Permanen"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    </RouteGuard>
  );
}
