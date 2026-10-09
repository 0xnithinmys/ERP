import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getSupplier } from "@/server/services/party.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { SimpleTable } from "@/components/shared/simple-table";
import { EmptyState } from "@/components/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { PartyFormSheet } from "@/features/parties/party-form-sheet";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("suppliers.view");
  const { id } = await params;
  const data = await getSupplier(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { supplier: s } = data;
  const settings = await getSettings();
  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">{s.name} {!s.isActive && <StatusBadge status="INACTIVE" />}</span>}
        description={[s.phone, s.email, s.gstin && `GSTIN ${s.gstin}`].filter(Boolean).join(" · ") || undefined}
        breadcrumbs={[{ label: "Suppliers", href: "/suppliers" }, { label: s.name }]}
        actions={
          <>
            {can(actor, "suppliers.manage") && <PartyFormSheet kind="supplier" id={s.id} initial={s} />}
            {can(actor, "purchases.create") && s.isActive && (
              <Button asChild>
                <Link href={`/purchases/new?supplier=${s.id}`}>
                  <Plus /> New purchase
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Received purchases" value={data.purchaseCount} />
        <StatCard label="Total purchases" value={formatMoney(data.totalPurchases)} />
        <StatCard label="Outstanding payable" value={formatMoney(data.outstanding)} tone={Number(data.outstanding) > 0 ? "warning" : "success"} />
      </div>
      {(s.address || s.notes) && (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            {s.address && <div>{s.address}</div>}
            {s.notes && <div className="text-muted-foreground">{s.notes}</div>}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent purchases</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleTable
            rows={data.recent}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No purchases from this supplier yet" />}
            columns={[
              { key: "no", header: "Purchase", cell: (r) => <Link href={`/purchases/${r.id}`} className="font-mono text-primary hover:underline">{r.number}</Link> },
              { key: "date", header: "Date", cell: (r) => formatDate(r.purchaseDate, settings.timezone) },
              { key: "inv", header: "Invoice", cell: (r) => r.invoiceNumber ?? "—" },
              { key: "lines", header: "Lines", align: "right", cell: (r) => r._count.items },
              { key: "status", header: "Status", cell: (r) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.status !== "CANCELLED" && <StatusBadge status={r.paymentStatus} />}</div> },
              { key: "total", header: "Total", align: "right", cell: (r) => formatMoney(r.total) },
            ]}
          />
        </CardContent>
      </Card>
      {data.returns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Returns to this supplier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.returns.map((r) => (
              <div key={r.id} className="flex justify-between">
                <span><span className="font-mono">{r.number}</span> · {r.reason}</span>
                <span className="tabular">{formatMoney(r.totalAmount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
