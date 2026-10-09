"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last30", label: "Last 30 days" },
];

export function RangePicker({ preset, fromKey, toKey, csvKind, label }: { preset: string; fromKey: string; toKey: string; csvKind?: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [from, setFrom] = useState(fromKey);
  const [to, setTo] = useState(toKey);
  const [pending, start] = useTransition();
  const go = (params: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    next.delete("page");
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    if (params.range !== "custom") {
      next.delete("from");
      next.delete("to");
    }
    start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };
  const csvParams = new URLSearchParams(sp.toString());
  return (
    <div className="no-print mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((p) => (
          <Button key={p.value} size="sm" variant={preset === p.value ? "default" : "outline"} onClick={() => go({ range: p.value })}>
            {p.label}
          </Button>
        ))}
        <div className={cn("ml-1 flex items-center gap-1 rounded-lg border p-0.5", preset === "custom" && "border-primary")}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 w-36 border-0 shadow-none" aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 w-36 border-0 shadow-none" aria-label="To date" />
          <Button size="sm" variant="secondary" onClick={() => go({ range: "custom", from, to })} disabled={!from || !to}>
            Apply
          </Button>
        </div>
        {pending && <Loader2 className="ml-2 size-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        {csvKind && (
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/${csvKind}/csv?${csvParams}`} download>
              <Download /> Export CSV
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
