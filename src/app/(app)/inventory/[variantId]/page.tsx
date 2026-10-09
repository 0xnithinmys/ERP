import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getVariantLedger } from "@/server/services/inventory.service";
import { getSettings } from "@/server/services/settings.service";
import { prisma } from "@/server/db";
import { can } from "@/server/auth/actor";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Pagination } from "@/components/shared/pagination";
import { SimpleTable } from "@/components/shared/simple-table";
import { EmptyState } from "@/components/shared/states";
import { FilterSelect, Toolbar } from "@/components/shared/url-filters";
import { Button } from "@/components/ui/button";
import { D } from "@/lib/decimal";
import { stockStatus } from "@/lib/calculations";
import { formatDateTime, formatMoney, formatQty, fullItemName, TXN_TYPE_LABELS } from "@/lib/format";
import { int, oneOf, type SP } from "@/lib/search-params";

export const metadata = { title: "Stock ledger" };

function refHref(t: { saleId: string | null; purchaseId: string | null; customerReturnId: string | null; productionId: string | null; supplierReturnId: string | null }) {
  if (t.saleId) return `/sales/${t.saleId}`;
  if (t.purchaseId) return `/purchases/${t.purchaseId}`;
  if (t.customerReturnId) return `/returns/${t.customerReturnId}`;
  if (t.productionId) return `/manufacturing/${t.productionId}`;
  return null;
}

export default async function VariantLedgerPage({ params, searchParams }: { params: Promise<{ variantId: string }>; searchParams: Promise<SP> }) {
  const actor = await requirePagePermission("inventory.view");
  const { variantId } = await params;
  const sp = await searchParams;
  const page = int(sp, "page", 1);
  const bucket = oneOf(sp, "bucket", ["SELLABLE", "DAMAGED"] as const);
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: true, stock: true } });
  if (!variant) notFound();
  const [{ rows, total }, settings] = await Promise.all([getVariantLedger(actor, variantId, { page, pageSize: 50, bucket }), getSettings()]);
  const name = fullItemName(variant.product.name, variant);
  const unit = variant.product.unit.toLowerCase();

  return (
    <div>
      <PageHeader
        title={name}
        description={`SKU ${variant.sku}${variant.barcode ? ` · Barcode ${variant.barcode}` : ""}`}
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: name }]}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/products/${variant.productId}`}>View product</Link>
            </Button>
            {can(actor, "inventory.adjust") && (
              <Button asChild>
                <Link href={`/inventory/adjust?variant=${variant.id}`}>
                  <SlidersHorizontal /> Adjust
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sellable stock" value={`${formatQty(variant.stock?.onHand ?? 0)} ${unit}`} />
        <StatCard label="Damaged stock" value={`${formatQty(variant.stock?.damaged ?? 0)} ${unit}`} tone={D(variant.stock?.damaged ?? 0).gt(0) ? "danger" : "default"} />
        <StatCard label="Minimum / reorder" value={`${formatQty(variant.minStock)} / ${formatQty(variant.reorderLevel)}`} />
        <StatCard label="Status" value={<StatusBadge status={stockStatus(variant.stock?.onHand ?? 0, variant.minStock, variant.reorderLevel)} className="text-sm" />} sub={`Price ${formatMoney(variant.sellingPrice)}`} />
      </div>
      <Toolbar>
        <FilterSelect param="bucket" placeholder="Stock type" allLabel="Sellable + damaged" options={[{ value: "SELLABLE", label: "Sellable only" }, { value: "DAMAGED", label: "Damaged only" }]} />
      </Toolbar>
      <SimpleTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No stock movements yet" description="Purchases, sales, returns and adjustments for this item will appear here." />}
        columns={[
          { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, settings.timezone)}</span> },
          { key: "type", header: "Transaction", cell: (r) => <span>{TXN_TYPE_LABELS[r.type] ?? r.type}{r.bucket === "DAMAGED" && <StatusBadge status="DAMAGED" className="ml-2" />}</span> },
          {
            key: "ref",
            header: "Reference",
            cell: (r) => {
              const href = refHref(r);
              return href ? <Link href={href} className="font-mono text-xs text-primary hover:underline">{r.refNumber}</Link> : <span className="font-mono text-xs">{r.refNumber}</span>;
            },
          },
          { key: "in", header: "In", align: "right", cell: (r) => (D(r.quantity).gt(0) ? <span className="text-emerald-700">+{formatQty(r.quantity)}</span> : "") },
          { key: "out", header: "Out", align: "right", cell: (r) => (D(r.quantity).lt(0) ? <span className="text-red-700">−{formatQty(D(r.quantity).abs())}</span> : "") },
          { key: "bal", header: "Balance", align: "right", cell: (r) => <span className="font-medium">{formatQty(r.balanceAfter)}</span> },
          { key: "user", header: "User", cell: (r) => r.user.name },
          { key: "note", header: "Note", cell: (r) => <span className="text-xs text-muted-foreground">{r.note ?? ""}</span> },
        ]}
      />
      <Pagination page={page} pageSize={50} total={total} searchParams={sp} basePath={`/inventory/${variantId}`} />
    </div>
  );
}
