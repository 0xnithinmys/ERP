import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/session";
import { getDispatch } from "@/server/services/dispatch.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { PrintButton } from "@/components/shared/print-button";
import { DISPATCH_STATUS_LABELS, formatDateTime } from "@/lib/format";
import { DispatchWorkspace } from "@/features/dispatch/dispatch-workspace";

export const metadata = { title: "Dispatch" };

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("dispatch.view");
  const { id } = await params;
  const d = await getDispatch(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const settings = await getSettings();
  const tz = settings.timezone;
  const steps = ["PENDING", "PACKED", "DISPATCHED", "COMPLETED"] as const;
  const idx = steps.indexOf(d.status as (typeof steps)[number]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">Dispatch {d.number} <StatusBadge status={d.status} label={DISPATCH_STATUS_LABELS[d.status]} /></span>}
        description={
          <>
            Invoice <Link href={`/sales/${d.sale.id}`} className="font-mono text-primary hover:underline">{d.sale.number}</Link> · {d.sale.customerName}
          </>
        }
        breadcrumbs={[{ label: "Dispatch", href: "/dispatch" }, { label: d.number }]}
        actions={<PrintButton label="Print packing slip" />}
      />
      {d.status !== "CANCELLED" && (
        <ol className="no-print grid grid-cols-4 gap-1 text-xs" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} className={`rounded-md border px-2 py-1.5 text-center ${i <= idx ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground"}`} aria-current={i === idx ? "step" : undefined}>
              {i + 1}. {DISPATCH_STATUS_LABELS[s]}
            </li>
          ))}
        </ol>
      )}
      <DispatchWorkspace
        dispatch={{
          id: d.id,
          number: d.number,
          status: d.status,
          address: d.address ?? d.sale.customer?.address ?? null,
          phone: d.sale.customer?.phone ?? null,
          customerName: d.sale.customerName,
          saleNumber: d.sale.number,
          carrier: d.carrier,
          trackingNumber: d.trackingNumber,
          packedInfo: d.packedAt ? `Packed by ${d.packedBy?.name ?? "—"} · ${formatDateTime(d.packedAt, tz)}` : null,
          dispatchedInfo: d.dispatchedAt ? `Dispatched by ${d.dispatchedBy?.name ?? "—"} · ${formatDateTime(d.dispatchedAt, tz)}` : null,
          completedInfo: d.completedAt ? `Delivered · ${formatDateTime(d.completedAt, tz)}` : null,
          items: d.items.map((i) => ({
            id: i.id,
            name: `${i.saleItem.productName}${i.saleItem.variantLabel ? ` — ${i.saleItem.variantLabel}` : ""}`,
            sku: i.variant.sku,
            barcode: i.variant.barcode,
            unit: i.variant.product.unit,
            required: i.requiredQty.toString(),
            scanned: i.scannedQty.toString(),
          })),
        }}
        canManage={can(actor, "dispatch.manage")}
      />
    </div>
  );
}
