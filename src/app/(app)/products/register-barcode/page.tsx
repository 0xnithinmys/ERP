import { requirePagePermission } from "@/server/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { RegisterBarcode } from "@/features/products/register-barcode";

export const metadata = { title: "Register barcode" };

export default async function RegisterBarcodePage({ searchParams }: { searchParams: Promise<{ barcode?: string }> }) {
  await requirePagePermission("products.manage");
  const { barcode } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Register barcode" description="Assign a manufacturer/unknown barcode to an existing product variant." breadcrumbs={[{ label: "Products", href: "/products" }, { label: "Register barcode" }]} />
      <RegisterBarcode initialBarcode={barcode?.slice(0, 64) ?? ""} />
    </div>
  );
}
