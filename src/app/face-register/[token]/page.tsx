"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type TokenData = {
  id: string;
  employee_id: string;
  status: string;
  expires_at: string;
  pegawai?: { nama: string } | null;
};

type PageState = "loading" | "invalid" | "expired" | "completed" | "ready" | "capturing" | "processing" | "success";

export default function FaceRegisterPage() {
  const params = useParams();
  const token = params.token as string;

  const [state, setState] = useState<PageState>("loading");
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [error, setError] = useState("");
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const detectAbortRef = useRef(false);
  const faceApiRef = useRef<typeof import("face-api.js") | null>(null);

  // ─── Validate token ───
  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    const validate = async () => {
      const { data, error: fetchErr } = await supabase
        .from("face_register_tokens")
        .select("*, pegawai(nama)")
        .eq("id", token)
        .single();
      if (fetchErr || !data) { setState("invalid"); return; }
      if (new Date(data.expires_at) < new Date()) {
        await supabase.from("face_register_tokens").update({ status: "expired" }).eq("id", token);
        setState("expired"); return;
      }
      if (data.status === "completed") { setState("completed"); return; }
      if (data.status === "expired") { setState("expired"); return; }
      setTokenData(data as TokenData);
      setState("ready");
    };
    validate();
  }, [token]);

  // ─── Load face-api models ───
  const loadModels = async () => {
    if (modelsLoaded) return true;
    setModelsLoading(true);
    try {
      const faceapi = await import("face-api.js");
      faceApiRef.current = faceapi;
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      setModelsLoaded(true);
      setModelsLoading(false);
      return true;
    } catch {
      setModelsLoading(false);
      setError("Gagal memuat model. Periksa koneksi internet.");
      return false;
    }
  };

  // ─── Webcam ───
  const startWebcam = useCallback(async (facing?: "user" | "environment") => {
    const mode = facing || facingMode;
    setWebcamError(false);
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser tidak mendukung kamera.");
      }
      // Stop existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setWebcamActive(true);
      detectAbortRef.current = false;
      detectLoop();
    } catch (err) {
      const msg = err instanceof Error && err.name === "NotAllowedError"
        ? "Izin kamera ditolak. Berikan izin di pengaturan browser."
        : err instanceof Error ? err.message : "Gagal mengakses kamera.";
      setError(msg);
      setWebcamError(true);
    }
  }, [facingMode]);

  const stopWebcam = useCallback(() => {
    detectAbortRef.current = true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setWebcamActive(false);
    setFaceDetected(false);
  }, []);

  const switchCamera = () => {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    if (webcamActive) {
      stopWebcam();
      setTimeout(() => startWebcam(next), 200);
    }
  };

  const detectLoop = () => {
    const faceapi = faceApiRef.current;
    if (!faceapi || !videoRef.current) return;
    const detect = async () => {
      if (detectAbortRef.current) return;
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;
      try {
        const det = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
          .withFaceLandmarks();
        if (detectAbortRef.current) return;
        setFaceDetected(!!det);
      } catch { /* ignore */ }
      if (!detectAbortRef.current) animFrameRef.current = requestAnimationFrame(detect);
    };
    detect();
  };

  // ─── Start capture flow ───
  const handleStart = async () => {
    setState("capturing");
    const loaded = await loadModels();
    if (!loaded) { setState("ready"); return; }
    setTimeout(() => startWebcam(), 200);
  };

  // ─── Capture & process ───
  const handleCapture = async () => {
    const faceapi = faceApiRef.current;
    if (!faceapi || !videoRef.current || !canvasRef.current) return;
    setState("processing");
    setError("");
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas error");
      // Mirror jika kamera depan
      if (facingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0);
      stopWebcam();

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Blob error")), "image/jpeg", 0.9);
      });
      const imageUrl = URL.createObjectURL(blob);
      const img = await faceapi.fetchImage(imageUrl);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      URL.revokeObjectURL(imageUrl);

      if (!detection) {
        setError("Wajah tidak terdeteksi. Coba lagi dengan pencahayaan lebih baik.");
        setState("capturing");
        setTimeout(() => startWebcam(), 200);
        return;
      }

      const descriptor = Array.from(detection.descriptor);
      const { error: dbErr } = await supabase
        .from("employee_face_profiles")
        .upsert({
          employee_id: tokenData!.employee_id,
          face_data_ref: JSON.stringify(descriptor),
          status: "Aktif",
          enrolled_at: new Date().toISOString(),
        }, { onConflict: "employee_id" });

      if (dbErr) {
        setError(`Gagal menyimpan: ${dbErr.message}`);
        setState("capturing");
        setTimeout(() => startWebcam(), 200);
        return;
      }

      await supabase.from("face_register_tokens").update({ status: "completed" }).eq("id", token);
      setState("success");
    } catch (err) {
      setError("Terjadi kesalahan. Silakan coba lagi.");
      setState("capturing");
      setTimeout(() => startWebcam(), 200);
      console.error(err);
    }
  };

  useEffect(() => { return () => { stopWebcam(); }; }, [stopWebcam]);

  // ═══════════════════════════════════════════
  // RENDER — Status pages (non-camera)
  // ═══════════════════════════════════════════

  if (state === "loading") {
    return (
      <StatusPage>
        <div className="w-12 h-12 rounded-full border-[3px] border-blue-500/30 border-t-blue-500 animate-spin" />
        <p className="text-sm text-slate-400 mt-3">Memvalidasi link...</p>
      </StatusPage>
    );
  }

  if (state === "invalid") {
    return (
      <StatusPage>
        <StatusIcon color="red">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </StatusIcon>
        <h1 className="text-xl font-bold text-slate-900 mt-1">Link Tidak Valid</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-[260px]">Link pendaftaran wajah ini tidak valid atau sudah tidak berlaku.</p>
      </StatusPage>
    );
  }

  if (state === "expired") {
    return (
      <StatusPage>
        <StatusIcon color="amber">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </StatusIcon>
        <h1 className="text-xl font-bold text-slate-900 mt-1">Link Kedaluwarsa</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-[260px]">Link sudah melewati batas waktu. Minta admin untuk generate QR Code baru.</p>
      </StatusPage>
    );
  }

  if (state === "completed") {
    return (
      <StatusPage>
        <StatusIcon color="green">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </StatusIcon>
        <h1 className="text-xl font-bold text-slate-900 mt-1">Sudah Terdaftar</h1>
        <p className="text-sm text-slate-500 mt-2">Wajah sudah berhasil didaftarkan sebelumnya.</p>
      </StatusPage>
    );
  }

  if (state === "success") {
    return (
      <StatusPage>
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-green-50 flex items-center justify-center">
            <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          {/* Animated ring */}
          <div className="absolute inset-0 rounded-full border-2 border-green-400/40 animate-ping" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Berhasil!</h1>
        <p className="text-sm text-slate-500 mt-1">
          Wajah <span className="font-semibold text-slate-700">{tokenData?.pegawai?.nama}</span> berhasil didaftarkan.
        </p>
        <div className="mt-6 px-4 py-2.5 bg-slate-100 rounded-xl">
          <p className="text-xs text-slate-400">Halaman ini bisa ditutup</p>
        </div>
      </StatusPage>
    );
  }

  // ─── Ready state ───
  if (state === "ready") {
    return (
      <StatusPage>
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mt-2">Pendaftaran Wajah</h1>
        <div className="mt-3 w-full max-w-[280px] bg-slate-50 rounded-xl px-4 py-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Pegawai</p>
          <p className="text-base font-bold text-slate-800 mt-0.5">{tokenData?.pegawai?.nama || tokenData?.employee_id}</p>
        </div>
        <div className="mt-4 space-y-1.5 text-center">
          <p className="text-xs text-slate-500">Pastikan:</p>
          <div className="flex flex-col gap-1">
            {["Pencahayaan cukup terang", "Wajah menghadap kamera", "Tidak memakai masker/kacamata hitam"].map((t) => (
              <div key={t} className="flex items-center gap-2 text-xs text-slate-500">
                <div className="w-1 h-1 rounded-full bg-blue-400 flex-shrink-0" />
                {t}
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={handleStart}
          disabled={modelsLoading}
          className="mt-6 w-full max-w-[280px] py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-slate-300 disabled:to-slate-300 text-white font-bold rounded-2xl transition-all text-sm shadow-lg shadow-blue-500/25 active:scale-[0.98]"
        >
          {modelsLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Memuat Model...
            </span>
          ) : "Buka Kamera"}
        </button>
      </StatusPage>
    );
  }

  // ═══════════════════════════════════════════
  // CAMERA VIEW — Full screen immersive
  // ═══════════════════════════════════════════
  return (
    <div className="fixed inset-0 bg-black select-none" style={{ touchAction: "none" }}>
      {/* Video — full screen */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={facingMode === "user" ? { transform: "scaleX(-1)" } : undefined}
        muted
        playsInline
        autoPlay
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Dark vignette overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 70% 50% at 50% 45%, transparent 0%, rgba(0,0,0,0.5) 100%)",
      }} />

      {/* ─── Top bar ─── */}
      <div className="absolute top-0 left-0 right-0 z-10" style={{ paddingTop: "env(safe-area-inset-top, 12px)" }}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          {/* Employee name pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-white/90 text-xs font-medium truncate max-w-[160px]">
              {tokenData?.pegawai?.nama || tokenData?.employee_id}
            </span>
          </div>

          {/* Switch camera button */}
          <button
            onClick={switchCamera}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform"
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Face detection status */}
        {webcamActive && (
          <div className="flex justify-center mt-1">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md text-xs font-semibold transition-all duration-300 ${
              faceDetected ? "bg-green-500/25 text-green-300" : "bg-amber-500/25 text-amber-300"
            }`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${faceDetected ? "bg-green-400" : "bg-amber-400"}`} />
              {faceDetected ? "Wajah Terdeteksi" : "Posisikan Wajah Anda"}
            </div>
          </div>
        )}
      </div>

      {/* ─── Face guide ─── */}
      {webcamActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: "80px" }}>
          <div className="relative">
            {/* Oval guide */}
            <div className={`w-52 h-68 rounded-full border-[2.5px] transition-all duration-500 ${
              faceDetected ? "border-green-400/70 shadow-[0_0_30px_rgba(74,222,128,0.15)]" : "border-white/25"
            }`} style={{ aspectRatio: "3/4", width: "200px" }} />
            {/* Corner accents */}
            {faceDetected && (
              <>
                <div className="absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 border-green-400 rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 border-green-400 rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 border-green-400 rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 border-green-400 rounded-br-lg" />
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Loading state (no webcam yet) ─── */}
      {state === "capturing" && !webcamActive && !webcamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="w-14 h-14 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
          <p className="text-white/60 text-sm">Membuka kamera...</p>
        </div>
      )}

      {/* ─── Webcam error ─── */}
      {webcamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8">
          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
            <svg className="w-10 h-10 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-white/70 text-sm font-medium">Kamera Tidak Tersedia</p>
            <p className="text-white/40 text-xs mt-1">Pastikan izin kamera sudah diberikan</p>
          </div>
          <button
            onClick={() => startWebcam()}
            className="px-6 py-3 bg-white/10 hover:bg-white/15 rounded-xl text-white text-sm font-medium transition-colors active:scale-95"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* ─── Processing overlay ─── */}
      {state === "processing" && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-5 z-20">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-[3px] border-blue-500/30 border-t-blue-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
          </div>
          <div className="text-center">
            <p className="text-white text-base font-semibold">Memproses Wajah</p>
            <p className="text-white/50 text-xs mt-1">Menghasilkan face descriptor...</p>
          </div>
        </div>
      )}

      {/* ─── Error toast ─── */}
      {error && state === "capturing" && (
        <div className="absolute left-4 right-4 z-20" style={{ bottom: "160px" }}>
          <div className="bg-red-500/90 backdrop-blur-md rounded-xl px-4 py-3 shadow-lg">
            <p className="text-white text-xs text-center font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* ─── Bottom controls ─── */}
      <div className="absolute bottom-0 left-0 right-0 z-10" style={{ paddingBottom: "env(safe-area-inset-bottom, 20px)" }}>
        <div className="px-6 pb-6 pt-4">
          {/* Hint text */}
          {webcamActive && !faceDetected && (
            <p className="text-white/40 text-[11px] text-center mb-4">
              Posisikan wajah di dalam oval
            </p>
          )}

          {/* Capture button */}
          {state === "capturing" && (
            <div className="flex items-center justify-center">
              <button
                onClick={handleCapture}
                disabled={!faceDetected}
                className="group relative"
              >
                {/* Outer ring */}
                <div className={`w-[76px] h-[76px] rounded-full border-[3px] transition-all duration-300 flex items-center justify-center ${
                  faceDetected
                    ? "border-white active:scale-90"
                    : "border-white/25"
                }`}>
                  {/* Inner circle */}
                  <div className={`w-[62px] h-[62px] rounded-full transition-all duration-300 ${
                    faceDetected
                      ? "bg-white group-active:bg-white/80"
                      : "bg-white/15"
                  }`} />
                </div>
                {/* Pulse ring when face detected */}
                {faceDetected && (
                  <div className="absolute inset-0 rounded-full border-2 border-white/30 animate-ping" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Shared components
// ═══════════════════════════════════════════

function StatusPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-white via-slate-50 to-slate-100 flex flex-col items-center justify-center p-6 text-center">
      {children}
    </div>
  );
}

function StatusIcon({ color, children }: { color: "red" | "amber" | "green"; children: React.ReactNode }) {
  const bg = color === "red" ? "bg-red-50" : color === "amber" ? "bg-amber-50" : "bg-green-50";
  const text = color === "red" ? "text-red-500" : color === "amber" ? "text-amber-500" : "text-green-500";
  return (
    <div className={`w-20 h-20 ${bg} rounded-full flex items-center justify-center`}>
      <svg className={`w-10 h-10 ${text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">{children}</svg>
    </div>
  );
}
