import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { XCircle } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getProduction } from "@/server/services/production.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmAction } from "@/components/shared/confirm-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatQty, fullItemName } from "@/lib/format";

export const metadata = { title: "Production" };

export default async function ProductionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("manufacturing.view");
  const { id } = await params;
  const p = await getProduction(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const settings = await getSettings();
  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">Production {p.number} <StatusBadge status={p.status} /></span>}
        description={`${formatDateTime(p.createdAt, settings.timezone)} · by ${p.user.name}`}
        breadcrumbs={[{ label: "Manufacturing", href: "/manufacturing" }, { label: p.number }]}
        actions={
          p.status === "COMPLETED" &&
          can(actor, "manufacturing.cancel") && (
            <ConfirmAction
              url={`/api/production/${p.id}/cancel`}
              label="Cancel production"
              icon={<XCircle />}
              variant="destructive"
              title={`Cancel ${p.number}?`}
              description="Finished goods will be removed and raw materials returned to stock through reversal entries."
              confirmLabel="Cancel production"
              successMessage="Production cancelled and stock reversed"
              requireReason
            />
          )
        }
      />
      {p.status === "CANCELLED" && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">Cancelled: {p.cancelReason}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Finished goods produced</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular">
              +{formatQty(p.quantity)} <span className="text-sm font-normal">{p.variant.product.unit.toLowerCase()}</span>
            </div>
            <div className="text-sm text-muted-foreground">{fullItemName(p.variant.product.name, p.variant)} · {p.variant.sku}</div>
            {p.notes && <p className="mt-2 text-sm">{p.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raw materials consumed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {p.items.map((i) => (
              <div key={i.id} className="flex justify-between">
                <Link href={`/inventory/${i.materialId}`} className="hover:underline">{fullItemName(i.material.product.name, i.material)}</Link>
                <span className="font-medium text-red-700 tabular">−{formatQty(i.quantity)} {i.material.product.unit.toLowerCase()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
