import Link from "@/components/shared/app-link";
import { UserRound } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listCustomers } from "@/server/services/party.service";
import { can } from "@/server/auth/actor";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/url-filters";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { formatMoney } from "@/lib/format";
import { int, oneOf, str, PAGE_SIZE, type SP } from "@/lib/search-params";
import { PartyFormSheet } from "@/features/parties/party-form-sheet";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("customers.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const { rows, total } = await listCustomers(actor, { q: str(sp, "q"), status: oneOf(sp, "status", ["active", "inactive", "all"] as const), page, pageSize: PAGE_SIZE });
  return (
    <div>
      <PageHeader title="Customers" description="Regular and wholesale customers. Walk-in sales don’t need a customer." actions={can(actor, "customers.manage") && <PartyFormSheet kind="customer" />} />
      <Toolbar>
        <SearchInput placeholder="Name, phone or email…" />
        <FilterSelect param="status" placeholder="Status" allLabel="Active" options={[{ value: "inactive", label: "Inactive" }, { value: "all", label: "All" }]} />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={UserRound} title="No customers found" description="Customers can also be added from the POS while billing." />}
        columns={[
          { key: "name", header: "Customer", cell: (r) => <Link href={`/customers/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link> },
          { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—" },
          { key: "count", header: "Invoices", align: "right", cell: (r) => r.saleCount },
          { key: "total", header: "Total sales", align: "right", cell: (r) => formatMoney(r.totalSales) },
          { key: "due", header: "Balance due", align: "right", cell: (r) => (Number(r.balanceDue) > 0 ? <span className="font-medium text-amber-700">{formatMoney(r.balanceDue)}</span> : "—") },
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/customers" />
    </div>
  );
}
