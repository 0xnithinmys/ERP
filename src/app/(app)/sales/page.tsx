import Link from "@/components/shared/app-link";
import { Plus, ShoppingCart } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listSales } from "@/server/services/sale.service";
import { rangeFromParams } from "@/server/services/report.service";
import { can } from "@/server/auth/actor";
import { getSettings } from "@/server/services/settings.service";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/url-filters";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney, PAYMENT_MODE_LABELS, DISPATCH_STATUS_LABELS } from "@/lib/format";
import { int, oneOf, str, PAGE_SIZE, type SP } from "@/lib/search-params";

export const metadata = { title: "Sales" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("sales.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const range = str(sp, "range") ? await rangeFromParams({ range: str(sp, "range") }) : null;
  const { rows, total } = await listSales(actor, {
    q: str(sp, "q"),
    status: oneOf(sp, "status", ["CONFIRMED", "CANCELLED"] as const),
    paymentStatus: oneOf(sp, "payment", ["PAID", "PARTIAL", "UNPAID"] as const),
    from: range?.from,
    to: range?.to,
    page,
    pageSize: PAGE_SIZE,
  });
  const { timezone } = await getSettings();

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Invoices, payments and their status."
        actions={
          can(actor, "sales.create") && (
            <Button asChild>
              <Link href="/sales/new">
                <Plus /> New sale
              </Link>
            </Button>
          )
        }
      />
      <Toolbar>
        <SearchInput placeholder="Invoice no, customer or phone…" />
        <FilterSelect param="range" placeholder="Date" allLabel="All dates" options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }]} />
        <FilterSelect param="payment" placeholder="Payment" allLabel="Any payment" options={[{ value: "PAID", label: "Paid" }, { value: "PARTIAL", label: "Partially paid" }, { value: "UNPAID", label: "Unpaid" }]} />
        <FilterSelect param="status" placeholder="Status" allLabel="Any status" options={[{ value: "CONFIRMED", label: "Confirmed" }, { value: "CANCELLED", label: "Cancelled" }]} />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={ShoppingCart} title="No sales found" description="Sales you complete in the POS appear here." action={can(actor, "sales.create") ? { label: "Open POS", href: "/sales/new" } : undefined} />}
        columns={[
          { key: "no", header: "Invoice", cell: (r) => <Link href={`/sales/${r.id}`} className="font-mono text-sm font-medium text-primary hover:underline">{r.number}</Link> },
          { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, timezone)}</span> },
          { key: "cust", header: "Customer", cell: (r) => r.customerName },
          { key: "items", header: "Lines", align: "right", cell: (r) => r._count.items },
          { key: "mode", header: "Mode", cell: (r) => PAYMENT_MODE_LABELS[r.paymentMode] },
          { key: "status", header: "Status", cell: (r) => (
            <div className="flex flex-wrap gap-1">
              <StatusBadge status={r.status === "CANCELLED" ? "CANCELLED" : r.paymentStatus} />
              {r._count.returns > 0 && <StatusBadge status="PARTIAL" label={`${r._count.returns} return(s)`} />}
              {r.dispatch && <StatusBadge status={r.dispatch.status} label={`Dispatch: ${DISPATCH_STATUS_LABELS[r.dispatch.status]}`} />}
            </div>
          ) },
          { key: "total", header: "Total", align: "right", cell: (r) => <span className="font-medium">{formatMoney(r.total)}</span> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/sales" />
    </div>
  );
}
