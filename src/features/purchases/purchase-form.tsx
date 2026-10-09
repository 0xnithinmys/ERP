"use client";

import Link from "@/components/shared/app-link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductSearchBox, type ProductSearchHandle } from "@/components/scanner/product-search-box";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { calculatePurchase, CalculationError, unitAllowsDecimal } from "@/lib/calculations";
import { D } from "@/lib/decimal";
import { formatMoney, formatQty } from "@/lib/format";
import { useSession } from "@/components/providers/session-provider";
import type { VariantHit } from "@/server/services/product.service";

interface Line {
  hit: VariantHit;
  quantity: string;
  rate: string;
  discount: string;
  taxRate: string;
}

const MONEY = /^\d+(\.\d{1,2})?$/;
const QTY = /^\d+(\.\d{1,3})?$/;

export function PurchaseForm({
  suppliers,
  today,
  canReceive,
  defaultSupplierId,
  defaultTaxRate,
}: {
  suppliers: { id: string; name: string }[];
  today: string;
  canReceive: boolean;
  defaultSupplierId?: string;
  defaultTaxRate: string;
}) {
  const router = useRouter();
  const { can } = useSession();
  const searchRef = useRef<ProductSearchHandle>(null);
  const [supplierId, setSupplierId] = useState(defaultSupplierId && suppliers.some((s) => s.id === defaultSupplierId) ? defaultSupplierId : "");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [receiveNow, setReceiveNow] = useState(canReceive);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newIdempotencyKey());
  const [submitted, setSubmitted] = useState(false);

  function add(hit: VariantHit) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.hit.variantId === hit.variantId);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: D(QTY.test(next[i].quantity) ? next[i].quantity : 0).plus(1).toString() };
        return next;
      }
      return [...prev, { hit, quantity: "1", rate: hit.purchasePrice, discount: "", taxRate: defaultTaxRate }];
    });
  }
  const update = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const lineError = (l: Line) => {
    if (!QTY.test(l.quantity) || D(l.quantity).lte(0)) return "Enter quantity";
    if (!unitAllowsDecimal(l.hit.unit) && !D(l.quantity).isInteger()) return "Whole numbers only";
    if (!MONEY.test(l.rate)) return "Invalid rate";
    if (l.discount && !MONEY.test(l.discount)) return "Invalid discount";
    return null;
  };

  const totals = useMemo(() => {
    try {
      return calculatePurchase(
        lines.filter((l) => !lineError(l)).map((l) => ({ quantity: l.quantity, rate: l.rate, discount: l.discount || "0", taxRate: l.taxRate || "0" })),
        { discount: MONEY.test(discount) ? discount : "0" },
      );
    } catch (err) {
      return err instanceof CalculationError ? err.message : "Invalid amounts";
    }
  }, [lines, discount]);

  const errors = lines.map(lineError);
  const valid = supplierId && lines.length > 0 && errors.every((e) => !e) && typeof totals !== "string";

  async function submit() {
    if (!supplierId) return toast.error("Select a supplier");
    if (!lines.length) return toast.error("Add at least one product");
    if (!valid) return toast.error("Fix the highlighted lines first");
    setBusy(true);
    try {
      const res = await api<{ id: string; number: string; status: string }>("/api/purchases", {
        body: {
          supplierId,
          invoiceNumber: invoiceNumber || null,
          purchaseDate: date,
          items: lines.map((l) => ({ variantId: l.hit.variantId, quantity: l.quantity, rate: l.rate, discount: l.discount, taxRate: l.taxRate })),
          discount,
          amountPaid: paid,
          notes: notes || null,
          receiveNow,
          idempotencyKey: key,
        },
      });
      setSubmitted(true);
      toast.success(res.status === "RECEIVED" ? "Purchase received successfully" : `Draft purchase ${res.number} saved`);
      router.push(`/purchases/${res.id}`);
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Supplier *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-full" aria-label="Supplier">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {suppliers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No suppliers yet. <Link href="/suppliers" className="text-primary underline">Add a supplier</Link> first.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-inv">Supplier invoice no.</Label>
            <Input id="p-inv" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-date">Date</Label>
            <Input id="p-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProductSearchBox ref={searchRef} onSelect={add} showPrice="purchase" placeholder="Scan barcode or search product / raw material…" canCreate={can("products.manage")} />
          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Scan or search to add products to this purchase.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr className="text-left">
                    <th className="p-2 font-medium">Product</th>
                    <th className="p-2 text-right font-medium">Qty</th>
                    <th className="p-2 text-right font-medium">Rate</th>
                    <th className="p-2 text-right font-medium">Discount</th>
                    <th className="p-2 text-right font-medium">Tax %</th>
                    <th className="p-2 text-right font-medium">Amount</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const amount = typeof totals !== "string" && !errors[i] ? totals.lines[lines.slice(0, i).filter((x) => !lineError(x)).length]?.lineTotal : null;
                    return (
                      <tr key={l.hit.variantId} className="border-t align-top">
                        <td className="p-2">
                          <div className="font-medium">{l.hit.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.hit.sku} · in stock {formatQty(l.hit.onHand)} {l.hit.unit.toLowerCase()}
                          </div>
                          {errors[i] && <div className="text-xs text-destructive">{errors[i]}</div>}
                        </td>
                        <td className="p-2">
                          <Input value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && searchRef.current?.focus()} inputMode="decimal" className="ml-auto h-8 w-24 text-right tabular" aria-label={`Quantity for ${l.hit.name}`} />
                        </td>
                        <td className="p-2">
                          <Input value={l.rate} onChange={(e) => update(i, { rate: e.target.value.trim() })} inputMode="decimal" className="ml-auto h-8 w-24 text-right tabular" aria-label={`Rate for ${l.hit.name}`} />
                        </td>
                        <td className="p-2">
                          <Input value={l.discount} onChange={(e) => update(i, { discount: e.target.value.trim() })} inputMode="decimal" placeholder="0" className="ml-auto h-8 w-20 text-right tabular" aria-label={`Discount for ${l.hit.name}`} />
                        </td>
                        <td className="p-2">
                          <Input value={l.taxRate} onChange={(e) => update(i, { taxRate: e.target.value.trim() })} inputMode="decimal" className="ml-auto h-8 w-16 text-right tabular" aria-label={`Tax rate for ${l.hit.name}`} />
                        </td>
                        <td className="p-2 text-right font-medium tabular">{amount ? formatMoney(amount) : "—"}</td>
                        <td className="p-2">
                          <Button variant="ghost" size="icon-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove ${l.hit.name}`}>
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="p-notes">Notes</Label>
              <Textarea id="p-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {canReceive && (
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Switch id="p-receive" checked={receiveNow} onCheckedChange={setReceiveNow} />
                <div>
                  <Label htmlFor="p-receive">Receive stock now</Label>
                  <p className="text-xs text-muted-foreground">When on, quantities are added to inventory immediately. Turn off to save a draft order to receive later.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-5 text-sm">
            {typeof totals === "string" ? (
              <p className="text-destructive">{totals}</p>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="tabular">{formatQty(totals.itemCount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular">{formatMoney(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular">{formatMoney(totals.taxAmount)}</span></div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="p-disc" className="font-normal text-muted-foreground">Discount</Label>
                  <Input id="p-disc" value={discount} onChange={(e) => setDiscount(e.target.value.trim())} inputMode="decimal" placeholder="0.00" className="h-8 w-28 text-right tabular" />
                </div>
                <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span className="tabular">{formatMoney(totals.total)}</span></div>
              </>
            )}
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="p-paid" className="font-normal text-muted-foreground">Amount paid</Label>
              <Input id="p-paid" value={paid} onChange={(e) => setPaid(e.target.value.trim())} inputMode="decimal" placeholder="0.00" className="h-8 w-28 text-right tabular" />
            </div>
            <Button className="mt-2 h-11 w-full" onClick={submit} disabled={busy || submitted || !valid} data-testid="submit-purchase">
              {busy ? "Saving…" : receiveNow ? "Receive stock" : "Save draft purchase"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
