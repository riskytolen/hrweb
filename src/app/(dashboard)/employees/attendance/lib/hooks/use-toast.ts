"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type ToastType = "success" | "error";

export type ToastState = {
  show: boolean;
  title: string;
  message: string;
  type: ToastType;
};

const INITIAL: ToastState = { show: false, title: "", message: "", type: "success" };

const TOAST_DURATION_MS = 3500;

/**
 * Simple toast notification hook.
 * - Auto-dismiss after 3.5s
 * - Calling `show()` while a toast is still visible replaces it
 * - Cleans up timer on unmount
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(INITIAL);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((type: ToastType, title: string, message?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ show: true, title, message: message || "", type });
    timerRef.current = setTimeout(() => setToast(INITIAL), TOAST_DURATION_MS);
  }, []);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(INITIAL);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { toast, show, dismiss };
}
