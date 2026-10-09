import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getPurchase } from "@/server/services/purchase.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmAction } from "@/components/shared/confirm-button";
import { PrintButton } from "@/components/shared/print-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { D } from "@/lib/decimal";
import { formatDate, formatDateTime, formatMoney, formatQty, variantLabel } from "@/lib/format";
import { PurchasePayment } from "@/features/purchases/purchase-payment";
import { SupplierReturnButton } from "@/features/purchases/supplier-return";

export const metadata = { title: "Purchase" };

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("purchases.view");
  const { id } = await params;
  const p = await getPurchase(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const settings = await getSettings();
  const due = D(p.total).minus(D(p.amountPaid));
  const tz = settings.timezone;

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">Purchase {p.number} <StatusBadge status={p.status} /></span>}
        description={`${p.supplier.name}${p.invoiceNumber ? ` · Invoice ${p.invoiceNumber}` : ""} · ${formatDate(p.purchaseDate, tz)}`}
        breadcrumbs={[{ label: "Purchases", href: "/purchases" }, { label: p.number }]}
        actions={
          <>
            <PrintButton />
            {p.status === "DRAFT" && can(actor, "purchases.receive") && (
              <ConfirmAction
                url={`/api/purchases/${p.id}/receive`}
                label="Receive stock"
                icon={<CheckCircle2 />}
                title={`Receive ${p.number}?`}
                description="All quantities on this purchase will be added to inventory now."
                confirmLabel="Receive stock"
                successMessage="Purchase received successfully"
              />
            )}
            {p.status === "RECEIVED" && can(actor, "supplier_returns.create") && (
              <SupplierReturnButton
                purchaseId={p.id}
                items={p.items.map((i) => ({ id: i.id, name: `${i.variant.product.name}${variantLabel(i.variant) ? ` — ${variantLabel(i.variant)}` : ""}`, remaining: D(i.quantity).minus(D(i.returnedQty)).toString(), unit: i.variant.product.unit }))}
              />
            )}
            {p.status !== "CANCELLED" && due.gt(0) && can(actor, "purchases.create") && <PurchasePayment purchaseId={p.id} due={due.toFixed(2)} />}
            {p.status !== "CANCELLED" && can(actor, "purchases.cancel") && (
              <ConfirmAction
                url={`/api/purchases/${p.id}/cancel`}
                label="Cancel purchase"
                icon={<XCircle />}
                variant="destructive"
                title={`Cancel ${p.number}?`}
                description={p.status === "RECEIVED" ? "Received quantities will be removed from stock using reversal entries. This fails if the stock has already been sold." : "The draft will be marked cancelled."}
                confirmLabel="Cancel purchase"
                successMessage="Purchase cancelled"
                requireReason
              />
            )}
          </>
        }
      />
      {p.status === "CANCELLED" && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">Cancelled {p.cancelledAt ? formatDateTime(p.cancelledAt, tz) : ""}: {p.cancelReason}</div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card className="print-area">
          <CardHeader>
            <CardTitle className="text-base">Items</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b text-left">
                  <th className="p-2 font-medium">Product</th>
                  <th className="p-2 text-right font-medium">Qty</th>
                  <th className="p-2 text-right font-medium">Rate</th>
                  <th className="p-2 text-right font-medium">Disc.</th>
                  <th className="p-2 text-right font-medium">Tax</th>
                  <th className="p-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="p-2">
                      <div className="font-medium">{i.variant.product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[variantLabel(i.variant), i.variant.sku].filter(Boolean).join(" · ")}
                        {D(i.returnedQty).gt(0) && <span className="ml-1 text-red-600">(returned {formatQty(i.returnedQty)})</span>}
                      </div>
                    </td>
                    <td className="p-2 text-right tabular">{formatQty(i.quantity)} {i.variant.product.unit.toLowerCase()}</td>
                    <td className="p-2 text-right tabular">{formatMoney(i.rate)}</td>
                    <td className="p-2 text-right tabular">{D(i.discount).gt(0) ? formatMoney(i.discount) : "—"}</td>
                    <td className="p-2 text-right tabular">{D(i.taxAmount).gt(0) ? `${formatMoney(i.taxAmount)} (${D(i.taxRate)}%)` : "—"}</td>
                    <td className="p-2 text-right font-medium tabular">{formatMoney(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-1.5 p-5 text-sm">
              <Row label="Subtotal" value={formatMoney(p.subtotal)} />
              <Row label="Tax" value={formatMoney(p.taxAmount)} />
              {D(p.discount).gt(0) && <Row label="Discount" value={`− ${formatMoney(p.discount)}`} />}
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span className="tabular">{formatMoney(p.total)}</span></div>
              <Row label="Paid" value={formatMoney(p.amountPaid)} />
              {due.gt(0) && p.status !== "CANCELLED" && <Row label="Balance payable" value={formatMoney(due)} />}
              <div className="pt-2"><StatusBadge status={p.paymentStatus} /></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 p-5 text-xs text-muted-foreground">
              <div>Created by {p.createdBy.name} · {formatDateTime(p.createdAt, tz)}</div>
              {p.receivedAt && <div>Received by {p.receivedBy?.name} · {formatDateTime(p.receivedAt, tz)}</div>}
              {p.notes && <div className="pt-2 text-foreground">{p.notes}</div>}
            </CardContent>
          </Card>
          {p.supplierReturns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Returns to supplier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {p.supplierReturns.map((r) => (
                  <div key={r.id} className="flex justify-between">
                    <span>
                      <span className="font-mono">{r.number}</span>
                      <span className="block text-xs text-muted-foreground">{r.reason} · {r.user.name}</span>
                    </span>
                    <span className="tabular">{formatMoney(r.totalAmount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
