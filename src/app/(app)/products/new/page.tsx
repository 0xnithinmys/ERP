import { requirePagePermission } from "@/server/auth/session";
import { listCategories, nextProductCode } from "@/server/services/product.service";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/features/products/product-form";

export const metadata = { title: "Add product" };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ barcode?: string; type?: string }> }) {
  await requirePagePermission("products.manage");
  const sp = await searchParams;
  const [categories, suppliers, code] = await Promise.all([
    listCategories(),
    prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    nextProductCode(),
  ]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Add product" description="Create the product once, then one variant per size/colour. Each variant has its own SKU, barcode and stock." breadcrumbs={[{ label: "Products", href: "/products" }, { label: "Add product" }]} />
      <ProductForm
        mode="create"
        categories={categories}
        suppliers={suppliers}
        initial={{ code, type: sp.type === "RAW_MATERIAL" ? "RAW_MATERIAL" : "FINISHED_GOOD", barcode: sp.barcode?.slice(0, 64) }}
      />
    </div>
  );
}
