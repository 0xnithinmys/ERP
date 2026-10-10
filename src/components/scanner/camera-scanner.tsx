"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Loader2, ScanLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { normalizeScan } from "@/lib/barcode";

interface Controls {
  stop: () => void;
}

/**
 * Camera barcode scanner. The decoder (ZXing) is loaded lazily only when the
 * dialog opens. Stays open for continuous scanning and ignores the same code
 * seen again within 1.5 s to prevent accidental duplicate scans.
 */
export function CameraScanner({
  open,
  onOpenChange,
  onScan,
  title = "Scan barcode",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onScan: (code: string) => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const recent = useRef<{ code: string; at: number } | null>(null);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!open) return;
    let controls: Controls | null = null;
    let cancelled = false;
    setStatus("starting");
    setError(null);
    setLastCode(null);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera is not available in this browser (HTTPS is required).");
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
        ]);
        // No TRY_HARDER: it costs ~10x per frame (400–800 ms) on the main thread.
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        if (cancelled || !videoRef.current) return;
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
          videoRef.current,
          (result) => {
            if (!result) return;
            const code = normalizeScan(result.getText());
            const now = Date.now();
            if (recent.current && recent.current.code === code && now - recent.current.at < 1500) return;
            recent.current = { code, at: now };
            setLastCode(code);
            setFlash(true);
            setTimeout(() => setFlash(false), 250);
            cb.current(code);
          },
        );
        if (cancelled) controls.stop();
        else setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const name = (err as Error)?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : (err as Error)?.message || "Could not start the camera.",
        );
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Align the barcode inside the frame. The scanner stays ready for the next item.</DialogDescription>
        </DialogHeader>
        <div className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-black ring-4 transition-colors ${flash ? "ring-emerald-500" : "ring-transparent"}`}>
          <video ref={videoRef} className="size-full object-cover" muted playsInline aria-label="Camera preview" />
          {status === "ready" && (
            <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-md border-2 border-white/80">
              <ScanLine className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-white/70" />
            </div>
          )}
          {status === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Loader2 className="mr-2 size-5 animate-spin" /> Starting camera…
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white">
              <CameraOff className="size-7" />
              {error}
            </div>
          )}
        </div>
        <div className="min-h-5 text-center text-sm" aria-live="polite">
          {lastCode ? (
            <span>
              Last scan: <span className="font-mono font-medium">{lastCode}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Waiting for a barcode…</span>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
