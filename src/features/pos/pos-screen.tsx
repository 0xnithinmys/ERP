"use client";

import Link from "@/components/shared/app-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  Loader2,
  Minus,
  PackageSearch,
  PauseCircle,
  Plus,
  Printer,
  RotateCcw,
  ScanBarcode,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { api, ApiError, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { calculatePayment, calculateSale, CalculationError, unitAllowsDecimal, type PaymentModeCode } from "@/lib/calculations";
import { D } from "@/lib/decimal";
import { formatMoney, formatQty } from "@/lib/format";
import { normalizeScan } from "@/lib/barcode";
import { beepError, beepOk } from "@/lib/feedback";
import type { VariantHit } from "@/server/services/product.service";
import { useDebounced } from "@/hooks/use-debounced";
import { useSession } from "@/components/providers/session-provider";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";

interface CartLine {
  variantId: string;
  hit: VariantHit;
  quantity: string;
  discount: string;
  unitPrice: string;
}

interface HeldCart {
  id: string;
  at: number;
  label: string;
  lines: CartLine[];
  customer: PickedCustomer | null;
}

const HOLD_KEY = "pos.heldCarts.v1";
const MODES: { value: PaymentModeCode; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "CREDIT", label: "Credit" },
];

function readHeld(): HeldCart[] {
  try {
    return JSON.parse(localStorage.getItem(HOLD_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function PosScreen() {
  const { settings, can } = useSession();
  const canOverridePrice = can("sales.override_price");
  const taxRate = settings.taxEnabled ? settings.taxRate : "0";

  const scanRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, VariantHit>()); // barcode/sku → hit, for instant repeat scans

  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [billDiscount, setBillDiscount] = useState("");
  const [mode, setMode] = useState<PaymentModeCode>("CASH");
  const [received, setReceived] = useState("");
  const [delivery, setDelivery] = useState(false);
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());
  const [done, setDone] = useState<{ id: string; number: string; total: string; change: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [held, setHeld] = useState<HeldCart[]>([]);
  const [mobileCart, setMobileCart] = useState(false);

  useEffect(() => {
    setHeld(readHeld());
    // A scan that arrived before hydration only exists in the DOM — keep it.
    const pending = scanRef.current?.value;
    if (pending) setQ(pending);
  }, []);
  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 0), []);

  // ── Product grid (server-side search, debounced) ──
  const term = q.includes("*") ? q.split("*").slice(1).join("*") : q;
  const debounced = useDebounced(term.trim(), 160);
  const { data: results = [], isFetching } = useQuery({
    queryKey: ["pos-products", debounced],
    queryFn: ({ signal }) => api<VariantHit[]>(`/api/variants/search?q=${encodeURIComponent(debounced)}&type=FINISHED_GOOD&limit=24`, { signal }),
    placeholderData: (p) => p,
    staleTime: 30_000,
  });
  useEffect(() => setActive(0), [debounced]);

  // ── Cart operations (local, instant) ──
  const addToCart = useCallback(
    (hit: VariantHit, qtyToAdd = "1") => {
      if (hit.type !== "FINISHED_GOOD") {
        beepError();
        toast.error(`${hit.name} is a raw material and cannot be sold`);
        return;
      }
      if (!hit.isActive) {
        beepError();
        toast.error(`${hit.name} is inactive and cannot be sold`);
        return;
      }
      if (hit.barcode) cache.current.set(hit.barcode, hit);
      cache.current.set(hit.sku.toLowerCase(), hit);
      setLines((prev) => {
        const i = prev.findIndex((l) => l.variantId === hit.variantId);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], hit, quantity: D(next[i].quantity || 0).plus(qtyToAdd).toString() };
          return [next[i], ...next.filter((_, j) => j !== i)];
        }
        return [{ variantId: hit.variantId, hit, quantity: qtyToAdd, discount: "", unitPrice: hit.sellingPrice }, ...prev];
      });
      setLastAdded(hit.variantId);
      setNotFound(null);
      beepOk();
    },
    [],
  );

  async function handleScan(raw: string) {
    let input = raw.trim();
    let qtyToAdd = "1";
    const m = /^(\d+(?:\.\d{1,3})?)\s*\*\s*(.+)$/.exec(input);
    if (m) {
      qtyToAdd = m[1];
      input = m[2];
    }
    const code = normalizeScan(input);
    if (!code) return;
    if (D(qtyToAdd).lte(0)) {
      beepError();
      toast.error("Quantity must be greater than zero");
      return;
    }
    setQ("");
    const cached = cache.current.get(code) ?? cache.current.get(code.toLowerCase());
    if (cached) return addToCart(cached, qtyToAdd);
    try {
      const hit = await api<VariantHit | null>(`/api/variants/lookup?code=${encodeURIComponent(code)}`);
      if (hit) return addToCart(hit, qtyToAdd);
      // Not a barcode: use the highlighted product from the grid if the search matches.
      if (results.length > 0 && debounced && debounced === code) return addToCart(results[Math.min(active, results.length - 1)], qtyToAdd);
      beepError();
      setNotFound(code);
    } catch (err) {
      beepError();
      toast.error(errorMessage(err));
    }
  }

  const updateLine = (variantId: string, patch: Partial<CartLine>) =>
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  const removeLine = (variantId: string) => setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  const stepQty = (l: CartLine, delta: number) => {
    const next = D(l.quantity || 0).plus(delta);
    if (next.lte(0)) removeLine(l.variantId);
    else updateLine(l.variantId, { quantity: next.toString() });
  };

  function resetSale() {
    setLines([]);
    setCustomer(null);
    setBillDiscount("");
    setMode("CASH");
    setReceived("");
    setDelivery(false);
    setAddress("");
    setNotes("");
    setNotFound(null);
    setIdemKey(newIdempotencyKey());
    focusScan();
  }

  // ── Totals (same calculation module the server uses) ──
  const lineErrors = useMemo(() => {
    const errs = new Map<string, string>();
    for (const l of lines) {
      const q = D(l.quantity || 0);
      if (!/^\d+(\.\d{1,3})?$/.test(l.quantity) || q.lte(0)) errs.set(l.variantId, "Enter a quantity");
      else if (!unitAllowsDecimal(l.hit.unit) && !q.isInteger()) errs.set(l.variantId, "Whole numbers only");
      else if (l.discount && !/^\d+(\.\d{1,2})?$/.test(l.discount)) errs.set(l.variantId, "Invalid discount");
      else if (!/^\d+(\.\d{1,2})?$/.test(l.unitPrice)) errs.set(l.variantId, "Invalid price");
    }
    return errs;
  }, [lines]);

  const totals = useMemo(() => {
    try {
      return {
        ok: true as const,
        t: calculateSale(
          lines.filter((l) => !lineErrors.has(l.variantId)).map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount || "0" })),
          { billDiscount: /^\d+(\.\d{1,2})?$/.test(billDiscount) ? billDiscount : "0", taxRate },
        ),
      };
    } catch (err) {
      return { ok: false as const, error: err instanceof CalculationError ? err.message : "Invalid amounts" };
    }
  }, [lines, lineErrors, billDiscount, taxRate]);

  const total = totals.ok ? totals.t.total : D(0);
  // Empty amount = exact payment (credit: nothing paid now). Mirrors the server rule.
  const effectiveReceived = mode === "CREDIT" ? received || "0" : received === "" ? total.toFixed(2) : received;
  const payment = useMemo(() => {
    try {
      return calculatePayment(total, /^\d+(\.\d{1,2})?$/.test(effectiveReceived) ? effectiveReceived : "0", mode);
    } catch {
      return null;
    }
  }, [total, effectiveReceived, mode]);

  const stockWarnings = lines.filter((l) => !settings.allowNegativeStock && D(l.quantity || 0).gt(D(l.hit.onHand)));
  const needsCustomer = (payment?.balanceDue.gt(0) ?? false) && !customer;
  const canSubmit =
    lines.length > 0 && lineErrors.size === 0 && totals.ok && payment !== null && !needsCustomer && stockWarnings.length === 0 && !busy && (!delivery || !!customer || address.trim().length > 0);

  async function completeSale() {
    if (!canSubmit) {
      if (lines.length === 0) toast.error("Cart is empty — scan or add a product first");
      else if (needsCustomer) toast.error("Select a customer for credit or partially paid sales");
      else if (stockWarnings.length) toast.error("Some items exceed available stock");
      else if (delivery && !customer && !address.trim()) toast.error("Enter a delivery address or select a customer");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ id: string; number: string; total: string; changeGiven: string }>("/api/sales", {
        body: {
          customerId: customer?.id ?? null,
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            discount: l.discount || "",
            ...(canOverridePrice && l.unitPrice !== l.hit.sellingPrice ? { unitPrice: l.unitPrice } : {}),
          })),
          billDiscount: billDiscount || "",
          paymentMode: mode,
          amountReceived: effectiveReceived,
          requiresDispatch: delivery,
          dispatchAddress: delivery ? address : null,
          notes: notes || null,
          idempotencyKey: idemKey,
        },
      });
      toast.success("Sale completed successfully");
      setDone({ id: res.id, number: res.number, total: res.total, change: res.changeGiven });
      // Refresh cached stock for scanned items in the background.
      cache.current.clear();
      resetSale();
    } catch (err) {
      beepError();
      if (err instanceof ApiError && err.code === "INSUFFICIENT_STOCK") {
        toast.error(err.message, { duration: 10000 });
        void refreshCartStock();
      } else toast.error(errorMessage(err), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  async function refreshCartStock() {
    if (!lines.length) return;
    try {
      const hits = await api<VariantHit[]>("/api/variants/by-ids", { body: { ids: lines.map((l) => l.variantId) } });
      setLines((prev) => prev.map((l) => ({ ...l, hit: hits.find((h) => h.variantId === l.variantId) ?? l.hit })));
    } catch {
      /* non-critical */
    }
  }

  // ── Hold / restore ──
  function holdCart() {
    if (!lines.length) return;
    const next: HeldCart[] = [
      { id: newIdempotencyKey(), at: Date.now(), label: customer?.name ?? `Cart of ${lines.length} item(s)`, lines, customer },
      ...held,
    ].slice(0, 10);
    try {
      localStorage.setItem(HOLD_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable */
    }
    setHeld(next);
    resetSale();
    toast.success("Cart held. Restore it from “Held carts”.");
  }
  function restoreCart(h: HeldCart) {
    if (lines.length) holdCart();
    setLines(h.lines);
    setCustomer(h.customer);
    const rest = readHeld().filter((x) => x.id !== h.id);
    try {
      localStorage.setItem(HOLD_KEY, JSON.stringify(rest));
    } catch {}
    setHeld(rest);
    setHeldOpen(false);
    void refreshCartStock();
    focusScan();
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        scanRef.current?.focus();
        scanRef.current?.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        scanRef.current?.focus();
        scanRef.current?.select();
      } else if (e.key === "F4") {
        e.preventDefault();
        setMobileCart(true);
        setTimeout(() => cashRef.current?.focus(), 50);
      } else if (e.key === "F9") {
        e.preventDefault();
        void completeSale();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cartPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); if (c?.address && !address) setAddress(c.address); }} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <ScanBarcode className="size-10 opacity-40" />
            Scan a barcode or tap a product to start the bill.
          </div>
        ) : (
          <ul className="divide-y" aria-label="Cart">
            {lines.map((l) => {
              const err = lineErrors.get(l.variantId);
              const over = !settings.allowNegativeStock && D(l.quantity || 0).gt(D(l.hit.onHand));
              const lineTotal = D(/^\d+(\.\d{1,3})?$/.test(l.quantity) ? l.quantity : 0).times(D(l.unitPrice || 0)).minus(D(/^\d+(\.\d{1,2})?$/.test(l.discount) ? l.discount : 0));
              return (
                <li key={l.variantId} className={cn("space-y-1.5 p-3 transition-colors", lastAdded === l.variantId && "bg-primary/5")}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{l.hit.productName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {l.hit.label || l.hit.sku} · {formatMoney(l.unitPrice)}
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold tabular">{formatMoney(lineTotal.isNegative() ? 0 : lineTotal)}</div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.hit.name}`} onClick={() => removeLine(l.variantId)}>
                      <X />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-md border">
                      <Button variant="ghost" size="icon-sm" aria-label="Decrease quantity" onClick={() => stepQty(l, -1)}>
                        <Minus />
                      </Button>
                      <Input
                        value={l.quantity}
                        onChange={(e) => updateLine(l.variantId, { quantity: e.target.value.trim() })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") focusScan();
                          if (e.key === "ArrowUp") { e.preventDefault(); stepQty(l, 1); }
                          if (e.key === "ArrowDown") { e.preventDefault(); stepQty(l, -1); }
                        }}
                        inputMode="decimal"
                        className="h-7 w-14 border-0 text-center tabular shadow-none focus-visible:ring-0"
                        aria-label={`Quantity for ${l.hit.name}`}
                      />
                      <Button variant="ghost" size="icon-sm" aria-label="Increase quantity" onClick={() => stepQty(l, 1)}>
                        <Plus />
                      </Button>
                    </div>
                    <Input
                      value={l.discount}
                      onChange={(e) => updateLine(l.variantId, { discount: e.target.value.trim() })}
                      placeholder="Disc ₹"
                      inputMode="decimal"
                      className="h-7 w-20 text-xs tabular"
                      aria-label={`Discount for ${l.hit.name}`}
                    />
                    {canOverridePrice && (
                      <Input
                        value={l.unitPrice}
                        onChange={(e) => updateLine(l.variantId, { unitPrice: e.target.value.trim() })}
                        inputMode="decimal"
                        className="h-7 w-20 text-xs tabular"
                        aria-label={`Price for ${l.hit.name}`}
                        title="Unit price (admin override)"
                      />
                    )}
                  </div>
                  {(err || over) && (
                    <p className="text-xs text-destructive" role="alert">
                      {err ?? `Only ${formatQty(l.hit.onHand)} in stock`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t bg-muted/30 p-3">
        <div className="space-y-1 text-sm">
          <Row label={`Items (${totals.ok ? formatQty(totals.t.itemCount) : "—"})`} value={totals.ok ? formatMoney(totals.t.grossTotal) : "—"} />
          {totals.ok && totals.t.lineDiscountTotal.gt(0) && <Row label="Item discounts" value={`− ${formatMoney(totals.t.lineDiscountTotal)}`} />}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="bill-discount" className="font-normal text-muted-foreground">
              Bill discount
            </Label>
            <Input id="bill-discount" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value.trim())} placeholder="0.00" inputMode="decimal" className="h-7 w-24 text-right tabular" />
          </div>
          {settings.taxEnabled && totals.ok && <Row label={`${settings.taxLabel} (${settings.taxRate}%)`} value={formatMoney(totals.t.taxAmount)} />}
          {!totals.ok && <p className="text-xs text-destructive">{totals.error}</p>}
          <div className="flex items-center justify-between pt-1 text-lg font-semibold">
            <span>Total</span>
            <span className="tabular" data-testid="pos-total">{formatMoney(total)}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Payment mode">
          {MODES.map((m) => (
            <Button key={m.value} type="button" size="sm" role="radio" aria-checked={mode === m.value} variant={mode === m.value ? "default" : "outline"} onClick={() => { setMode(m.value); setReceived(""); }}>
              {m.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="amount-received" className="w-28 shrink-0 text-sm font-normal text-muted-foreground">
            {mode === "CASH" ? "Cash received" : mode === "CREDIT" ? "Paid now" : "Amount"}
          </Label>
          <Input
            id="amount-received"
            ref={cashRef}
            value={mode === "CASH" || mode === "CREDIT" ? received : received === "" ? total.toFixed(2) : received}
            onChange={(e) => setReceived(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && void completeSale()}
            placeholder={mode === "CASH" ? total.toFixed(2) : "0.00"}
            inputMode="decimal"
            className="h-9 text-right text-base tabular"
          />
          {mode === "CASH" && (
            <Button type="button" variant="outline" size="sm" onClick={() => setReceived(total.toFixed(2))}>
              Exact
            </Button>
          )}
        </div>
        {payment && (
          <div className="flex justify-between text-sm">
            {payment.change.gt(0) ? (
              <>
                <span className="text-muted-foreground">Change to return</span>
                <span className="font-semibold text-emerald-700 tabular">{formatMoney(payment.change)}</span>
              </>
            ) : payment.balanceDue.gt(0) && lines.length ? (
              <>
                <span className="text-muted-foreground">Balance due</span>
                <span className="font-semibold text-amber-700 tabular">{formatMoney(payment.balanceDue)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{lines.length ? "Fully paid" : ""}</span>
            )}
          </div>
        )}
        {needsCustomer && lines.length > 0 && <p className="text-xs text-amber-700">Select a customer for credit / partial payment.</p>}

        <div className="flex items-center gap-2">
          <Switch id="delivery" checked={delivery} onCheckedChange={setDelivery} />
          <Label htmlFor="delivery" className="text-sm font-normal">
            <Truck className="size-4" /> Needs dispatch / delivery
          </Label>
        </div>
        {delivery && <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address" rows={2} aria-label="Delivery address" />}
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" aria-label="Sale note" className="h-8 text-sm" />

        <Button className="h-12 w-full text-base" disabled={busy || lines.length === 0} onClick={() => void completeSale()} data-testid="complete-sale">
          {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
          {busy ? "Saving…" : `Complete payment · ${formatMoney(total)}`}
          <kbd className="ml-1 hidden rounded bg-primary-foreground/20 px-1 text-[10px] sm:inline">F9</kbd>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={holdCart} disabled={!lines.length}>
            <PauseCircle /> Hold
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setHeldOpen(true)}>
            <RotateCcw /> Held carts {held.length ? <Badge variant="secondary">{held.length}</Badge> : null}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-destructive"
            disabled={!lines.length}
            onClick={() => {
              if (confirm("Cancel this sale and clear the cart?")) resetSale();
            }}
          >
            <Trash2 /> Cancel
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="-m-3 flex h-[calc(100svh-3.5rem)] flex-col sm:-m-5 lg:-m-6">
      {/* Scan bar */}
      <div className="flex items-center gap-2 border-b bg-card p-3">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-primary" aria-hidden />
          <Input
            ref={scanRef}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setNotFound(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (q.trim()) void handleScan(q);
              } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                if (results.length) {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                }
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                if (results.length && q) {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                }
              } else if (e.key === "Escape") setQ("");
            }}
            placeholder="Scan barcode, or type to search (e.g. 3*8901234567890 adds 3)"
            className="h-12 pl-11 text-lg"
            aria-label="Scan barcode or search products"
            autoComplete="off"
            spellCheck={false}
            data-testid="pos-scan"
          />
          {isFetching && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <Button variant="outline" className="h-12" onClick={() => setCamera(true)} aria-label="Scan with camera">
          <Camera /> <span className="hidden sm:inline">Camera</span>
        </Button>
        <div className="hidden text-[11px] leading-tight text-muted-foreground xl:block">
          <div><kbd>F2</kbd> scan · <kbd>F4</kbd> pay</div>
          <div><kbd>F9</kbd> complete · <kbd>Esc</kbd> clear</div>
        </div>
      </div>

      {notFound && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <PackageSearch className="size-4" />
          <span className="font-medium">Product not found:</span>
          <span className="font-mono">{notFound}</span>
          {can("products.manage") && /^[A-Za-z0-9\-_.]{3,64}$/.test(notFound) && (
            <>
              <Button asChild size="xs" variant="outline">
                <Link href={`/products/new?barcode=${encodeURIComponent(notFound)}`} target="_blank">Create product</Link>
              </Button>
              <Button asChild size="xs" variant="outline">
                <Link href={`/products/register-barcode?barcode=${encodeURIComponent(notFound)}`} target="_blank">Register barcode</Link>
              </Button>
            </>
          )}
          <button className="ml-auto text-xs underline" onClick={() => { setNotFound(null); focusScan(); }}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Product grid */}
        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          {results.length === 0 && !isFetching ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No products match “{debounced}”.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {results.map((h, i) => {
                const inCart = lines.find((l) => l.variantId === h.variantId);
                const out = D(h.onHand).lte(0);
                return (
                  <button
                    key={h.variantId}
                    type="button"
                    onClick={() => { addToCart(h); focusScan(); }}
                    className={cn(
                      "relative flex flex-col rounded-lg border bg-card p-2.5 text-left text-sm transition-all hover:border-primary/50 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      i === active && q && "border-primary ring-2 ring-primary/20",
                      out && "opacity-60",
                    )}
                  >
                    {inCart && (
                      <span className="absolute top-1.5 right-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular">{formatQty(inCart.quantity)}</span>
                    )}
                    <span className="line-clamp-2 pr-6 font-medium leading-snug">{h.productName}</span>
                    <span className="truncate text-xs text-muted-foreground">{h.label || h.sku}</span>
                    <span className="mt-1.5 flex items-end justify-between gap-1">
                      <span className="font-semibold tabular">{formatMoney(h.sellingPrice)}</span>
                      <span className={cn("text-[11px] tabular", out ? "text-destructive" : h.status === "LOW_STOCK" ? "text-amber-700" : "text-muted-foreground")}>
                        {out ? "Out" : `${formatQty(h.onHand)} left`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart (desktop) */}
        <aside className="hidden w-[380px] shrink-0 border-l bg-card md:block xl:w-[420px]" aria-label="Current sale">
          {cartPanel}
        </aside>
      </div>

      {/* Mobile cart bar */}
      <div className="flex items-center gap-2 border-t bg-card p-2 md:hidden">
        <div className="flex-1 text-sm">
          <div className="font-semibold tabular">{formatMoney(total)}</div>
          <div className="text-xs text-muted-foreground">{lines.length} line(s)</div>
        </div>
        <Button onClick={() => setMobileCart(true)} className="h-10">View cart & pay</Button>
      </div>
      <Sheet open={mobileCart} onOpenChange={setMobileCart}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md md:hidden">
          <SheetHeader className="border-b">
            <SheetTitle>Current sale</SheetTitle>
            <SheetDescription className="sr-only">Cart and payment</SheetDescription>
          </SheetHeader>
          {cartPanel}
        </SheetContent>
      </Sheet>

      <CameraScanner open={camera} onOpenChange={(o) => { setCamera(o); if (!o) focusScan(); }} onScan={(code) => void handleScan(code)} />

      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Held carts</DialogTitle>
            <DialogDescription>Held carts are stored on this computer only. Stock is not reserved.</DialogDescription>
          </DialogHeader>
          {held.length === 0 ? (
            <p className="text-sm text-muted-foreground">No held carts.</p>
          ) : (
            <ul className="divide-y">
              {held.map((h) => (
                <li key={h.id} className="flex items-center gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{h.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {h.lines.length} line(s) · {new Date(h.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => restoreCart(h)}>Restore</Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Discard held cart"
                    onClick={() => {
                      const rest = held.filter((x) => x.id !== h.id);
                      try { localStorage.setItem(HOLD_KEY, JSON.stringify(rest)); } catch {}
                      setHeld(rest);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!done} onOpenChange={(o) => { if (!o) { setDone(null); focusScan(); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="items-center text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <DialogTitle>Sale completed</DialogTitle>
            <DialogDescription>
              Invoice <span className="font-mono font-medium text-foreground" data-testid="invoice-number">{done?.number}</span> · {done && formatMoney(done.total)}
            </DialogDescription>
          </DialogHeader>
          {done && D(done.change).gt(0) && (
            <div className="rounded-lg bg-emerald-50 p-3 text-center">
              <div className="text-xs text-emerald-800">Return change</div>
              <div className="text-2xl font-semibold text-emerald-700 tabular">{formatMoney(done.change)}</div>
            </div>
          )}
          <DialogFooter className="sm:flex-col sm:gap-2">
            <Button asChild variant="outline" className="w-full">
              <Link href={`/sales/${done?.id}?print=1`} target="_blank">
                <Printer /> Print invoice
              </Link>
            </Button>
            <Button className="w-full" autoFocus onClick={() => { setDone(null); focusScan(); }}>
              New sale (Enter)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
