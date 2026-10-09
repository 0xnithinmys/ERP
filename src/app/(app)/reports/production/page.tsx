import Link from "@/components/shared/app-link";
import { requirePagePermission } from "@/server/auth/session";
import { productionReport, rangeFromParams } from "@/server/services/report.service";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SimpleTable } from "@/components/shared/simple-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, formatMoney, formatQty, fullItemName } from "@/lib/format";
import { str, type SP } from "@/lib/search-params";
import { RangePicker } from "@/features/reports/range-picker";

export const metadata = { title: "Production report" };

export default async function ProductionReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const range = await rangeFromParams({ range: str(sp, "range") ?? "month", from: str(sp, "from"), to: str(sp, "to") });
  const r = await productionReport(actor, range);
  const label = `${formatDate(range.from, range.tz)} – ${formatDate(new Date(range.to.getTime() - 1), range.tz)}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Production report" />
      <RangePicker preset={range.preset} fromKey={range.fromKey} toKey={range.toKey} csvKind="production" label={label} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Production runs" value={r.summary.runs} />
        <StatCard label="Finished goods produced" value={formatQty(r.summary.totalProduced)} />
        <StatCard label="Raw material cost" value={formatMoney(r.summary.materialCost)} sub="at current cost price" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Finished goods produced</CardTitle></CardHeader>
          <CardContent>
            <SimpleTable rows={r.produced} rowKey={(p) => p.name} empty={<EmptyState title="Nothing produced" />} columns={[
              { key: "n", header: "Item", cell: (p) => p.name },
              { key: "r", header: "Runs", align: "right", cell: (p) => p.runs },
              { key: "q", header: "Quantity", align: "right", cell: (p) => `${formatQty(p.qty)} ${p.unit.toLowerCase()}` },
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Raw material consumption</CardTitle></CardHeader>
          <CardContent>
            <SimpleTable rows={r.consumed} rowKey={(c) => c.name} empty={<EmptyState title="No consumption" />} columns={[
              { key: "n", header: "Material", cell: (c) => c.name },
              { key: "q", header: "Consumed", align: "right", cell: (c) => `${formatQty(c.qty)} ${c.unit.toLowerCase()}` },
              { key: "c", header: "Cost", align: "right", cell: (c) => formatMoney(c.cost) },
            ]} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Runs</CardTitle></CardHeader>
        <CardContent>
          <SimpleTable rows={r.list} rowKey={(p) => p.id} empty={<EmptyState title="No production runs in this period" />} columns={[
            { key: "no", header: "Run", cell: (p) => <Link href={`/manufacturing/${p.id}`} className="font-mono text-primary hover:underline">{p.number}</Link> },
            { key: "d", header: "Date", cell: (p) => formatDateTime(p.createdAt, range.tz) },
            { key: "i", header: "Item", cell: (p) => fullItemName(p.variant.product.name, p.variant) },
            { key: "q", header: "Qty", align: "right", cell: (p) => formatQty(p.quantity) },
            { key: "s", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
          ]} />
        </CardContent>
      </Card>
    </div>
  );
}
