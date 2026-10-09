import Link from "@/components/shared/app-link";
import { Truck } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listDispatches } from "@/server/services/dispatch.service";
import { getSettings } from "@/server/services/settings.service";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput, Toolbar } from "@/components/shared/url-filters";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { cn } from "@/lib/utils";
import { DISPATCH_STATUS_LABELS, formatDateTime, formatMoney } from "@/lib/format";
import { int, oneOf, str, PAGE_SIZE, type SP } from "@/lib/search-params";

export const metadata = { title: "Dispatch" };

const TABS = ["PENDING", "PACKED", "DISPATCHED", "COMPLETED", "CANCELLED"] as const;

export default async function DispatchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("dispatch.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const status = oneOf(sp, "status", TABS);
  const [{ rows, total, counts }, settings] = await Promise.all([listDispatches(actor, { status, q: str(sp, "q"), page, pageSize: PAGE_SIZE }), getSettings()]);
  return (
    <div>
      <PageHeader title="Dispatch" description="Pack orders by scanning every item, then mark them dispatched and delivered." />
      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Dispatch status">
        {[undefined, ...TABS].map((t) => (
          <Link
            key={t ?? "all"}
            href={t ? `/dispatch?status=${t}` : "/dispatch"}
            role="tab"
            aria-selected={status === t}
            className={cn("rounded-full border px-3 py-1 text-sm transition-colors", status === t ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
          >
            {t ? DISPATCH_STATUS_LABELS[t] : "All"}
            {t && counts[t] ? <span className="ml-1.5 tabular opacity-80">{counts[t]}</span> : null}
          </Link>
        ))}
      </div>
      <Toolbar>
        <SearchInput placeholder="Dispatch no, invoice no, customer…" />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={Truck} title="No orders here" description="Sales marked “needs dispatch” appear here for packing." />}
        columns={[
          { key: "no", header: "Dispatch", cell: (r) => <Link href={`/dispatch/${r.id}`} className="font-mono text-sm font-medium text-primary hover:underline">{r.number}</Link> },
          { key: "inv", header: "Invoice", cell: (r) => <span className="font-mono text-xs">{r.sale.number}</span> },
          { key: "cust", header: "Customer", cell: (r) => r.sale.customerName },
          { key: "date", header: "Created", cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, settings.timezone)}</span> },
          { key: "lines", header: "Lines", align: "right", cell: (r) => r._count.items },
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} label={DISPATCH_STATUS_LABELS[r.status]} /> },
          { key: "total", header: "Value", align: "right", cell: (r) => formatMoney(r.sale.total) },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/dispatch" />
    </div>
  );
}
