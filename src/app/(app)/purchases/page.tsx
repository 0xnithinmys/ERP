import Link from "@/components/shared/app-link";
import { ArrowDownToLine, Plus } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listPurchases } from "@/server/services/purchase.service";
import { getSettings } from "@/server/services/settings.service";
import { prisma } from "@/server/db";
import { can } from "@/server/auth/actor";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/url-filters";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { int, oneOf, str, PAGE_SIZE, type SP } from "@/lib/search-params";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("purchases.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const [{ rows, total }, suppliers, settings] = await Promise.all([
    listPurchases(actor, {
      q: str(sp, "q"),
      status: oneOf(sp, "status", ["DRAFT", "RECEIVED", "CANCELLED"] as const),
      supplierId: str(sp, "supplier"),
      page,
      pageSize: PAGE_SIZE,
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);
  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Stock received from suppliers. Receiving a purchase increases inventory."
        actions={
          can(actor, "purchases.create") && (
            <Button asChild>
              <Link href="/purchases/new">
                <Plus /> Create purchase
              </Link>
            </Button>
          )
        }
      />
      <Toolbar>
        <SearchInput placeholder="Purchase no, supplier invoice, supplier…" />
        <FilterSelect param="status" placeholder="Status" allLabel="Any status" options={[{ value: "DRAFT", label: "Draft" }, { value: "RECEIVED", label: "Received" }, { value: "CANCELLED", label: "Cancelled" }]} />
        <FilterSelect param="supplier" placeholder="Supplier" allLabel="All suppliers" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={ArrowDownToLine} title={str(sp, "q") ? "No matches for “" + str(sp, "q") + "”" : "No purchases yet"} description={str(sp, "q") ? "Try a different search or clear the filters." : "Create your first purchase to start tracking inventory."} action={can(actor, "purchases.create") ? { label: "Create purchase", href: "/purchases/new" } : undefined} />}
        columns={[
          { key: "no", header: "Purchase", cell: (r) => <Link href={`/purchases/${r.id}`} className="font-mono text-sm font-medium text-primary hover:underline">{r.number}</Link> },
          { key: "date", header: "Date", cell: (r) => formatDate(r.purchaseDate, settings.timezone) },
          { key: "sup", header: "Supplier", cell: (r) => r.supplier.name },
          { key: "inv", header: "Supplier invoice", cell: (r) => r.invoiceNumber ?? "—" },
          { key: "lines", header: "Lines", align: "right", cell: (r) => r._count.items },
          { key: "status", header: "Status", cell: (r) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.status !== "CANCELLED" && <StatusBadge status={r.paymentStatus} />}</div> },
          { key: "total", header: "Total", align: "right", cell: (r) => <span className="font-medium">{formatMoney(r.total)}</span> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/purchases" />
    </div>
  );
}
