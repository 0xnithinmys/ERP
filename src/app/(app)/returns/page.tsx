import Link from "@/components/shared/app-link";
import { Plus, Undo2 } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listReturns } from "@/server/services/return.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput, Toolbar } from "@/components/shared/url-filters";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { D } from "@/lib/decimal";
import { formatDateTime, formatMoney, formatQty, PAYMENT_MODE_LABELS } from "@/lib/format";
import { int, str, PAGE_SIZE, type SP } from "@/lib/search-params";

export const metadata = { title: "Returns" };

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("returns.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const [{ rows, total }, settings] = await Promise.all([listReturns(actor, { q: str(sp, "q"), page, pageSize: PAGE_SIZE }), getSettings()]);
  return (
    <div>
      <PageHeader
        title="Customer returns"
        description="Each return is a separate document linked to its original invoice."
        actions={
          can(actor, "returns.create") && (
            <Button asChild>
              <Link href="/returns/new">
                <Plus /> Process return
              </Link>
            </Button>
          )
        }
      />
      <Toolbar>
        <SearchInput placeholder="Return no, invoice no, customer…" />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={Undo2} title={str(sp, "q") ? "No matches for “" + str(sp, "q") + "”" : "No returns yet"} description={str(sp, "q") ? "Try a different search or clear the filters." : "Returns processed against invoices will appear here."} action={can(actor, "returns.create") ? { label: "Process return", href: "/returns/new" } : undefined} />}
        columns={[
          { key: "no", header: "Return", cell: (r) => <Link href={`/returns/${r.id}`} className="font-mono text-sm font-medium text-primary hover:underline">{r.number}</Link> },
          { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, settings.timezone)}</span> },
          { key: "inv", header: "Invoice", cell: (r) => <Link href={`/sales/${r.sale.id}`} className="font-mono text-xs hover:underline">{r.sale.number}</Link> },
          { key: "cust", header: "Customer", cell: (r) => r.sale.customerName },
          {
            key: "items",
            header: "Items",
            cell: (r) => {
              const good = r.items.filter((i) => i.condition === "GOOD").reduce((a, i) => a.plus(D(i.quantity)), D(0));
              const bad = r.items.filter((i) => i.condition === "DAMAGED").reduce((a, i) => a.plus(D(i.quantity)), D(0));
              return (
                <div className="flex gap-1">
                  {good.gt(0) && <StatusBadge status="GOOD" label={`${formatQty(good)} good`} />}
                  {bad.gt(0) && <StatusBadge status="DAMAGED" label={`${formatQty(bad)} damaged`} />}
                </div>
              );
            },
          },
          { key: "by", header: "By", cell: (r) => r.user.name },
          { key: "mode", header: "Refund", cell: (r) => PAYMENT_MODE_LABELS[r.refundMode] },
          { key: "amt", header: "Amount", align: "right", cell: (r) => <span className="font-medium">{formatMoney(r.refundAmount)}</span> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/returns" />
    </div>
  );
}
