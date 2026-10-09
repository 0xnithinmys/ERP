import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/session";
import { getCustomer } from "@/server/services/party.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { SimpleTable } from "@/components/shared/simple-table";
import { EmptyState } from "@/components/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { D } from "@/lib/decimal";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { PartyFormSheet } from "@/features/parties/party-form-sheet";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("customers.view");
  const { id } = await params;
  const data = await getCustomer(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const c = data.customer;
  const settings = await getSettings();
  const tz = settings.timezone;
  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">{c.name} {!c.isActive && <StatusBadge status="INACTIVE" />}</span>}
        description={[c.phone, c.email, c.address].filter(Boolean).join(" · ") || undefined}
        breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: c.name }]}
        actions={can(actor, "customers.manage") && <PartyFormSheet kind="customer" id={c.id} initial={c} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Invoices" value={data.saleCount} />
        <StatCard label="Total sales" value={formatMoney(data.totalSales)} />
        <StatCard label="Refunds" value={formatMoney(data.totalRefunds)} />
        <StatCard label="Balance due" value={formatMoney(data.balanceDue)} tone={Number(data.balanceDue) > 0 ? "warning" : "success"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleTable
            rows={data.recent}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No purchases yet" />}
            columns={[
              { key: "no", header: "Invoice", cell: (r) => <Link href={`/sales/${r.id}`} className="font-mono text-primary hover:underline">{r.number}</Link> },
              { key: "date", header: "Date", cell: (r) => formatDateTime(r.createdAt, tz) },
              { key: "lines", header: "Lines", align: "right", cell: (r) => r._count.items },
              { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status === "CANCELLED" ? "CANCELLED" : r.paymentStatus} /> },
              { key: "total", header: "Total", align: "right", cell: (r) => formatMoney(r.total) },
              { key: "due", header: "Due", align: "right", cell: (r) => (r.status === "CONFIRMED" && D(r.total).gt(D(r.amountPaid)) ? formatMoney(D(r.total).minus(D(r.amountPaid))) : "—") },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Returns</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleTable
            rows={data.returns}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No returns" />}
            columns={[
              { key: "no", header: "Return", cell: (r) => <Link href={`/returns/${r.id}`} className="font-mono text-primary hover:underline">{r.number}</Link> },
              { key: "inv", header: "Invoice", cell: (r) => <span className="font-mono text-xs">{r.sale.number}</span> },
              { key: "date", header: "Date", cell: (r) => formatDateTime(r.createdAt, tz) },
              { key: "qty", header: "Qty", align: "right", cell: (r) => formatQty(r.items.reduce((a, i) => a.plus(D(i.quantity)), D(0))) },
              { key: "amt", header: "Refund", align: "right", cell: (r) => formatMoney(r.refundAmount) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
