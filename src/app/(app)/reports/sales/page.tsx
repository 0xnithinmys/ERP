import Link from "@/components/shared/app-link";
import { requirePagePermission } from "@/server/auth/session";
import { rangeFromParams, salesReport } from "@/server/services/report.service";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SimpleTable } from "@/components/shared/simple-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, formatMoney, formatQty, PAYMENT_MODE_LABELS } from "@/lib/format";
import { str, type SP } from "@/lib/search-params";
import { RangePicker } from "@/features/reports/range-picker";
import { ReportChart } from "@/features/reports/chart";

export const metadata = { title: "Sales report" };

export default async function SalesReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const range = await rangeFromParams({ range: str(sp, "range") ?? "today", from: str(sp, "from"), to: str(sp, "to") });
  const r = await salesReport(actor, range);
  const label = range.fromKey === range.toKey ? formatDate(range.from, range.tz) : `${formatDate(range.from, range.tz)} – ${formatDate(new Date(range.to.getTime() - 1), range.tz)}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Sales report" />
      <RangePicker preset={range.preset} fromKey={range.fromKey} toKey={range.toKey} csvKind="sales" label={label} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Number of sales" value={r.summary.salesCount} sub={r.summary.cancelled ? `${r.summary.cancelled} cancelled (excluded)` : undefined} />
        <StatCard label="Sales value" value={formatMoney(r.summary.salesValue)} sub={`Tax ${formatMoney(r.summary.tax)} · Discounts ${formatMoney(r.summary.discounts)}`} />
        <StatCard label="Items sold" value={formatQty(r.summary.itemsSold)} />
        <StatCard label="Returns" value={formatMoney(r.summary.returnsValue)} sub={`${r.summary.returnsCount} return(s), ${formatQty(r.summary.returnsQty)} item(s) · Net ${formatMoney(r.summary.netSales)}`} tone={r.summary.returnsCount ? "warning" : "default"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Daily sales</CardTitle></CardHeader>
          <CardContent><ReportChart data={r.daily} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">By payment mode</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {r.byMode.length === 0 ? <p className="text-muted-foreground">No sales in this period.</p> : r.byMode.map((m) => (
              <div key={m.mode} className="flex justify-between"><span>{PAYMENT_MODE_LABELS[m.mode]} <span className="text-muted-foreground">({m.count})</span></span><span className="font-medium tabular">{formatMoney(m.total)}</span></div>
            ))}
            <div className="border-t pt-2 text-xs text-muted-foreground">Collected: {formatMoney(r.summary.collected)}</div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Top-selling products</CardTitle></CardHeader>
        <CardContent>
          <SimpleTable rows={r.top} rowKey={(t) => t.variantId} empty={<EmptyState title="No sales in this period" />} columns={[
            { key: "n", header: "Product", cell: (t) => t.name },
            { key: "q", header: "Qty (net of returns)", align: "right", cell: (t) => formatQty(t.qty) },
            { key: "v", header: "Value", align: "right", cell: (t) => formatMoney(t.value) },
          ]} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Invoices ({r.sales.length})</CardTitle></CardHeader>
        <CardContent>
          <SimpleTable rows={r.sales} rowKey={(s) => s.id} empty={<EmptyState title="No invoices in this period" />} columns={[
            { key: "no", header: "Invoice", cell: (s) => <Link href={`/sales/${s.id}`} className="font-mono text-primary hover:underline">{s.number}</Link> },
            { key: "d", header: "Date", cell: (s) => formatDateTime(s.createdAt, range.tz) },
            { key: "c", header: "Customer", cell: (s) => s.customerName },
            { key: "st", header: "Status", cell: (s) => <StatusBadge status={s.status === "CANCELLED" ? "CANCELLED" : s.paymentStatus} /> },
            { key: "t", header: "Total", align: "right", cell: (s) => formatMoney(s.total) },
          ]} />
        </CardContent>
      </Card>
    </div>
  );
}
