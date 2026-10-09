import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { toDateKey } from "@/lib/dates";
import { PageHeader } from "@/components/shared/page-header";
import { PurchaseForm } from "@/features/purchases/purchase-form";

export const metadata = { title: "Create purchase" };

export default async function NewPurchasePage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const actor = await requirePagePermission("purchases.create");
  const { supplier } = await searchParams;
  const [suppliers, settings] = await Promise.all([
    prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Create purchase" description="Scan or search products, enter quantities and rates, then receive the stock." breadcrumbs={[{ label: "Purchases", href: "/purchases" }, { label: "Create purchase" }]} />
      <PurchaseForm suppliers={suppliers} today={toDateKey(new Date(), settings.timezone)} canReceive={can(actor, "purchases.receive")} defaultSupplierId={supplier} defaultTaxRate={settings.taxEnabled ? settings.taxRate.toString() : "0"} />
    </div>
  );
}
