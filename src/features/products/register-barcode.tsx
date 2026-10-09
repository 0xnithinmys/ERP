"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ProductSearchBox } from "@/components/scanner/product-search-box";
import { api, errorMessage } from "@/lib/api-client";
import type { VariantHit } from "@/server/services/product.service";

export function RegisterBarcode({ initialBarcode }: { initialBarcode: string }) {
  const router = useRouter();
  const [barcode, setBarcode] = useState(initialBarcode);
  const [variant, setVariant] = useState<VariantHit | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!variant) return;
    setBusy(true);
    try {
      await api(`/api/variants/${variant.variantId}/barcode`, { body: { barcode } });
      toast.success(`Barcode ${barcode} registered to ${variant.name}`);
      router.push(`/products/${variant.productId}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="rb-code">Barcode</Label>
          <Input id="rb-code" value={barcode} onChange={(e) => setBarcode(e.target.value.trim())} className="font-mono" placeholder="Scan or type the barcode" autoFocus={!initialBarcode} />
        </div>
        <div className="space-y-1.5">
          <Label>Product variant</Label>
          <ProductSearchBox onSelect={setVariant} placeholder="Search the product this barcode belongs to…" allowCamera={false} autoFocus={!!initialBarcode} />
          {variant && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{variant.name}</div>
              <div className="text-xs text-muted-foreground">
                SKU {variant.sku} · current barcode {variant.barcode ?? "none"}
              </div>
            </div>
          )}
        </div>
        <Button onClick={save} disabled={!variant || barcode.length < 3 || busy}>
          {busy ? "Saving…" : "Register barcode"}
        </Button>
      </CardContent>
    </Card>
  );
}
