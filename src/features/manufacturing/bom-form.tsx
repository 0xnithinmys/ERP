"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ProductSearchBox } from "@/components/scanner/product-search-box";
import { api, errorMessage } from "@/lib/api-client";
import { D } from "@/lib/decimal";
import { formatMoney, formatQty } from "@/lib/format";
import type { VariantHit } from "@/server/services/product.service";

interface Initial {
  finished: VariantHit;
  outputQty: string;
  notes: string;
  items: { material: VariantHit; quantity: string }[];
}

export function BomForm({ initial }: { initial: Initial | null }) {
  const router = useRouter();
  const [finished, setFinished] = useState<VariantHit | null>(initial?.finished ?? null);
  const [outputQty, setOutputQty] = useState(initial?.outputQty ?? "1");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState(initial?.items ?? []);
  const [allVariants, setAllVariants] = useState(false);
  const [busy, setBusy] = useState(false);

  const QTY = /^\d+(\.\d{1,3})?$/;
  const invalid = !finished || !QTY.test(outputQty) || D(outputQty).lte(0) || items.length === 0 || items.some((i) => !QTY.test(i.quantity) || D(i.quantity).lte(0));
  const costPerUnit = QTY.test(outputQty) && D(outputQty).gt(0) ? items.reduce((a, i) => a.plus(D(QTY.test(i.quantity) ? i.quantity : 0).times(D(i.material.purchasePrice))), D(0)).div(D(outputQty)) : D(0);

  async function save() {
    if (!finished) return;
    setBusy(true);
    try {
      await api("/api/boms", {
        body: { variantId: finished.variantId, outputQty, notes: notes || null, applyToAllVariants: allVariants, items: items.map((i) => ({ materialId: i.material.variantId, quantity: i.quantity })) },
      });
      toast.success("Bill of materials saved");
      router.push("/manufacturing?tab=boms");
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Finished item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {finished ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <div className="flex-1">
                <div className="font-medium">{finished.name}</div>
                <div className="text-xs text-muted-foreground">{finished.sku}</div>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setFinished(null)} aria-label="Change finished item">
                <X />
              </Button>
            </div>
          ) : (
            <ProductSearchBox type="FINISHED_GOOD" onSelect={setFinished} placeholder="Search the finished product (e.g. Cotton socks M black)…" allowCamera={false} />
          )}
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="bom-out">Output quantity</Label>
              <Input id="bom-out" value={outputQty} onChange={(e) => setOutputQty(e.target.value.trim())} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bom-notes">Notes</Label>
              <Textarea id="bom-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allVariants} onCheckedChange={(c) => setAllVariants(c === true)} />
            Use the same materials for all sizes/colours of this product
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Raw materials per {formatQty(QTY.test(outputQty) ? outputQty : 1)} {finished?.unit.toLowerCase() ?? "unit"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProductSearchBox
            type="RAW_MATERIAL"
            showPrice="purchase"
            onSelect={(m) => setItems((prev) => (prev.some((p) => p.material.variantId === m.variantId) ? prev : [...prev, { material: m, quantity: "1" }]))}
            placeholder="Add raw material (yarn, elastic, label…)"
            allowCamera={false}
          />
          {items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr className="text-left">
                    <th className="p-2 font-medium">Material</th>
                    <th className="p-2 text-right font-medium">Quantity</th>
                    <th className="p-2 font-medium">Unit</th>
                    <th className="p-2 text-right font-medium">Cost</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, idx) => (
                    <tr key={i.material.variantId} className="border-t">
                      <td className="p-2 font-medium">{i.material.name}</td>
                      <td className="p-2 text-right">
                        <Input value={i.quantity} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, quantity: e.target.value.trim() } : x)))} inputMode="decimal" className="ml-auto h-8 w-28 text-right tabular" aria-label={`Quantity of ${i.material.name}`} />
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{i.material.unit.toLowerCase()}</td>
                      <td className="p-2 text-right tabular">{formatMoney(D(/^\d+(\.\d{1,3})?$/.test(i.quantity) ? i.quantity : 0).times(D(i.material.purchasePrice)))}</td>
                      <td className="p-2">
                        <Button variant="ghost" size="icon-sm" onClick={() => setItems(items.filter((_, j) => j !== idx))} aria-label={`Remove ${i.material.name}`}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Material cost per unit: <span className="font-medium text-foreground">{formatMoney(costPerUnit)}</span></span>
            <Button onClick={save} disabled={busy || invalid}>
              {busy ? "Saving…" : "Save BOM"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
