import Link from "@/components/shared/app-link";
import { Boxes } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listSuppliers } from "@/server/services/party.service";
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

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("suppliers.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const { rows, total } = await listSuppliers(actor, { q: str(sp, "q"), status: oneOf(sp, "status", ["active", "inactive", "all"] as const), page, pageSize: PAGE_SIZE });
  const showMoney = can(actor, "dashboard.financials");
  return (
    <div>
      <PageHeader title="Suppliers" description="Who you buy yarn, trims and finished goods from." actions={can(actor, "suppliers.manage") && <PartyFormSheet kind="supplier" />} />
      <Toolbar>
        <SearchInput placeholder="Name, phone or GSTIN…" />
        <FilterSelect param="status" placeholder="Status" allLabel="Active" options={[{ value: "inactive", label: "Inactive" }, { value: "all", label: "All" }]} />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={Boxes} title={str(sp, "q") ? "No matches for “" + str(sp, "q") + "”" : "No suppliers yet"} description={str(sp, "q") ? "Try a different search or clear the filters." : "Add a supplier to start recording purchases."} />}
        columns={[
          { key: "name", header: "Supplier", cell: (r) => <Link href={`/suppliers/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link> },
          { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—" },
          { key: "gst", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin ?? "—"}</span> },
          { key: "count", header: "Purchases", align: "right", cell: (r) => r.purchaseCount },
          ...(showMoney
            ? [
                { key: "total", header: "Total purchased", align: "right" as const, cell: (r: (typeof rows)[number]) => formatMoney(r.totalPurchases) },
                { key: "due", header: "Payable", align: "right" as const, cell: (r: (typeof rows)[number]) => (Number(r.outstanding) > 0 ? <span className="font-medium text-amber-700">{formatMoney(r.outstanding)}</span> : "—") },
              ]
            : []),
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/suppliers" />
    </div>
  );
}
