import { requirePagePermission } from "@/server/auth/session";
import { listBoms } from "@/server/services/production.service";
import { PageHeader } from "@/components/shared/page-header";
import { ProductionForm } from "@/features/manufacturing/production-form";
import { fullItemName, formatQty } from "@/lib/format";

export const metadata = { title: "Start production" };

export default async function NewProductionPage({ searchParams }: { searchParams: Promise<{ bom?: string }> }) {
  const actor = await requirePagePermission("manufacturing.produce");
  const { bom } = await searchParams;
  const boms = await listBoms(actor);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Start production" description="Choose what to make and how many. Raw materials are checked and deducted, finished goods added — all in one step." breadcrumbs={[{ label: "Manufacturing", href: "/manufacturing" }, { label: "Start production" }]} />
      <ProductionForm
        boms={boms.map((b) => ({ id: b.id, label: fullItemName(b.variant.product.name, b.variant), unit: b.variant.product.unit, per: formatQty(b.outputQty) }))}
        initialBomId={bom && boms.some((b) => b.id === bom) ? bom : undefined}
      />
    </div>
  );
}
