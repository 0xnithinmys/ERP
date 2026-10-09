import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { Truck, Undo2, XCircle } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getSale } from "@/server/services/sale.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { PrintButton } from "@/components/shared/print-button";
import { ConfirmAction } from "@/components/shared/confirm-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { D } from "@/lib/decimal";
import { DISPATCH_STATUS_LABELS, formatDateTime, formatMoney } from "@/lib/format";
import { Invoice } from "@/features/sales/invoice";
import { CollectPayment } from "@/features/sales/collect-payment";
import { AutoPrint } from "@/features/sales/auto-print";
import { CreateDispatchButton } from "@/features/dispatch/create-dispatch-button";

export const metadata = { title: "Invoice" };

export default async function SaleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const actor = await requirePagePermission("sales.view");
  const { id } = await params;
  const { print } = await searchParams;
  const sale = await getSale(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const settings = await getSettings();
  const due = D(sale.total).minus(D(sale.amountPaid));
  const returnable = sale.status === "CONFIRMED" && sale.items.some((i) => D(i.quantity).gt(D(i.returnedQty)));
  const dispatchBlocks = sale.dispatch && ["PENDING", "PACKED"].includes(sale.dispatch.status);

  return (
    <div className="space-y-4">
      {print === "1" && <AutoPrint />}
      <PageHeader
        title={<span className="flex items-center gap-2">Invoice {sale.number} <StatusBadge status={sale.status === "CANCELLED" ? "CANCELLED" : sale.paymentStatus} /></span>}
        description={`${sale.customerName} · ${formatDateTime(sale.createdAt, settings.timezone)} · by ${sale.createdBy.name}`}
        breadcrumbs={[{ label: "Sales", href: "/sales" }, { label: sale.number }]}
        actions={
          <>
            <PrintButton label="Print invoice" />
            {returnable && can(actor, "returns.create") && !dispatchBlocks && (
              <Button asChild variant="outline">
                <Link href={`/returns/new?invoice=${encodeURIComponent(sale.number)}`}>
                  <Undo2 /> Process return
                </Link>
              </Button>
            )}
            {sale.status === "CONFIRMED" && !sale.dispatch && can(actor, "dispatch.manage") && <CreateDispatchButton saleId={sale.id} defaultAddress={sale.customer?.address ?? ""} />}
            {sale.status === "CONFIRMED" && due.gt(0) && can(actor, "sales.create") && <CollectPayment saleId={sale.id} due={due.toFixed(2)} />}
            {sale.status === "CONFIRMED" && can(actor, "sales.cancel") && sale.returns.length === 0 && !(sale.dispatch && ["DISPATCHED", "COMPLETED"].includes(sale.dispatch.status)) && (
              <ConfirmAction
                url={`/api/sales/${sale.id}/cancel`}
                label="Cancel sale"
                icon={<XCircle />}
                variant="destructive"
                title={`Cancel sale ${sale.number}?`}
                description="All items will be added back to stock through reversal entries. The invoice stays in history marked as cancelled. This cannot be undone."
                confirmLabel="Cancel sale"
                successMessage="Sale cancelled and stock restored"
                requireReason
              />
            )}
          </>
        }
      />

      {sale.status === "CANCELLED" && (
        <div className="no-print rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Cancelled {sale.cancelledAt ? formatDateTime(sale.cancelledAt, settings.timezone) : ""} by {sale.cancelledBy?.name ?? "—"}: {sale.cancelReason}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Invoice sale={sale} settings={settings} />
        <div className="no-print space-y-4">
          {sale.dispatch && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Truck className="size-4" /> Dispatch
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm">
                <Link href={`/dispatch/${sale.dispatch.id}`} className="font-mono text-primary hover:underline">{sale.dispatch.number}</Link>
                <StatusBadge status={sale.dispatch.status} label={DISPATCH_STATUS_LABELS[sale.dispatch.status]} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Returns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sale.returns.length === 0 ? (
                <p className="text-muted-foreground">No returns against this invoice.</p>
              ) : (
                sale.returns.map((r) => (
                  <Link key={r.id} href={`/returns/${r.id}`} className="flex items-center justify-between rounded-md p-1.5 hover:bg-muted">
                    <span>
                      <span className="font-mono">{r.number}</span>
                      <span className="block text-xs text-muted-foreground">{formatDateTime(r.createdAt, settings.timezone)} · {r.user.name}</span>
                    </span>
                    <span className="font-medium tabular">− {formatMoney(r.refundAmount)}</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
