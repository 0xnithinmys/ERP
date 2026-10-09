import Link from "@/components/shared/app-link";
import type { InventoryTxnType } from "@prisma/client";
import { requirePagePermission } from "@/server/auth/session";
import { rangeFromParams, stockMovementReport } from "@/server/services/report.service";
import { PageHeader } from "@/components/shared/page-header";
import { SimpleTable } from "@/components/shared/simple-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { FilterSelect, Toolbar } from "@/components/shared/url-filters";
import { Pagination } from "@/components/shared/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { D } from "@/lib/decimal";
import { formatDate, formatDateTime, formatQty, fullItemName, TXN_TYPE_LABELS } from "@/lib/format";
import { int, oneOf, str, type SP } from "@/lib/search-params";
import { RangePicker } from "@/features/reports/range-picker";

export const metadata = { title: "Stock movement report" };

const TYPES = Object.keys(TXN_TYPE_LABELS) as InventoryTxnType[];

export default async function StockMovementPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const range = await rangeFromParams({ range: str(sp, "range") ?? "week", from: str(sp, "from"), to: str(sp, "to") });
  const r = await stockMovementReport(actor, range, { type: oneOf(sp, "type", TYPES), page, pageSize: 50 });
  const label = `${formatDate(range.from, range.tz)} – ${formatDate(new Date(range.to.getTime() - 1), range.tz)}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Stock movement report" description="Purchases, sales, returns, adjustments and production — every ledger entry in the period." />
      <RangePicker preset={range.preset} fromKey={range.fromKey} toKey={range.toKey} csvKind="stock-movement" label={label} />
      <Card>
        <CardHeader><CardTitle className="text-base">Summary by movement type</CardTitle></CardHeader>
        <CardContent>
          {r.byType.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock movements in this period.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {r.byType.map((t) => (
                <div key={`${t.type}-${t.bucket}`} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between font-medium">{TXN_TYPE_LABELS[t.type] ?? t.type}{t.bucket === "DAMAGED" && <StatusBadge status="DAMAGED" />}</div>
                  <div className="mt-1 flex gap-4 text-xs text-muted-foreground tabular">
                    <span className="text-emerald-700">In +{formatQty(t.qtyIn)}</span>
                    <span className="text-red-700">Out −{formatQty(t.qtyOut)}</span>
                    <span>{t.count} entries</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Toolbar>
        <FilterSelect param="type" placeholder="Type" allLabel="All movement types" options={TYPES.map((t) => ({ value: t, label: TXN_TYPE_LABELS[t] }))} className="sm:w-60" />
      </Toolbar>
      <SimpleTable rows={r.rows} rowKey={(t) => t.id} empty={<EmptyState title="No ledger entries" />} columns={[
        { key: "d", header: "Date", cell: (t) => <span className="whitespace-nowrap text-sm">{formatDateTime(t.createdAt, range.tz)}</span> },
        { key: "ty", header: "Type", cell: (t) => <span>{TXN_TYPE_LABELS[t.type]}{t.bucket === "DAMAGED" && <StatusBadge status="DAMAGED" className="ml-1" />}</span> },
        { key: "ref", header: "Reference", cell: (t) => <span className="font-mono text-xs">{t.refNumber}</span> },
        { key: "p", header: "Item", cell: (t) => <Link href={`/inventory/${t.variantId}`} className="hover:underline">{fullItemName(t.variant.product.name, t.variant)}</Link> },
        { key: "in", header: "In", align: "right", cell: (t) => (D(t.quantity).gt(0) ? <span className="text-emerald-700">+{formatQty(t.quantity)}</span> : "") },
        { key: "out", header: "Out", align: "right", cell: (t) => (D(t.quantity).lt(0) ? <span className="text-red-700">−{formatQty(D(t.quantity).abs())}</span> : "") },
        { key: "b", header: "Balance", align: "right", cell: (t) => formatQty(t.balanceAfter) },
        { key: "u", header: "User", cell: (t) => t.user.name },
      ]} />
      <Pagination page={page} pageSize={50} total={r.total} searchParams={sp} basePath="/reports/stock-movement" />
    </div>
  );
}
