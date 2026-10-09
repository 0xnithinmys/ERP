import { requirePagePermission } from "@/server/auth/session";
import { getVariantHits } from "@/server/services/product.service";
import { listAdjustments } from "@/server/services/adjustment.service";
import { getSettings } from "@/server/services/settings.service";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdjustmentForm } from "@/features/inventory/adjustment-form";
import { ADJUSTMENT_REASON_LABELS, formatDateTime, formatQty, fullItemName } from "@/lib/format";
import { D } from "@/lib/decimal";

export const metadata = { title: "Adjust stock" };

export default async function AdjustPage({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  const actor = await requirePagePermission("inventory.adjust");
  const { variant } = await searchParams;
  const [initial, recent, settings] = await Promise.all([
    variant ? getVariantHits(actor, [variant]) : Promise.resolve([]),
    listAdjustments(actor, { page: 1, pageSize: 10 }),
    getSettings(),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Adjust stock" description="Record damage, loss, found stock or a correction. A reason is always required and the change is logged." breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Adjust stock" }]} />
      <AdjustmentForm initial={initial} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent adjustments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {recent.rows.length === 0 ? (
            <p className="text-muted-foreground">No adjustments yet.</p>
          ) : (
            recent.rows.map((a) => (
              <div key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b pb-2 last:border-0">
                <span className="font-mono text-xs">{a.number}</span>
                <span className="font-medium">{ADJUSTMENT_REASON_LABELS[a.reason]}</span>
                <span className="text-muted-foreground">{a.note}</span>
                <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(a.createdAt, settings.timezone)} · {a.user.name}</span>
                <div className="w-full text-xs">
                  {a.items.map((i) => (
                    <span key={i.id} className="mr-3">
                      {fullItemName(i.variant.product.name, i.variant)} {i.bucket === "DAMAGED" ? "(damaged)" : ""}{" "}
                      <span className={D(i.quantity).gt(0) ? "text-emerald-700" : "text-red-700"}>
                        {D(i.quantity).gt(0) ? "+" : "−"}
                        {formatQty(D(i.quantity).abs())}
                      </span>{" "}
                      → {formatQty(i.balanceAfter)}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
