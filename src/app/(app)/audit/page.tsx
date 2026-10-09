import { requirePagePermission } from "@/server/auth/session";
import { listAuditLogs } from "@/server/services/audit.service";
import { getSettings } from "@/server/services/settings.service";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/url-filters";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { EmptyState } from "@/components/shared/states";
import { formatDateTime } from "@/lib/format";
import { int, str, type SP } from "@/lib/search-params";
import { AuditChanges } from "@/features/admin/audit-changes";

export const metadata = { title: "Audit log" };

const ENTITIES = ["Sale", "Purchase", "CustomerReturn", "SupplierReturn", "StockAdjustment", "Production", "BillOfMaterial", "Dispatch", "Product", "ProductVariant", "Category", "Supplier", "Customer", "User", "Setting"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("audit.view");
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const [{ rows, total }, users, settings] = await Promise.all([
    listAuditLogs(actor, { page, pageSize: 50, entity: str(sp, "entity"), userId: str(sp, "user"), q: str(sp, "q") }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);
  return (
    <div>
      <PageHeader title="Audit log" description="Who did what and when. Entries cannot be edited or deleted." />
      <Toolbar>
        <SearchInput placeholder="Search descriptions…" />
        <FilterSelect param="entity" placeholder="Record type" allLabel="All records" options={ENTITIES.map((e) => ({ value: e, label: e }))} />
        <FilterSelect param="user" placeholder="User" allLabel="All users" options={users.map((u) => ({ value: u.id, label: u.name }))} />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No audit entries" />}
        columns={[
          { key: "t", header: "When", cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, settings.timezone)}</span> },
          { key: "u", header: "User", cell: (r) => r.user?.name ?? "System" },
          { key: "a", header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
          { key: "s", header: "Details", cell: (r) => <div className="max-w-xl text-sm">{r.summary}<AuditChanges changes={r.changes} /></div> },
        ]}
      />
      <Pagination page={page} pageSize={50} total={total} searchParams={sp} basePath="/audit" />
    </div>
  );
}
