import Link from "@/components/shared/app-link";
import { Factory, Plus, ScrollText } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listBoms, listProductions } from "@/server/services/production.service";
import { listInventory } from "@/server/services/inventory.service";
import { getSettings } from "@/server/services/settings.service";
import { can } from "@/server/auth/actor";
import { PageHeader } from "@/components/shared/page-header";
import { SimpleTable } from "@/components/shared/simple-table";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateTime, formatMoney, formatQty, fullItemName } from "@/lib/format";
import { int, oneOf, PAGE_SIZE, type SP } from "@/lib/search-params";

export const metadata = { title: "Manufacturing" };

export default async function ManufacturingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("manufacturing.view");
  const sp = await searchParams;
  const tab = oneOf(sp, "tab", ["production", "boms", "materials"] as const) ?? "production";
  const page = int(sp, "page", 1);
  const settings = await getSettings();

  const tabs = [
    { id: "production", label: "Production runs" },
    { id: "boms", label: "Bills of materials" },
    { id: "materials", label: "Raw materials stock" },
  ];

  return (
    <div>
      <PageHeader
        title="Manufacturing"
        description="Simple production: a bill of materials per finished item, raw materials consumed and finished goods produced in one step."
        actions={
          <>
            {can(actor, "manufacturing.manage_bom") && (
              <Button asChild variant="outline">
                <Link href="/manufacturing/boms/new">
                  <ScrollText /> New BOM
                </Link>
              </Button>
            )}
            {can(actor, "products.manage") && (
              <Button asChild variant="outline">
                <Link href="/products/new?type=RAW_MATERIAL">
                  <Plus /> Add raw material
                </Link>
              </Button>
            )}
            {can(actor, "manufacturing.produce") && (
              <Button asChild>
                <Link href="/manufacturing/new">
                  <Factory /> Start production
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {tabs.map((t) => (
          <Link key={t.id} href={`/manufacturing?tab=${t.id}`} role="tab" aria-selected={tab === t.id} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "production" && <ProductionTab actor={actor} page={page} sp={sp} tz={settings.timezone} />}
      {tab === "boms" && <BomTab actor={actor} />}
      {tab === "materials" && <MaterialsTab actor={actor} page={page} sp={sp} />}
    </div>
  );
}

type Actor = Awaited<ReturnType<typeof requirePagePermission>>;

async function ProductionTab({ actor, page, sp, tz }: { actor: Actor; page: number; sp: SP; tz: string }) {
  const { rows, total } = await listProductions(actor, { page, pageSize: PAGE_SIZE });
  return (
    <>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={Factory} title="No production yet" description="Create a bill of materials, then start a production run." action={can(actor, "manufacturing.produce") ? { label: "Start production", href: "/manufacturing/new" } : undefined} />}
        columns={[
          { key: "no", header: "Run", cell: (r) => <Link href={`/manufacturing/${r.id}`} className="font-mono text-sm font-medium text-primary hover:underline">{r.number}</Link> },
          { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, tz)}</span> },
          { key: "item", header: "Finished goods", cell: (r) => fullItemName(r.variant.product.name, r.variant) },
          { key: "qty", header: "Produced", align: "right", cell: (r) => `${formatQty(r.quantity)} ${r.variant.product.unit.toLowerCase()}` },
          { key: "mat", header: "Materials used", cell: (r) => <span className="text-xs text-muted-foreground">{r.items.map((i) => `${i.material.product.name} ${formatQty(i.quantity)} ${i.material.product.unit.toLowerCase()}`).join(", ")}</span> },
          { key: "by", header: "By", cell: (r) => r.user.name },
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/manufacturing" />
    </>
  );
}

async function BomTab({ actor }: { actor: Actor }) {
  const boms = await listBoms(actor);
  return (
    <SimpleTable
      rows={boms}
      rowKey={(r) => r.id}
      empty={<EmptyState icon={ScrollText} title="No bills of materials" description="A BOM lists the raw materials needed to make one unit (or batch) of a finished item." action={can(actor, "manufacturing.manage_bom") ? { label: "Create BOM", href: "/manufacturing/boms/new" } : undefined} />}
      columns={[
        { key: "item", header: "Finished item", cell: (r) => <span className="font-medium">{fullItemName(r.variant.product.name, r.variant)}</span> },
        { key: "out", header: "Per", align: "right", cell: (r) => `${formatQty(r.outputQty)} ${r.variant.product.unit.toLowerCase()}` },
        { key: "items", header: "Materials", cell: (r) => <span className="text-xs">{r.items.map((i) => `${fullItemName(i.material.product.name, i.material)} ${formatQty(i.quantity)} ${i.material.product.unit.toLowerCase()}`).join(" · ")}</span> },
        { key: "cost", header: "Material cost", align: "right", cell: (r) => formatMoney(r.items.reduce((a, i) => a + Number(i.quantity) * Number(i.material.purchasePrice), 0) / Number(r.outputQty)) + " /unit" },
        {
          key: "act",
          header: "",
          cell: (r) => (
            <div className="flex justify-end gap-1">
              {can(actor, "manufacturing.manage_bom") && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/manufacturing/boms/new?variant=${r.variantId}`}>Edit</Link>
                </Button>
              )}
              {can(actor, "manufacturing.produce") && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/manufacturing/new?bom=${r.id}`}>Produce</Link>
                </Button>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}

async function MaterialsTab({ actor, page, sp }: { actor: Actor; page: number; sp: SP }) {
  const { rows, total } = await listInventory(actor, { type: "RAW_MATERIAL", page, pageSize: PAGE_SIZE });
  return (
    <>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.variantId}
        empty={<EmptyState title="No raw materials" description="Add yarn, elastic, labels and packaging as raw-material products." action={{ label: "Add raw material", href: "/products/new?type=RAW_MATERIAL" }} />}
        columns={[
          { key: "name", header: "Material", cell: (r) => <Link href={`/inventory/${r.variantId}`} className="font-medium text-primary hover:underline">{fullItemName(r.productName, r)}</Link> },
          { key: "sku", header: "SKU", cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
          { key: "qty", header: "In stock", align: "right", cell: (r) => <span className="font-semibold">{formatQty(r.onHand)} {r.unit.toLowerCase()}</span> },
          { key: "min", header: "Min", align: "right", cell: (r) => formatQty(r.minStock) },
          { key: "cost", header: "Cost / unit", align: "right", cell: (r) => formatMoney(r.purchasePrice) },
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} searchParams={sp} basePath="/manufacturing" />
    </>
  );
}
