import Link from "@/components/shared/app-link";
import { Download } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getInventorySummary, listInventory } from "@/server/services/inventory.service";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SimpleTable } from "@/components/shared/simple-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { FilterSelect, Toolbar } from "@/components/shared/url-filters";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { D } from "@/lib/decimal";
import { formatMoney, formatQty, fullItemName } from "@/lib/format";
import { int, oneOf, type SP } from "@/lib/search-params";

export const metadata = { title: "Inventory report" };

export default async function InventoryReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const status = oneOf(sp, "status", ["low", "out", "in", "damaged"] as const);
  const [summary, data] = await Promise.all([getInventorySummary(actor), listInventory(actor, { status, page, pageSize: 50 })]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory report"
        description="Current stock position (live)."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={`/api/reports/inventory/csv${status ? `?status=${status}` : ""}`} download>
              <Download /> Export CSV
            </a>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Stock value (cost)" value={formatMoney(summary.value)} />
        <StatCard label="Active variants" value={summary.totalVariants} />
        <StatCard label="Low stock" value={summary.lowStock} tone={summary.lowStock ? "warning" : "success"} href="/reports/inventory?status=low" />
        <StatCard label="Out of stock" value={summary.outOfStock} tone={summary.outOfStock ? "danger" : "success"} href="/reports/inventory?status=out" />
      </div>
      <Toolbar>
        <FilterSelect param="status" placeholder="Status" allLabel="Current stock (all)" options={[{ value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }, { value: "in", label: "In stock" }, { value: "damaged", label: "Damaged stock" }]} />
      </Toolbar>
      <SimpleTable rows={data.rows} rowKey={(r) => r.variantId} empty={<EmptyState title="Nothing to show" />} columns={[
        { key: "n", header: "Item", cell: (r) => <Link href={`/inventory/${r.variantId}`} className="text-primary hover:underline">{fullItemName(r.productName, r)}</Link> },
        { key: "s", header: "SKU", cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
        { key: "q", header: "Sellable", align: "right", cell: (r) => `${formatQty(r.onHand)} ${r.unit.toLowerCase()}` },
        { key: "d", header: "Damaged", align: "right", cell: (r) => (Number(r.damaged) ? formatQty(r.damaged) : "—") },
        { key: "m", header: "Min", align: "right", cell: (r) => formatQty(r.minStock) },
        { key: "v", header: "Value", align: "right", cell: (r) => formatMoney(D(r.onHand).gt(0) ? D(r.onHand).times(D(r.purchasePrice)) : 0) },
        { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
      ]} />
      <Pagination page={page} pageSize={50} total={data.total} searchParams={sp} basePath="/reports/inventory" />
    </div>
  );
}
