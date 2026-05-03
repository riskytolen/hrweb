"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

// Standalone supabase client (halaman ini tidak pakai auth context)
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

      if (fetchErr || !data) {
        setState("invalid");
        return;
      }

      // Cek expired
      if (new Date(data.expires_at) < new Date()) {
        await supabase.from("face_register_tokens").update({ status: "expired" }).eq("id", token);
        setState("expired");
        return;
      }

      // Cek sudah selesai
      if (data.status === "completed") {
        setState("completed");
        return;
      }

      if (data.status === "expired") {
        setState("expired");
        return;
      }

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
  const startWebcam = async () => {
    setWebcamError(false);
    setError("");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser tidak mendukung kamera. Gunakan Chrome/Safari.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 640 }, facingMode: "user" },
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
        ? "Izin kamera ditolak. Berikan izin kamera di pengaturan browser."
        : err instanceof Error ? err.message : "Gagal mengakses kamera.";
      setError(msg);
      setWebcamError(true);
    }
  };

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

  const detectLoop = () => {
    const faceapi = faceApiRef.current;
    if (!faceapi || !videoRef.current) return;

    const detect = async () => {
      if (detectAbortRef.current) return;
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;
      try {
        const detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
          .withFaceLandmarks();
        if (detectAbortRef.current) return;
        setFaceDetected(!!detection);
      } catch {
        // ignore
      }
      if (!detectAbortRef.current) {
        animFrameRef.current = requestAnimationFrame(detect);
      }
    };
    detect();
  };

  // ─── Start capture flow ───
  const handleStart = async () => {
    setState("capturing");
    const loaded = await loadModels();
    if (!loaded) { setState("ready"); return; }
    setTimeout(() => startWebcam(), 150);
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
        setError("Wajah tidak terdeteksi. Pastikan wajah terlihat jelas dan coba lagi.");
        setState("capturing");
        setTimeout(() => startWebcam(), 150);
        return;
      }

      const descriptor = Array.from(detection.descriptor);

      // Simpan ke database
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
        setTimeout(() => startWebcam(), 150);
        return;
      }

      // Update token status
      await supabase.from("face_register_tokens").update({ status: "completed" }).eq("id", token);

      setState("success");
    } catch (err) {
      setError("Terjadi kesalahan. Silakan coba lagi.");
      setState("capturing");
      setTimeout(() => startWebcam(), 150);
      console.error(err);
    }
  };

  // Cleanup
  useEffect(() => {
    return () => { stopWebcam(); };
  }, [stopWebcam]);

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════

  // Loading
  if (state === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-500 mt-4">Memvalidasi link...</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (state === "invalid") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900">Link Tidak Valid</h1>
          <p className="text-sm text-slate-500 mt-2">Link pendaftaran wajah ini tidak valid atau sudah tidak berlaku.</p>
        </div>
      </div>
    );
  }

  // Expired
  if (state === "expired") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900">Link Kedaluwarsa</h1>
          <p className="text-sm text-slate-500 mt-2">Link ini sudah melewati batas waktu. Minta admin untuk generate QR Code baru.</p>
        </div>
      </div>
    );
  }

  // Already completed
  if (state === "completed") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900">Sudah Terdaftar</h1>
          <p className="text-sm text-slate-500 mt-2">Wajah sudah berhasil didaftarkan sebelumnya.</p>
        </div>
      </div>
    );
  }

  // Success
  if (state === "success") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Berhasil!</h1>
          <p className="text-sm text-slate-500 mt-2">
            Wajah <span className="font-semibold text-slate-700">{tokenData?.pegawai?.nama}</span> berhasil didaftarkan.
          </p>
          <p className="text-xs text-slate-400 mt-4">Halaman ini bisa ditutup.</p>
        </div>
      </div>
    );
  }

  // Ready state — show employee info + start button
  if (state === "ready") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900">Pendaftaran Wajah</h1>
          <div className="mt-3 bg-slate-50 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-400 uppercase font-semibold tracking-wider">Pegawai</p>
            <p className="text-base font-bold text-slate-800 mt-0.5">{tokenData?.pegawai?.nama || tokenData?.employee_id}</p>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Pastikan pencahayaan cukup dan wajah terlihat jelas saat capture.
          </p>
          <button
            onClick={handleStart}
            disabled={modelsLoading}
            className="mt-6 w-full py-3.5 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            {modelsLoading ? "Memuat Model..." : "Mulai Capture"}
          </button>
        </div>
      </div>
    );
  }

  // Capturing / Processing
  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Camera view */}
      <div className="flex-1 relative">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />

        {/* Face detection overlay */}
        {webcamActive && (
          <div className="absolute top-4 left-4 right-4 flex justify-center">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold backdrop-blur-md ${faceDetected ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"}`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${faceDetected ? "bg-green-400" : "bg-amber-400"}`} />
              {faceDetected ? "Wajah Terdeteksi" : "Posisikan Wajah Anda"}
            </div>
          </div>
        )}

        {/* Webcam loading */}
        {state === "capturing" && !webcamActive && !webcamError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 border-3 border-white/50 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Webcam error */}
        {webcamError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
            <svg className="w-12 h-12 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            <p className="text-white/50 text-sm text-center">Kamera tidak tersedia</p>
            <button onClick={startWebcam} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white/70 text-xs font-medium">
              Coba Lagi
            </button>
          </div>
        )}

        {/* Processing overlay */}
        {state === "processing" && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-white/80 text-sm font-medium">Memproses wajah...</p>
          </div>
        )}

        {/* Face guide oval */}
        {webcamActive && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-56 h-72 rounded-full border-2 border-dashed transition-colors ${faceDetected ? "border-green-400/60" : "border-white/30"}`} />
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="bg-black/90 backdrop-blur-sm px-6 py-6 safe-area-bottom">
        {/* Error message */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-300 text-xs text-center">{error}</p>
          </div>
        )}

        {/* Employee name */}
        <p className="text-white/50 text-xs text-center mb-4">
          {tokenData?.pegawai?.nama || tokenData?.employee_id}
        </p>

        {/* Capture button */}
        {state === "capturing" && (
          <div className="flex justify-center">
            <button
              onClick={handleCapture}
              disabled={!faceDetected}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                faceDetected
                  ? "bg-white hover:bg-white/90 shadow-lg shadow-white/20 active:scale-95"
                  : "bg-white/20 cursor-not-allowed"
              }`}
            >
              <div className={`w-16 h-16 rounded-full border-4 ${faceDetected ? "border-blue-500" : "border-white/30"}`} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
