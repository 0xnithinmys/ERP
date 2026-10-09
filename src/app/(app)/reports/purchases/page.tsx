import Link from "@/components/shared/app-link";
import { requirePagePermission } from "@/server/auth/session";
import { purchaseReport, rangeFromParams } from "@/server/services/report.service";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SimpleTable } from "@/components/shared/simple-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { str, type SP } from "@/lib/search-params";
import { RangePicker } from "@/features/reports/range-picker";
import { ReportChart } from "@/features/reports/chart";

export const metadata = { title: "Purchase report" };

export default async function PurchaseReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const range = await rangeFromParams({ range: str(sp, "range") ?? "month", from: str(sp, "from"), to: str(sp, "to") });
  const r = await purchaseReport(actor, range);
  const label = `${formatDate(range.from, range.tz)} – ${formatDate(new Date(range.to.getTime() - 1), range.tz)}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Purchase report" description="Received purchases in the period." />
      <RangePicker preset={range.preset} fromKey={range.fromKey} toKey={range.toKey} csvKind="purchases" label={label} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Purchase count" value={r.summary.purchaseCount} />
        <StatCard label="Purchase value" value={formatMoney(r.summary.purchaseValue)} sub={`Tax ${formatMoney(r.summary.tax)}`} />
        <StatCard label="Items purchased" value={formatQty(r.summary.itemsPurchased)} />
        <StatCard label="Outstanding payable" value={formatMoney(r.summary.outstanding)} tone={Number(r.summary.outstanding) > 0 ? "warning" : "default"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Daily purchases</CardTitle></CardHeader>
          <CardContent><ReportChart data={r.daily} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">By supplier</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {r.bySupplier.length === 0 ? <p className="text-muted-foreground">No purchases in this period.</p> : r.bySupplier.map((s) => (
              <div key={s.supplier} className="flex justify-between"><span>{s.supplier} <span className="text-muted-foreground">({s.count})</span></span><span className="font-medium tabular">{formatMoney(s.total)}</span></div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Purchases ({r.purchases.length})</CardTitle></CardHeader>
        <CardContent>
          <SimpleTable rows={r.purchases} rowKey={(p) => p.id} empty={<EmptyState title="No purchases received in this period" />} columns={[
            { key: "no", header: "Purchase", cell: (p) => <Link href={`/purchases/${p.id}`} className="font-mono text-primary hover:underline">{p.number}</Link> },
            { key: "d", header: "Received", cell: (p) => (p.receivedAt ? formatDateTime(p.receivedAt, range.tz) : "—") },
            { key: "s", header: "Supplier", cell: (p) => p.supplier.name },
            { key: "i", header: "Invoice", cell: (p) => p.invoiceNumber ?? "—" },
            { key: "ps", header: "Payment", cell: (p) => <StatusBadge status={p.paymentStatus} /> },
            { key: "t", header: "Total", align: "right", cell: (p) => formatMoney(p.total) },
          ]} />
        </CardContent>
      </Card>
    </div>
  );
}
