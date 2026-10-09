"use client";

import Link from "@/components/shared/app-link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Barcode, History, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field } from "@/components/shared/field";
import { StatusBadge } from "@/components/shared/status-badge";
import { api, errorMessage } from "@/lib/api-client";
import { stockStatus } from "@/lib/calculations";
import { formatMoney, formatQty } from "@/lib/format";
import { variantInputSchema } from "@/validators/masters";

export interface VariantRow {
  id: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  purchasePrice: string;
  sellingPrice: string;
  minStock: string;
  reorderLevel: string;
  isActive: boolean;
  onHand: string;
  damaged: string;
  hasBom: boolean;
}

type Values = z.input<typeof variantInputSchema>;

export function VariantsTable({ productId, productName, unit, variants, canManage }: { productId: string; productName: string; unit: string; variants: VariantRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<VariantRow | "new" | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(variantInputSchema) });

  function open(v: VariantRow | "new") {
    setEditing(v);
    form.reset(
      v === "new"
        ? { sku: "", barcode: "", size: "", color: "", purchasePrice: variants[0]?.purchasePrice ?? "", sellingPrice: variants[0]?.sellingPrice ?? "", minStock: variants[0]?.minStock ?? "", reorderLevel: variants[0]?.reorderLevel ?? "", openingStock: "", isActive: true }
        : { sku: v.sku, barcode: v.barcode ?? "", size: v.size ?? "", color: v.color ?? "", purchasePrice: v.purchasePrice, sellingPrice: v.sellingPrice, minStock: v.minStock, reorderLevel: v.reorderLevel, openingStock: "", isActive: v.isActive },
    );
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      if (editing === "new") {
        await api(`/api/products/${productId}/variants`, { body: values });
        toast.success("Variant added");
      } else if (editing) {
        const { openingStock: _o, ...rest } = values;
        void _o;
        await api(`/api/variants/${editing.id}`, { method: "PATCH", body: rest });
        toast.success("Variant updated");
      }
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    }
  });

  async function genBarcode() {
    try {
      const { barcode } = await api<{ barcode: string }>("/api/barcodes/generate");
      form.setValue("barcode", barcode, { shouldDirty: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const e = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Variants & stock</CardTitle>
        {canManage && (
          <CardAction>
            <Button size="sm" onClick={() => open("new")}>
              <Plus /> Add variant
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b text-left">
                <th className="p-2 font-medium">Variant</th>
                <th className="p-2 font-medium">SKU / Barcode</th>
                <th className="p-2 text-right font-medium">Cost</th>
                <th className="p-2 text-right font-medium">Price</th>
                <th className="p-2 text-right font-medium">In stock</th>
                <th className="p-2 text-right font-medium">Damaged</th>
                <th className="p-2 text-right font-medium">Min</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="p-2 font-medium">
                    {[v.size, v.color].filter(Boolean).join(" / ") || "Default"}
                    {!v.isActive && <StatusBadge status="INACTIVE" className="ml-2" />}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {v.sku}
                    <div className="text-muted-foreground">{v.barcode ?? "no barcode"}</div>
                  </td>
                  <td className="p-2 text-right tabular">{formatMoney(v.purchasePrice)}</td>
                  <td className="p-2 text-right font-medium tabular">{formatMoney(v.sellingPrice)}</td>
                  <td className="p-2 text-right tabular">
                    {formatQty(v.onHand)} <span className="text-xs text-muted-foreground">{unit.toLowerCase()}</span>
                  </td>
                  <td className="p-2 text-right tabular">{Number(v.damaged) > 0 ? formatQty(v.damaged) : "—"}</td>
                  <td className="p-2 text-right tabular">{formatQty(v.minStock)}</td>
                  <td className="p-2">
                    <StatusBadge status={stockStatus(v.onHand, v.minStock, v.reorderLevel)} />
                  </td>
                  <td className="p-2">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon-sm" aria-label="Stock ledger" title="Stock ledger">
                        <Link href={`/inventory/${v.id}`}>
                          <History />
                        </Link>
                      </Button>
                      {canManage && (
                        <Button variant="ghost" size="icon-sm" onClick={() => open(v)} aria-label={`Edit variant ${v.sku}`} title="Edit">
                          <Pencil />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing === "new" ? "Add variant" : "Edit variant"}</SheetTitle>
            <SheetDescription>
              {productName}. Stock cannot be edited here — use purchases, sales or stock adjustments.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="space-y-3 px-4" noValidate id="variant-form">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Size" error={e.size?.message}>
                <Input {...form.register("size")} />
              </Field>
              <Field label="Colour" error={e.color?.message}>
                <Input {...form.register("color")} />
              </Field>
            </div>
            <Field label="SKU" required error={e.sku?.message}>
              <Input className="font-mono uppercase" {...form.register("sku")} />
            </Field>
            <Field label="Barcode" error={e.barcode?.message}>
              <div className="flex gap-2">
                <Input className="font-mono" {...form.register("barcode")} />
                <Button type="button" variant="outline" onClick={genBarcode} title="Generate in-store barcode">
                  <Barcode /> Generate
                </Button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost price" required error={e.purchasePrice?.message}>
                <Input inputMode="decimal" {...form.register("purchasePrice")} />
              </Field>
              <Field label="Selling price" required error={e.sellingPrice?.message}>
                <Input inputMode="decimal" {...form.register("sellingPrice")} />
              </Field>
              <Field label="Minimum stock" error={e.minStock?.message}>
                <Input inputMode="decimal" {...form.register("minStock")} />
              </Field>
              <Field label="Reorder level" error={e.reorderLevel?.message}>
                <Input inputMode="decimal" {...form.register("reorderLevel")} />
              </Field>
            </div>
            {editing === "new" && (
              <Field label="Opening stock" error={e.openingStock?.message} hint="Recorded as an opening-stock ledger entry">
                <Input inputMode="decimal" {...form.register("openingStock")} />
              </Field>
            )}
            <div className="flex items-center gap-2">
              <Switch id="v-active" checked={form.watch("isActive") ?? true} onCheckedChange={(c) => form.setValue("isActive", c)} />
              <Label htmlFor="v-active">Active</Label>
            </div>
          </form>
          <SheetFooter>
            <Button type="submit" form="variant-form" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving…" : "Save variant"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
