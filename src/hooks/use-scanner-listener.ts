"use client";

import { useEffect, useRef } from "react";
import { normalizeScan } from "@/lib/barcode";

/**
 * Detects USB/Bluetooth "keyboard wedge" scanners anywhere on the page: a burst of
 * characters typed faster than a human (<50ms apart) followed by Enter. Ignored
 * while the user is typing in a text field (those fields handle Enter themselves).
 */
export function useScannerListener(onScan: (code: string) => void, enabled = true) {
  const buffer = useRef("");
  const last = useRef(0);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      const now = performance.now();
      if (now - last.current > 50) buffer.current = "";
      last.current = now;
      if (e.key === "Enter") {
        const code = normalizeScan(buffer.current);
        buffer.current = "";
        if (code.length >= 3) {
          e.preventDefault();
          cb.current(code);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buffer.current += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
