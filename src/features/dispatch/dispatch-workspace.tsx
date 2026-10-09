"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, CheckCircle2, Minus, PackageCheck, Plus, RotateCcw, ScanBarcode, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { ConfirmAction } from "@/components/shared/confirm-button";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { normalizeScan } from "@/lib/barcode";
import { beepError, beepOk } from "@/lib/feedback";
import { D } from "@/lib/decimal";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useScannerListener } from "@/hooks/use-scanner-listener";

interface Item {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  required: string;
  scanned: string;
}

interface DispatchView {
  id: string;
  number: string;
  status: string;
  address: string | null;
  phone: string | null;
  customerName: string;
  saleNumber: string;
  carrier: string | null;
  trackingNumber: string | null;
  packedInfo: string | null;
  dispatchedInfo: string | null;
  completedInfo: string | null;
  items: Item[];
}

export function DispatchWorkspace({ dispatch: d, canManage }: { dispatch: DispatchView; canManage: boolean }) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const packing = d.status === "PENDING" && canManage;
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(d.items.map((i) => [i.id, d.status === "PENDING" ? 0 : Number(i.scanned)])));
  const [code, setCode] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{ item: string; required: string; scanned: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [carrier, setCarrier] = useState(d.carrier ?? "");
  const [tracking, setTracking] = useState(d.trackingNumber ?? "");

  const byCode = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of d.items) {
      if (i.barcode) m.set(i.barcode, i);
      m.set(i.sku.toLowerCase(), i);
    }
    return m;
  }, [d.items]);

  function scan(raw: string) {
    const c = normalizeScan(raw);
    setCode("");
    if (!c || !packing) return;
    const item = byCode.get(c) ?? byCode.get(c.toLowerCase());
    if (!item) {
      beepError();
      setWarning(`This item does not belong to this order. (${c})`);
      return;
    }
    const current = counts[item.id] ?? 0;
    if (D(current + 1).gt(D(item.required))) {
      beepError();
      setWarning(`Too many: ${item.name} — Required: ${formatQty(item.required)}, Scanned: ${current + 1}`);
      return;
    }
    beepOk();
    setWarning(null);
    setMismatch(null);
    setCounts({ ...counts, [item.id]: current + 1 });
  }
  useScannerListener(scan, packing);

  const allMatch = d.items.every((i) => D(counts[i.id] ?? 0).eq(D(i.required)));
  const scannedTotal = d.items.reduce((a, i) => a + (counts[i.id] ?? 0), 0);
  const requiredTotal = d.items.reduce((a, i) => a.plus(D(i.required)), D(0));

  async function pack() {
    setBusy(true);
    try {
      await api(`/api/dispatch/${d.id}/pack`, { body: { items: d.items.map((i) => ({ dispatchItemId: i.id, scannedQty: String(counts[i.id] ?? 0) })) } });
      toast.success("All items verified — order packed");
      router.refresh();
    } catch (err) {
      beepError();
      if (err instanceof ApiError && err.details && typeof err.details === "object" && "mismatches" in err.details) {
        setMismatch((err.details as { mismatches: { item: string; required: string; scanned: string }[] }).mismatches);
      }
      toast.error(errorMessage(err), { duration: 9000 });
    } finally {
      setBusy(false);
    }
  }

  async function ship() {
    setBusy(true);
    try {
      await api(`/api/dispatch/${d.id}/ship`, { body: { carrier: carrier || null, trackingNumber: tracking || null } });
      toast.success("Order dispatched");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card className="print-area">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Items to pack</span>
            <span className="text-sm font-normal text-muted-foreground tabular">
              {scannedTotal} / {formatQty(requiredTotal)} scanned
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {packing && (
            <div className="no-print space-y-2">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  scan(code);
                }}
              >
                <div className="relative flex-1">
                  <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-primary" />
                  <Input ref={scanRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan each item’s barcode…" className="h-11 pl-10 text-base" aria-label="Scan item barcode" data-testid="dispatch-scan" />
                </div>
                <Button type="button" variant="outline" className="h-11" onClick={() => setCamera(true)} aria-label="Scan with camera">
                  <Camera />
                </Button>
              </form>
              {warning && (
                <div role="alert" data-testid="dispatch-warning" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800">
                  ⚠ Warning: {warning}
                </div>
              )}
            </div>
          )}
          <ul className="divide-y rounded-lg border">
            {d.items.map((i) => {
              const got = counts[i.id] ?? 0;
              const ok = D(got).eq(D(i.required));
              const mm = mismatch?.find((m) => m.item === i.name);
              return (
                <li key={i.id} className={cn("flex items-center gap-3 p-3", ok && "bg-emerald-50/60", mm && "bg-red-50")}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{i.barcode ?? i.sku}</div>
                    {mm && <div className="text-xs font-medium text-red-700">Required: {mm.required} · Scanned: {mm.scanned}</div>}
                  </div>
                  {packing && (
                    <div className="no-print flex items-center gap-1">
                      <Button variant="outline" size="icon-sm" aria-label={`Remove one ${i.name}`} onClick={() => setCounts({ ...counts, [i.id]: Math.max(0, got - 1) })}>
                        <Minus />
                      </Button>
                      <Button variant="outline" size="icon-sm" aria-label={`Add one ${i.name} manually`} onClick={() => scan(i.barcode ?? i.sku)}>
                        <Plus />
                      </Button>
                    </div>
                  )}
                  <div className={cn("w-24 text-right text-sm font-semibold tabular", ok ? "text-emerald-700" : got > 0 ? "text-amber-700" : "text-muted-foreground")} data-testid={`dispatch-count-${i.sku}`}>
                    {got} / {formatQty(i.required)}
                  </div>
                  {ok && <CheckCircle2 className="size-5 text-emerald-600" aria-label="Verified" />}
                </li>
              );
            })}
          </ul>
          {packing && (
            <div className="no-print flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => { setCounts(Object.fromEntries(d.items.map((i) => [i.id, 0]))); setWarning(null); setMismatch(null); }}>
                <RotateCcw /> Reset scans
              </Button>
              <Button onClick={pack} disabled={busy || !allMatch} data-testid="mark-packed">
                <PackageCheck /> {allMatch ? "Mark as packed" : "Scan all items to continue"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deliver to</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-medium">{d.customerName}</div>
            {d.phone && <div>{d.phone}</div>}
            <div className="whitespace-pre-line text-muted-foreground">{d.address ?? "No address"}</div>
          </CardContent>
        </Card>
        <Card className="no-print">
          <CardContent className="space-y-3 p-5 text-sm">
            {d.packedInfo && <div className="text-xs text-muted-foreground">{d.packedInfo}</div>}
            {d.dispatchedInfo && <div className="text-xs text-muted-foreground">{d.dispatchedInfo}{d.carrier ? ` · ${d.carrier}` : ""}{d.trackingNumber ? ` · ${d.trackingNumber}` : ""}</div>}
            {d.completedInfo && <div className="text-xs text-muted-foreground">{d.completedInfo}</div>}
            {d.status === "PACKED" && canManage && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="d-carrier">Courier / transporter</Label>
                  <Input id="d-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-track">Tracking / LR number</Label>
                  <Input id="d-track" value={tracking} onChange={(e) => setTracking(e.target.value)} />
                </div>
                <Button className="w-full" onClick={ship} disabled={busy} data-testid="mark-dispatched">
                  <Truck /> Dispatch
                </Button>
                <ConfirmAction url={`/api/dispatch/${d.id}/unpack`} label="Re-open packing" variant="outline" size="sm" title="Re-open packing?" description="Scans will be cleared and the order goes back to Pending." successMessage="Packing re-opened" />
              </>
            )}
            {d.status === "DISPATCHED" && canManage && (
              <ConfirmAction url={`/api/dispatch/${d.id}/complete`} label="Mark delivered / completed" icon={<CheckCircle2 />} title="Mark as delivered?" description="Confirm the customer has received this order." confirmLabel="Mark completed" successMessage="Dispatch completed" />
            )}
            {d.status === "COMPLETED" && <p className="text-emerald-700">This order has been delivered.</p>}
            {d.status === "CANCELLED" && <p className="text-muted-foreground">This dispatch was cancelled because the sale was cancelled.</p>}
          </CardContent>
        </Card>
      </div>
      <CameraScanner open={camera} onOpenChange={(o) => { setCamera(o); if (!o) scanRef.current?.focus(); }} onScan={scan} />
    </div>
  );
}
