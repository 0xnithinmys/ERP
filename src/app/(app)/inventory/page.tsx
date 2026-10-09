import Link from "@/components/shared/app-link";
import { AlertTriangle, PackageX, SlidersHorizontal, Warehouse } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getInventorySummary, listInventory } from "@/server/services/inventory.service";
import { listCategories } from "@/server/services/product.service";
import { prisma } from "@/server/db";
import { can } from "@/server/auth/actor";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/url-filters";
import { Pagination } from "@/components/shared/pagination";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { int, oneOf, str, PAGE_SIZE, type SP } from "@/lib/search-params";
import { InventoryTable } from "@/features/inventory/inventory-table";
import { StockLookup } from "@/features/inventory/stock-lookup";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const [data, summary, categories, suppliers, sizes, colors] = await Promise.all([
    listInventory(actor, {
      q: str(sp, "q"),
      categoryId: str(sp, "category"),
      size: str(sp, "size"),
      color: str(sp, "color"),
      supplierId: str(sp, "supplier"),
      status: oneOf(sp, "status", ["low", "out", "in", "damaged"] as const),
      type: oneOf(sp, "type", ["FINISHED_GOOD", "RAW_MATERIAL"] as const),
      page,
      pageSize: PAGE_SIZE,
    }),
    getInventorySummary(actor),
    listCategories(),
    prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productVariant.findMany({ where: { size: { not: null }, isActive: true }, distinct: ["size"], select: { size: true }, orderBy: { size: "asc" } }),
    prisma.productVariant.findMany({ where: { color: { not: null }, isActive: true }, distinct: ["color"], select: { color: true }, orderBy: { color: "asc" } }),
  ]);
  const showCost = can(actor, "dashboard.financials");

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Current stock per variant, calculated from the stock ledger."
        actions={
          can(actor, "inventory.adjust") && (
            <Button asChild variant="outline">
              <Link href="/inventory/adjust">
                <SlidersHorizontal /> Adjust stock / record damage
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active variants" value={summary.totalVariants} icon={Warehouse} />
        <StatCard label="Low stock" value={summary.lowStock} icon={AlertTriangle} tone={summary.lowStock ? "warning" : "success"} href="/inventory?status=low" />
        <StatCard label="Out of stock" value={summary.outOfStock} icon={PackageX} tone={summary.outOfStock ? "danger" : "success"} href="/inventory?status=out" />
        <StatCard label={showCost ? "Stock value (cost)" : "Damaged units"} value={showCost ? formatMoney(summary.value) : summary.damagedUnits} sub={showCost ? `${summary.damagedUnits} damaged unit(s) held separately` : undefined} />
      </div>
      <StockLookup autoFocus={str(sp, "scan") === "1"} />
      <Toolbar>
        <SearchInput placeholder="Product, SKU, barcode, size, colour…" />
        <FilterSelect param="status" placeholder="Stock status" allLabel="Any status" options={[{ value: "in", label: "In stock" }, { value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }, { value: "damaged", label: "Has damaged stock" }]} />
        <FilterSelect param="type" placeholder="Type" allLabel="All types" options={[{ value: "FINISHED_GOOD", label: "Finished goods" }, { value: "RAW_MATERIAL", label: "Raw materials" }]} />
        <FilterSelect param="category" placeholder="Category" allLabel="All categories" options={categories.map((c) => ({ value: c.id, label: c.parentId ? `— ${c.name}` : c.name }))} />
        <FilterSelect param="size" placeholder="Size" allLabel="All sizes" className="sm:w-28" options={sizes.map((s) => ({ value: s.size!, label: s.size! }))} />
        <FilterSelect param="color" placeholder="Colour" allLabel="All colours" className="sm:w-32" options={colors.map((c) => ({ value: c.color!, label: c.color! }))} />
        <FilterSelect param="supplier" placeholder="Supplier" allLabel="All suppliers" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      </Toolbar>
      <InventoryTable rows={data.rows} showCost={showCost} />
      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} searchParams={sp} basePath="/inventory" />
    </div>
  );
}
