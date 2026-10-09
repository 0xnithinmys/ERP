"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Barcode, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/shared/field";
import { api, errorMessage } from "@/lib/api-client";
import { buildSku } from "@/lib/barcode";
import { UNITS, UNIT_LABELS } from "@/lib/calculations";
import { productCreateSchema, productUpdateSchema } from "@/validators/masters";
import { ImageUpload } from "./image-upload";

type CreateValues = z.input<typeof productCreateSchema>;

interface Props {
  mode: "create" | "edit";
  productId?: string;
  categories: { id: string; name: string; parentId: string | null }[];
  suppliers: { id: string; name: string }[];
  initial: Partial<Omit<CreateValues, "variants">> & { barcode?: string };
}

const NONE = "__none";

export function ProductForm({ mode, productId, categories, suppliers, initial }: Props) {
  const router = useRouter();
  const schema = mode === "create" ? productCreateSchema : productUpdateSchema;
  const form = useForm<CreateValues>({
    resolver: zodResolver(schema as typeof productCreateSchema),
    defaultValues: {
      name: initial.name ?? "",
      code: initial.code ?? "",
      type: initial.type ?? "FINISHED_GOOD",
      categoryId: initial.categoryId ?? null,
      subcategoryId: initial.subcategoryId ?? null,
      supplierId: initial.supplierId ?? null,
      brand: initial.brand ?? "",
      unit: initial.unit ?? (initial.type === "RAW_MATERIAL" ? "KG" : "PAIR"),
      description: initial.description ?? "",
      imageUrl: initial.imageUrl ?? null,
      isActive: initial.isActive ?? true,
      variants:
        mode === "create"
          ? [
              {
                sku: "",
                barcode: initial.barcode ?? "",
                size: "",
                color: "",
                purchasePrice: "",
                sellingPrice: "",
                minStock: "",
                reorderLevel: "",
                openingStock: "",
                isActive: true,
              },
            ]
          : [],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "variants" });
  const errors = form.formState.errors;
  const categoryId = form.watch("categoryId");
  const type = form.watch("type");
  const topCategories = categories.filter((c) => !c.parentId);
  const subcategories = useMemo(() => categories.filter((c) => c.parentId && c.parentId === categoryId), [categories, categoryId]);

  // Variant generator
  const [sizes, setSizes] = useState("");
  const [colors, setColors] = useState("");
  const [defaults, setDefaults] = useState({ purchasePrice: "", sellingPrice: "", minStock: "", openingStock: "" });

  function generate() {
    const code = form.getValues("code") || "ITEM";
    const sz = sizes.split(",").map((s) => s.trim()).filter(Boolean);
    const cl = colors.split(",").map((s) => s.trim()).filter(Boolean);
    const combos = (sz.length ? sz : [""]).flatMap((s) => (cl.length ? cl : [""]).map((c) => ({ s, c })));
    if (combos.length > 200) return toast.error("Too many combinations (max 200)");
    replace(
      combos.map(({ s, c }) => ({
        sku: buildSku(code, s, c),
        barcode: "",
        size: s,
        color: c,
        purchasePrice: defaults.purchasePrice,
        sellingPrice: defaults.sellingPrice,
        minStock: defaults.minStock,
        reorderLevel: defaults.minStock,
        openingStock: defaults.openingStock,
        isActive: true,
      })),
    );
  }

  async function generateBarcodes() {
    const vs = form.getValues("variants") ?? [];
    for (let i = 0; i < vs.length; i++) {
      if (vs[i].barcode) continue;
      try {
        const { barcode } = await api<{ barcode: string }>("/api/barcodes/generate");
        form.setValue(`variants.${i}.barcode`, barcode, { shouldDirty: true });
      } catch (err) {
        toast.error(errorMessage(err));
        return;
      }
    }
    toast.success("Barcodes generated for variants without one");
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      if (mode === "create") {
        const p = await api<{ id: string; name: string }>("/api/products", { body: values });
        toast.success(`Product ${p.name} created`);
        router.push(`/products/${p.id}`);
      } else {
        const { variants: _v, ...rest } = values;
        void _v;
        await api(`/api/products/${productId}`, { method: "PATCH", body: rest });
        toast.success("Product updated");
        router.refresh();
      }
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    }
  });

  const variantErr = (i: number, k: string) => (errors.variants?.[i] as Record<string, { message?: string }> | undefined)?.[k]?.message;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{mode === "create" ? "Product details" : "Edit product details"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Product name" required error={errors.name?.message} className="sm:col-span-2">
            <Input placeholder="e.g. Cotton Crew Socks" {...form.register("name")} />
          </Field>
          <Field label="Product code" required error={errors.code?.message} hint="Used as SKU prefix">
            <Input className="uppercase" {...form.register("code")} />
          </Field>
          <Field label="Type" error={errors.type?.message}>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); form.setValue("unit", v === "RAW_MATERIAL" ? "KG" : "PAIR"); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FINISHED_GOOD">Finished good (sellable)</SelectItem>
                    <SelectItem value="RAW_MATERIAL">Raw material (yarn, elastic…)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Unit" error={errors.unit?.message}>
            <Controller
              control={form.control}
              name="unit"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {UNIT_LABELS[u]} ({u})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Brand" error={errors.brand?.message}>
            <Input {...form.register("brand")} />
          </Field>
          <Field label="Category">
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value ?? NONE} onValueChange={(v) => { field.onChange(v === NONE ? null : v); form.setValue("subcategoryId", null); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {topCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Subcategory" error={errors.subcategoryId?.message}>
            <Controller
              control={form.control}
              name="subcategoryId"
              render={({ field }) => (
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)} disabled={!subcategories.length}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={subcategories.length ? "Select subcategory" : "No subcategories"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {subcategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Preferred supplier">
            <Controller
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
            <Textarea rows={2} {...form.register("description")} />
          </Field>
          <div className="space-y-1.5">
            <Label>Image</Label>
            <Controller control={form.control} name="imageUrl" render={({ field }) => <ImageUpload value={field.value} onChange={field.onChange} />} />
          </div>
          <div className="flex items-center gap-2">
            <Controller control={form.control} name="isActive" render={({ field }) => <Switch id="p-active" checked={field.value ?? true} onCheckedChange={field.onChange} />} />
            <Label htmlFor="p-active">Active (inactive products cannot be sold or purchased)</Label>
          </div>
        </CardContent>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Variants</CardTitle>
            <CardDescription>Generate all size × colour combinations, then adjust prices, barcodes and opening stock per row.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-dashed bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-1 lg:col-span-2">
                <Label htmlFor="gen-sizes" className="text-xs">Sizes (comma separated)</Label>
                <Input id="gen-sizes" placeholder={type === "RAW_MATERIAL" ? "leave empty" : "S, M, L, XL"} value={sizes} onChange={(e) => setSizes(e.target.value)} />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label htmlFor="gen-colors" className="text-xs">Colours (comma separated)</Label>
                <Input id="gen-colors" placeholder="Black, White, Navy" value={colors} onChange={(e) => setColors(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gen-cost" className="text-xs">Cost price</Label>
                <Input id="gen-cost" inputMode="decimal" value={defaults.purchasePrice} onChange={(e) => setDefaults({ ...defaults, purchasePrice: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gen-price" className="text-xs">Selling price</Label>
                <Input id="gen-price" inputMode="decimal" value={defaults.sellingPrice} onChange={(e) => setDefaults({ ...defaults, sellingPrice: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gen-min" className="text-xs">Min stock</Label>
                <Input id="gen-min" inputMode="decimal" value={defaults.minStock} onChange={(e) => setDefaults({ ...defaults, minStock: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gen-open" className="text-xs">Opening stock</Label>
                <Input id="gen-open" inputMode="decimal" value={defaults.openingStock} onChange={(e) => setDefaults({ ...defaults, openingStock: e.target.value })} />
              </div>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <Button type="button" variant="secondary" onClick={generate}>
                  <Wand2 /> Generate variants
                </Button>
                <Button type="button" variant="outline" onClick={generateBarcodes}>
                  <Barcode /> Auto-fill missing barcodes
                </Button>
              </div>
            </div>

            {typeof errors.variants?.message === "string" && <p className="text-sm text-destructive">{errors.variants.message}</p>}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr className="text-left">
                    {["Size", "Colour", "SKU *", "Barcode", "Cost *", "Price *", "Min stock", "Reorder", "Opening", ""].map((h) => (
                      <th key={h} className="p-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={f.id} className="border-t align-top">
                      {(["size", "color", "sku", "barcode", "purchasePrice", "sellingPrice", "minStock", "reorderLevel", "openingStock"] as const).map((k) => (
                        <td key={k} className="p-1.5">
                          <Input
                            {...form.register(`variants.${i}.${k}`)}
                            aria-label={`${k} for row ${i + 1}`}
                            aria-invalid={variantErr(i, k) ? true : undefined}
                            className={`h-8 ${k === "sku" || k === "barcode" ? "font-mono text-xs" : ""} ${["purchasePrice", "sellingPrice", "minStock", "reorderLevel", "openingStock"].includes(k) ? "w-24 text-right tabular" : ""}`}
                            inputMode={["purchasePrice", "sellingPrice", "minStock", "reorderLevel", "openingStock"].includes(k) ? "decimal" : undefined}
                          />
                          {variantErr(i, k) && <p className="mt-0.5 max-w-40 text-[11px] text-destructive">{variantErr(i, k)}</p>}
                        </td>
                      ))}
                      <td className="p-1.5">
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remove row ${i + 1}`}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({ sku: "", barcode: "", size: "", color: "", purchasePrice: defaults.purchasePrice, sellingPrice: defaults.sellingPrice, minStock: defaults.minStock, reorderLevel: defaults.minStock, openingStock: "", isActive: true })
              }
            >
              <Plus /> Add row
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : mode === "create" ? "Add product" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
