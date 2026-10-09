import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getVariantHits } from "@/server/services/product.service";
import { PageHeader } from "@/components/shared/page-header";
import { BomForm } from "@/features/manufacturing/bom-form";

export const metadata = { title: "Bill of materials" };

export default async function BomPage({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  const actor = await requirePagePermission("manufacturing.manage_bom");
  const { variant } = await searchParams;
  let initial = null;
  if (variant) {
    const [hit] = await getVariantHits(actor, [variant]);
    const bom = await prisma.billOfMaterial.findUnique({ where: { variantId: variant }, include: { items: true } });
    const materials = bom ? await getVariantHits(actor, bom.items.map((i) => i.materialId)) : [];
    if (hit) {
      initial = {
        finished: hit,
        outputQty: bom?.outputQty.toString() ?? "1",
        notes: bom?.notes ?? "",
        items: bom ? bom.items.map((i) => ({ material: materials.find((m) => m.variantId === i.materialId)!, quantity: i.quantity.toString() })).filter((x) => x.material) : [],
      };
    }
  }
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={initial ? "Edit bill of materials" : "New bill of materials"} description="Raw materials needed to make the finished item. Quantities are per output quantity (e.g. per 1 pair or per 12-pair batch)." breadcrumbs={[{ label: "Manufacturing", href: "/manufacturing?tab=boms" }, { label: "Bill of materials" }]} />
      <BomForm initial={initial} />
    </div>
  );
}
