import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { Package, Tag } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getProduct, listCategories } from "@/server/services/product.service";
import { prisma } from "@/server/db";
import { can } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/features/products/product-form";
import { VariantsTable } from "@/features/products/variants-table";
import { UNIT_LABELS, type UnitCode } from "@/lib/calculations";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("products.view");
  const { id } = await params;
  const product = await getProduct(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const manage = can(actor, "products.manage");
  const [categories, suppliers] = manage
    ? await Promise.all([listCategories(), prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })])
    : [[], []];

  const variants = product.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    barcode: v.barcode,
    size: v.size,
    color: v.color,
    purchasePrice: v.purchasePrice.toFixed(2),
    sellingPrice: v.sellingPrice.toFixed(2),
    minStock: v.minStock.toString(),
    reorderLevel: v.reorderLevel.toString(),
    isActive: v.isActive,
    onHand: v.stock?.onHand.toString() ?? "0",
    damaged: v.stock?.damaged.toString() ?? "0",
    hasBom: !!v.bom,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {product.name} <StatusBadge status={product.type} /> {!product.isActive && <StatusBadge status="INACTIVE" />}
          </span>
        }
        description={`${product.code} · ${product.category?.name ?? "Uncategorised"}${product.subcategory ? ` / ${product.subcategory.name}` : ""} · ${UNIT_LABELS[product.unit as UnitCode]}`}
        breadcrumbs={[{ label: "Products", href: "/products" }, { label: product.name }]}
        actions={
          <Button asChild variant="outline">
            <Link href={`/products/${product.id}/labels`}>
              <Tag /> Print barcode labels
            </Link>
          </Button>
        }
      />
      <VariantsTable productId={product.id} productName={product.name} unit={product.unit} variants={variants} canManage={manage} />
      {manage ? (
        <ProductForm
          mode="edit"
          productId={product.id}
          categories={categories}
          suppliers={suppliers}
          initial={{
            name: product.name,
            code: product.code,
            type: product.type,
            categoryId: product.categoryId,
            subcategoryId: product.subcategoryId,
            supplierId: product.supplierId,
            brand: product.brand,
            unit: product.unit,
            description: product.description,
            imageUrl: product.imageUrl,
            isActive: product.isActive,
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4 text-sm">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt={product.name} className="size-24 rounded-lg border object-cover" />
            ) : (
              <div className="flex size-24 items-center justify-center rounded-lg border bg-muted">
                <Package className="size-6 text-muted-foreground" />
              </div>
            )}
            <div className="space-y-1">
              <div>Brand: {product.brand ?? "—"}</div>
              <div>Supplier: {product.supplier?.name ?? "—"}</div>
              <div className="text-muted-foreground">{product.description}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
