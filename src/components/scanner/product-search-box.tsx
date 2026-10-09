"use client";

import Link from "@/components/shared/app-link";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Loader2, PackagePlus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { formatMoney, formatQty } from "@/lib/format";
import { beepError, beepOk } from "@/lib/feedback";
import { normalizeScan } from "@/lib/barcode";
import { cn } from "@/lib/utils";
import type { VariantHit } from "@/server/services/product.service";
import { useDebounced } from "@/hooks/use-debounced";
import { StatusBadge } from "@/components/shared/status-badge";
import { CameraScanner } from "./camera-scanner";

export interface ProductSearchHandle {
  focus: () => void;
}

/**
 * Search-or-scan box. Typing searches by name/SKU/size/color; pressing Enter (what
 * barcode scanners send) does an exact barcode/SKU lookup first. Unknown codes
 * show "Product not found" with a shortcut to register it.
 */
export const ProductSearchBox = forwardRef<
  ProductSearchHandle,
  {
    onSelect: (hit: VariantHit) => void;
    type?: "FINISHED_GOOD" | "RAW_MATERIAL";
    placeholder?: string;
    showPrice?: "selling" | "purchase";
    autoFocus?: boolean;
    allowCamera?: boolean;
    className?: string;
    canCreate?: boolean;
  }
>(function ProductSearchBox(
  { onSelect, type, placeholder = "Scan barcode or search product…", showPrice = "selling", autoFocus, allowCamera = true, className, canCreate },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [camera, setCamera] = useState(false);
  const debounced = useDebounced(q.trim(), 180);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["variant-search", debounced, type],
    queryFn: ({ signal }) =>
      api<VariantHit[]>(`/api/variants/search?q=${encodeURIComponent(debounced)}&limit=12${type ? `&type=${type}` : ""}`, { signal }),
    enabled: debounced.length >= 1,
    placeholderData: (prev) => prev,
  });

  useEffect(() => setActive(0), [debounced]);

  function choose(hit: VariantHit) {
    if (type && hit.type !== type) {
      beepError();
      setNotFound(`${hit.name} is a ${hit.type === "RAW_MATERIAL" ? "raw material" : "finished good"} and can't be used here`);
      return;
    }
    beepOk();
    onSelect(hit);
    setQ("");
    setOpen(false);
    setNotFound(null);
    inputRef.current?.focus();
  }

  async function lookup(raw: string) {
    const code = normalizeScan(raw);
    if (!code) return;
    setLooking(true);
    try {
      const hit = await api<VariantHit | null>(`/api/variants/lookup?code=${encodeURIComponent(code)}`);
      if (hit) return choose(hit);
      // Not an exact code: fall back to the highlighted search result.
      if (open && hits[active] && debounced === q.trim()) return choose(hits[active]);
      beepError();
      setNotFound(code);
      setOpen(false);
    } catch (err) {
      beepError();
      setNotFound(null);
      setOpen(false);
      alertError(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  const [err, setErr] = useState<string | null>(null);
  function alertError(m: string) {
    setErr(m);
    setTimeout(() => setErr(null), 4000);
  }

  return (
    <div className={cn("relative", className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setNotFound(null);
            }}
            onFocus={() => q && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (q.trim()) void lookup(q);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className="h-10 pl-9 text-base"
            role="combobox"
            aria-expanded={open && hits.length > 0}
            aria-controls="product-search-list"
            aria-label={placeholder}
            autoComplete="off"
            spellCheck={false}
          />
          {(isFetching || looking) && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />}
        </div>
        {allowCamera && (
          <Button type="button" variant="outline" size="icon-lg" className="size-10" onClick={() => setCamera(true)} aria-label="Scan with camera" title="Scan with camera">
            <Camera />
          </Button>
        )}
      </div>

      {open && debounced && hits.length > 0 && (
        <ul id="product-search-list" role="listbox" className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {hits.map((h, i) => (
            <li
              key={h.variantId}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm", i === active && "bg-accent", !h.isActive && "opacity-60")}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{h.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {h.sku}
                  {h.barcode ? ` · ${h.barcode}` : ""}
                  {!h.isActive ? " · inactive" : ""}
                </div>
              </div>
              <div className="text-right text-xs">
                <div className="font-medium tabular">{formatMoney(showPrice === "purchase" ? h.purchasePrice : h.sellingPrice)}</div>
                <div className="text-muted-foreground tabular">
                  {formatQty(h.onHand)} {h.unit.toLowerCase()}
                </div>
              </div>
              <StatusBadge status={h.status} className="hidden sm:inline-flex" />
            </li>
          ))}
        </ul>
      )}
      {open && debounced && !isFetching && hits.length === 0 && !notFound && (
        <div className="absolute z-40 mt-1 w-full rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-lg">
          No products match “{debounced}”. Press Enter to look up an exact barcode.
        </div>
      )}

      {notFound && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-medium">Product not found</span>
          <span className="font-mono">{notFound}</span>
          {canCreate && /^[A-Za-z0-9\-_.]{3,64}$/.test(notFound) && (
            <span className="ml-auto flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/products/new?barcode=${encodeURIComponent(notFound)}`} target="_blank">
                  <PackagePlus /> Create product
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/products/register-barcode?barcode=${encodeURIComponent(notFound)}`} target="_blank">
                  Register barcode
                </Link>
              </Button>
            </span>
          )}
          <button type="button" className="text-xs underline" onClick={() => setNotFound(null)}>
            Dismiss
          </button>
        </div>
      )}
      {err && (
        <div role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      <CameraScanner open={camera} onOpenChange={setCamera} onScan={(code) => void lookup(code)} />
    </div>
  );
});
