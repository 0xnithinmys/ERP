"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductSearchBox } from "@/components/scanner/product-search-box";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { D } from "@/lib/decimal";
import { ADJUSTMENT_REASON_LABELS, formatQty } from "@/lib/format";
import type { VariantHit } from "@/server/services/product.service";

type Reason = "DAMAGE" | "DAMAGE_WRITE_OFF" | "LOST" | "FOUND" | "CORRECTION" | "OTHER";

interface Line {
  hit: VariantHit;
  quantity: string;
  direction: "IN" | "OUT";
}

function effect(reason: Reason, l: Line) {
  const q = D(/^\d+(\.\d{1,3})?$/.test(l.quantity) ? l.quantity : 0);
  const onHand = D(l.hit.onHand);
  const damaged = D(l.hit.damaged);
  switch (reason) {
    case "DAMAGE":
      return { sellable: onHand.minus(q), damaged: damaged.plus(q) };
    case "DAMAGE_WRITE_OFF":
      return { sellable: onHand, damaged: damaged.minus(q) };
    case "LOST":
      return { sellable: onHand.minus(q), damaged };
    case "FOUND":
      return { sellable: onHand.plus(q), damaged };
    default:
      return { sellable: l.direction === "IN" ? onHand.plus(q) : onHand.minus(q), damaged };
  }
}

export function AdjustmentForm({ initial }: { initial: VariantHit[] }) {
  const router = useRouter();
  const [reason, setReason] = useState<Reason>("DAMAGE");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(initial.map((hit) => ({ hit, quantity: "", direction: "OUT" })));
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey());

  function add(hit: VariantHit) {
    setLines((prev) => (prev.some((l) => l.hit.variantId === hit.variantId) ? prev : [...prev, { hit, quantity: "1", direction: "OUT" }]));
  }

  const invalid = lines.some((l) => {
    const e = effect(reason, l);
    return !/^\d+(\.\d{1,3})?$/.test(l.quantity) || D(l.quantity).lte(0) || e.sellable.lt(0) || e.damaged.lt(0);
  });

  async function submit() {
    if (note.trim().length < 3) return toast.error("Please describe the reason for this adjustment");
    setBusy(true);
    try {
      await api("/api/adjustments", {
        body: { reason, note, idempotencyKey: key, items: lines.map((l) => ({ variantId: l.hit.variantId, quantity: l.quantity, direction: l.direction })) },
      });
      toast.success("Stock updated successfully");
      setLines([]);
      setNote("");
      setKey(newIdempotencyKey());
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
              <SelectTrigger className="w-full" aria-label="Adjustment reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ADJUSTMENT_REASON_LABELS) as Reason[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ADJUSTMENT_REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-note">Details *</Label>
            <Textarea id="adj-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 3 pairs torn during unpacking" />
          </div>
        </div>

        <ProductSearchBox onSelect={add} placeholder="Scan or search the product to adjust…" />

        {lines.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr className="text-left">
                  <th className="p-2 font-medium">Product</th>
                  <th className="p-2 text-right font-medium">Current</th>
                  {(reason === "CORRECTION" || reason === "OTHER") && <th className="p-2 font-medium">Direction</th>}
                  <th className="p-2 text-right font-medium">Quantity</th>
                  <th className="p-2 text-right font-medium">New sellable</th>
                  <th className="p-2 text-right font-medium">New damaged</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const e = effect(reason, l);
                  return (
                    <tr key={l.hit.variantId} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">{l.hit.name}</div>
                        <div className="text-xs text-muted-foreground">{l.hit.sku}</div>
                      </td>
                      <td className="p-2 text-right tabular">
                        {formatQty(l.hit.onHand)}
                        {D(l.hit.damaged).gt(0) && <div className="text-xs text-muted-foreground">{formatQty(l.hit.damaged)} damaged</div>}
                      </td>
                      {(reason === "CORRECTION" || reason === "OTHER") && (
                        <td className="p-2">
                          <Select value={l.direction} onValueChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, direction: v as "IN" | "OUT" } : x)))}>
                            <SelectTrigger className="h-8 w-28" aria-label="Direction">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="OUT">Remove (−)</SelectItem>
                              <SelectItem value="IN">Add (+)</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      )}
                      <td className="p-2 text-right">
                        <Input value={l.quantity} onChange={(ev) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: ev.target.value.trim() } : x)))} inputMode="decimal" className="ml-auto h-8 w-24 text-right tabular" aria-label={`Quantity for ${l.hit.name}`} />
                      </td>
                      <td className={`p-2 text-right font-medium tabular ${e.sellable.lt(0) ? "text-destructive" : ""}`}>{formatQty(e.sellable)}</td>
                      <td className={`p-2 text-right tabular ${e.damaged.lt(0) ? "text-destructive" : ""}`}>{formatQty(e.damaged)}</td>
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
        {invalid && lines.length > 0 && <p className="text-sm text-destructive">Quantities must be positive and cannot make stock negative.</p>}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={busy || lines.length === 0 || invalid}>
            {busy ? "Saving…" : "Save adjustment"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
