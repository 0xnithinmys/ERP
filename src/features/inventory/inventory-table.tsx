"use client";

import Link from "@/components/shared/app-link";
import type { ColumnDef } from "@tanstack/react-table";
import { Warehouse } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatMoney, formatQty } from "@/lib/format";
import type { InventoryRow } from "@/server/services/inventory.service";

export function InventoryTable({ rows, showCost }: { rows: InventoryRow[]; showCost: boolean }) {
  const columns: ColumnDef<InventoryRow, unknown>[] = [
    {
      id: "product",
      header: "Product",
      accessorFn: (r) => r.productName,
      cell: ({ row: { original: r } }) => (
        <Link href={`/inventory/${r.variantId}`} className="block">
          <span className="block font-medium text-primary hover:underline">{r.productName}</span>
          <span className="block text-xs text-muted-foreground">{[r.size, r.color].filter(Boolean).join(" / ") || "—"}</span>
        </Link>
      ),
    },
    { id: "sku", header: "SKU", accessorKey: "sku", cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue())}</span> },
    { id: "barcode", header: "Barcode", accessorKey: "barcode", enableSorting: false, cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{(getValue() as string) ?? "—"}</span> },
    { id: "category", header: "Category", accessorFn: (r) => r.category ?? "", cell: ({ getValue }) => (getValue() as string) || "—" },
    {
      id: "onHand",
      header: "Available",
      meta: { align: "right" },
      accessorFn: (r) => Number(r.onHand),
      cell: ({ row: { original: r } }) => (
        <span className="font-semibold">
          {formatQty(r.onHand)} <span className="text-xs font-normal text-muted-foreground">{r.unit.toLowerCase()}</span>
        </span>
      ),
    },
    { id: "damaged", header: "Damaged", meta: { align: "right" }, accessorFn: (r) => Number(r.damaged), cell: ({ row: { original: r } }) => (Number(r.damaged) ? formatQty(r.damaged) : "—") },
    { id: "min", header: "Min", meta: { align: "right" }, accessorFn: (r) => Number(r.minStock), cell: ({ row: { original: r } }) => formatQty(r.minStock) },
    ...(showCost
      ? [{ id: "value", header: "Value", meta: { align: "right" }, accessorFn: (r: InventoryRow) => Math.max(Number(r.onHand), 0) * Number(r.purchasePrice), cell: ({ getValue }: { getValue: () => unknown }) => formatMoney(Number(getValue())) } as ColumnDef<InventoryRow, unknown>]
      : []),
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: r } }) => <StatusBadge status={r.status} /> },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.variantId}
      empty={<EmptyState icon={Warehouse} title="No stock items match" description="Try a different search or filter, or add products to start tracking stock." action={{ label: "Add product", href: "/products/new" }} />}
    />
  );
}
