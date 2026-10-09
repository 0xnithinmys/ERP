"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { api } from "@/lib/api-client";
import { formatMoney, formatQty } from "@/lib/format";
import type { VariantHit } from "@/server/services/product.service";
import { useSession } from "@/components/providers/session-provider";
import { useDebounced } from "@/hooks/use-debounced";
import { NAV, QUICK_ACTIONS } from "./nav";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim(), 200);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const { data: hits } = useQuery({
    queryKey: ["palette-search", debounced],
    queryFn: ({ signal }) => api<VariantHit[]>(`/api/variants/search?q=${encodeURIComponent(debounced)}&limit=6`, { signal }),
    enabled: open && debounced.length >= 2 && can("products.view"),
  });

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const pages = NAV.flatMap((g) => g.items).filter((i) => can(i.permission));
  const actions = QUICK_ACTIONS.filter((a) => can(a.permission));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Quick actions" description="Jump to a page, start a task or find a product">
      <Command>
      <CommandInput placeholder="Type an action, page or product…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          {actions.map((a) => (
            <CommandItem key={a.href} value={`${a.label} ${a.keywords ?? ""}`} onSelect={() => go(a.href)}>
              <a.icon /> {a.label}
              {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        {hits && hits.length > 0 && (
          <CommandGroup heading="Products">
            {hits.map((h) => (
              <CommandItem key={h.variantId} value={`product ${h.name} ${h.sku} ${h.barcode ?? ""} ${debounced}`} onSelect={() => go(`/inventory/${h.variantId}`)}>
                <Package />
                <span className="truncate">{h.name}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular">
                  {formatQty(h.onHand)} · {formatMoney(h.sellingPrice)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          {pages.map((p) => (
            <CommandItem key={p.href} value={`go ${p.label}`} onSelect={() => go(p.href)}>
              <p.icon /> {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
