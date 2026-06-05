"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Generic click-outside detector. Calls `handler` when a mousedown happens
 * outside the referenced element. Useful for dropdowns, modals, popovers.
 */
export function useClickOutside<T extends HTMLElement>(handler: () => void) {
  const ref = useRef<T>(null);
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handlerRef.current();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  return ref;
}

/**
 * Generic dropdown menu with open state + click-outside to close.
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, setOpen, toggle, close, ref };
}
