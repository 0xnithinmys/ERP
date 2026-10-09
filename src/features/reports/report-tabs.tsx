"use client";

import Link from "@/components/shared/app-link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/reports/sales", label: "Sales" },
  { href: "/reports/purchases", label: "Purchases" },
  { href: "/reports/inventory", label: "Inventory" },
  { href: "/reports/stock-movement", label: "Stock movement" },
  { href: "/reports/production", label: "Production" },
];

export function ReportTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ["range", "from", "to"]) if (sp.get(k)) keep.set(k, sp.get(k)!);
  return (
    <nav className="no-print mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Reports">
      {TABS.map((t) => (
        <Link key={t.href} href={`${t.href}${keep.size ? `?${keep}` : ""}`} aria-current={pathname === t.href ? "page" : undefined} className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm", pathname === t.href ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
