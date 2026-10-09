import { requirePagePermission } from "@/server/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { ReturnForm } from "@/features/returns/return-form";

export const metadata = { title: "Process return" };

export default async function NewReturnPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  await requirePagePermission("returns.create");
  const { invoice } = await searchParams;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Process return" description="Find the invoice, choose the items coming back and whether they are good or damaged." breadcrumbs={[{ label: "Returns", href: "/returns" }, { label: "Process return" }]} />
      <ReturnForm initialInvoice={invoice?.slice(0, 40) ?? ""} />
    </div>
  );
}
