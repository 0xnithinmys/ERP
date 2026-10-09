"use client";

import Link from "@/components/shared/app-link";
import { useState } from "react";
import { History } from "lucide-react";
import { ProductSearchBox } from "@/components/scanner/product-search-box";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatMoney, formatQty } from "@/lib/format";
import { useSession } from "@/components/providers/session-provider";
import type { VariantHit } from "@/server/services/product.service";

/** Scan-to-lookup: scan any barcode to see live stock & price without leaving the page. */
export function StockLookup({ autoFocus }: { autoFocus?: boolean }) {
  const { can } = useSession();
  const [hit, setHit] = useState<VariantHit | null>(null);
  return (
    <div className="mb-4 rounded-xl border bg-card p-3">
      <div className="mb-2 text-sm font-medium">Quick stock lookup</div>
      <ProductSearchBox onSelect={setHit} autoFocus={autoFocus} placeholder="Scan a barcode to check stock…" canCreate={can("products.manage")} />
      {hit && (
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg bg-muted/40 p-3 text-sm" aria-live="polite">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{hit.name}</div>
            <div className="text-xs text-muted-foreground">
              SKU {hit.sku} · {hit.barcode ?? "no barcode"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Available</div>
            <div className="text-lg font-semibold tabular">
              {formatQty(hit.onHand)} <span className="text-xs font-normal">{hit.unit.toLowerCase()}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Damaged</div>
            <div className="font-medium tabular">{formatQty(hit.damaged)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Price</div>
            <div className="font-medium tabular">{formatMoney(hit.sellingPrice)}</div>
          </div>
          <StatusBadge status={hit.status} />
          <Button asChild size="sm" variant="outline">
            <Link href={`/inventory/${hit.variantId}`}>
              <History /> Ledger
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
