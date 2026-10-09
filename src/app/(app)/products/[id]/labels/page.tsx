import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/session";
import { getProduct } from "@/server/services/product.service";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/shared/page-header";
import { BarcodeLabels } from "@/features/products/barcode-labels";

export const metadata = { title: "Barcode labels" };

export default async function LabelsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("products.view");
  const { id } = await params;
  const product = await getProduct(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <div>
      <PageHeader title={`Barcode labels — ${product.name}`} description="Choose how many labels to print for each variant." breadcrumbs={[{ label: "Products", href: "/products" }, { label: product.name, href: `/products/${product.id}` }, { label: "Labels" }]} />
      <BarcodeLabels
        productName={product.name}
        variants={product.variants.filter((v) => v.isActive).map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color, price: v.sellingPrice.toFixed(2) }))}
      />
    </div>
  );
}
