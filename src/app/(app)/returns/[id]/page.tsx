import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/session";
import { getReturn } from "@/server/services/return.service";
import { getSettings } from "@/server/services/settings.service";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { PrintButton } from "@/components/shared/print-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatMoney, formatQty, PAYMENT_MODE_LABELS } from "@/lib/format";

export const metadata = { title: "Return" };

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("returns.view");
  const { id } = await params;
  const r = await getReturn(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const settings = await getSettings();
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Return ${r.number}`}
        description={`${r.sale.customerName} · ${formatDateTime(r.createdAt, settings.timezone)} · processed by ${r.user.name}`}
        breadcrumbs={[{ label: "Returns", href: "/returns" }, { label: r.number }]}
        actions={<PrintButton label="Print return note" />}
      />
      <Card className="print-area mx-auto max-w-3xl">
        <CardContent className="space-y-4 p-6 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <div className="text-lg font-semibold">{settings.businessName}</div>
              <div className="text-xs text-muted-foreground">Return note {r.number}</div>
            </div>
            <div className="text-right text-xs">
              Against invoice{" "}
              <Link href={`/sales/${r.sale.id}`} className="font-mono text-primary">{r.sale.number}</Link>
              <div>{formatDateTime(r.createdAt, settings.timezone)}</div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b text-left">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 font-medium">Condition</th>
                <th className="py-2 font-medium">Reason</th>
                <th className="py-2 text-right font-medium">Refund</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="py-2">{i.saleItem.productName}{i.saleItem.variantLabel ? ` — ${i.saleItem.variantLabel}` : ""}</td>
                  <td className="py-2 text-right tabular">{formatQty(i.quantity)}</td>
                  <td className="py-2"><StatusBadge status={i.condition} /></td>
                  <td className="py-2">{i.reason}</td>
                  <td className="py-2 text-right tabular">{formatMoney(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-6 border-t pt-3">
            <span className="text-muted-foreground">Refund via {PAYMENT_MODE_LABELS[r.refundMode]}</span>
            <span className="text-base font-semibold tabular">{formatMoney(r.refundAmount)}</span>
          </div>
          {r.notes && <p className="text-xs text-muted-foreground">Note: {r.notes}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
