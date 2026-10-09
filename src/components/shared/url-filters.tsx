"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in updates)) next.delete("page");
    const href = `${pathname}${next.size ? `?${next}` : ""}`;
    start(() => router.replace(href, { scroll: false }));
  };
  return { params, set, pending };
}

/** Debounced search box bound to ?q= (server-side search & pagination). */
export function SearchInput({ placeholder = "Search…", param = "q", className, autoFocus }: { placeholder?: string; param?: string; className?: string; autoFocus?: boolean }) {
  const { params, set, pending } = useSetParams();
  const [value, setValue] = useState(params.get(param) ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  // Text typed before React hydrated lives only in the DOM — adopt it.
  useEffect(() => {
    const dom = inputRef.current?.value ?? "";
    if (dom !== value) setValue(dom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => set({ [param]: value.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            set({ [param]: e.currentTarget.value.trim() || null });
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-8 pl-8"
        autoFocus={autoFocus}
      />
      {pending ? (
        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : value ? (
        <button type="button" aria-label="Clear search" onClick={() => setValue("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function FilterSelect({
  param,
  options,
  placeholder,
  allLabel = "All",
  className,
}: {
  param: string;
  options: { value: string; label: string }[];
  placeholder: string;
  allLabel?: string;
  className?: string;
}) {
  const { params, set } = useSetParams();
  const value = params.get(param) ?? "__all";
  return (
    <Select value={value} onValueChange={(v) => set({ [param]: v === "__all" ? null : v })}>
      <SelectTrigger className={cn("w-full sm:w-44", className)} aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}
