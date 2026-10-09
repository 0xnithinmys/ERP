import Link from "@/components/shared/app-link";
import { Package, Plus } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listCategories, listProducts } from "@/server/services/product.service";
import { can } from "@/server/auth/actor";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/url-filters";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { formatMoney, formatQty } from "@/lib/format";
import { int, oneOf, str, PAGE_SIZE, type SP } from "@/lib/search-params";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("products.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const [{ rows, total }, categories] = await Promise.all([
    listProducts(actor, {
      q: str(sp, "q"),
      type: oneOf(sp, "type", ["FINISHED_GOOD", "RAW_MATERIAL"] as const),
      categoryId: str(sp, "category"),
      status: oneOf(sp, "status", ["active", "inactive", "all"] as const) ?? "active",
      page,
      pageSize: PAGE_SIZE,
    }),
    listCategories(),
  ]);
  const manage = can(actor, "products.manage");
  return (
    <div>
      <PageHeader
        title="Products"
        description="Product master with variants, SKUs and barcodes."
        actions={
          manage && (
            <>
              <Button asChild variant="outline">
                <Link href="/products/register-barcode">Register barcode</Link>
              </Button>
              <Button asChild>
                <Link href="/products/new">
                  <Plus /> Add product
                </Link>
              </Button>
            </>
          )
        }
      />
      <Toolbar>
        <SearchInput placeholder="Name, code, SKU, barcode…" />
        <FilterSelect param="type" placeholder="Type" allLabel="All types" options={[{ value: "FINISHED_GOOD", label: "Finished goods" }, { value: "RAW_MATERIAL", label: "Raw materials" }]} />
        <FilterSelect param="category" placeholder="Category" allLabel="All categories" options={categories.map((c) => ({ value: c.id, label: c.parentId ? `— ${c.name}` : c.name }))} />
        <FilterSelect param="status" placeholder="Status" allLabel="Active" options={[{ value: "inactive", label: "Inactive" }, { value: "all", label: "All" }]} />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={Package} title={str(sp, "q") ? "No matches for “" + str(sp, "q") + "”" : "No products yet"} description={str(sp, "q") ? "Try a different search or clear the filters." : "Add your first product with its sizes and colours to start tracking stock."} action={manage ? { label: "Add product", href: "/products/new" } : undefined} />}
        columns={[
          {
            key: "name",
            header: "Product",
            cell: (r) => (
              <Link href={`/products/${r.id}`} className="flex items-center gap-3">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt="" className="size-9 rounded-md border object-cover" />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
                    <Package className="size-4 text-muted-foreground" />
                  </span>
                )}
                <span>
                  <span className="block font-medium text-primary hover:underline">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{r.code}{r.brand ? ` · ${r.brand}` : ""}</span>
                </span>
              </Link>
            ),
          },
          { key: "type", header: "Type", cell: (r) => <StatusBadge status={r.type} /> },
          { key: "cat", header: "Category", cell: (r) => r.category ?? "—" },
          { key: "variants", header: "Variants", align: "right", cell: (r) => r.variantCount },
          { key: "stock", header: "Stock", align: "right", cell: (r) => `${formatQty(r.totalStock)} ${r.unit.toLowerCase()}` },
          { key: "price", header: "Price", align: "right", cell: (r) => (r.minPrice === r.maxPrice ? formatMoney(r.minPrice) : `${formatMoney(r.minPrice)} – ${formatMoney(r.maxPrice)}`) },
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/products" />
    </div>
  );
}
