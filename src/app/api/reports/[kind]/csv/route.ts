import { NextResponse } from "next/server";
import { route } from "@/server/api/handler";
import { notFound } from "@/server/errors";
import { prisma } from "@/server/db";
import { listInventory } from "@/server/services/inventory.service";
import { productionReport, purchaseReport, rangeFromParams, salesReport } from "@/server/services/report.service";
import { toCsv } from "@/lib/csv";
import { formatDateTime, fullItemName, TXN_TYPE_LABELS } from "@/lib/format";
import { D } from "@/lib/decimal";

export const GET = route<{ kind: string }>({ permission: "reports.view" }, async ({ actor, params, req }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const range = await rangeFromParams(sp);
  const tz = range.tz;
  let csv: string;
  switch (params.kind) {
    case "sales": {
      const r = await salesReport(actor, range);
      csv = toCsv(
        ["Invoice", "Date", "Customer", "Status", "Payment mode", "Payment status", "Lines", "Total", "Paid", "Refunded"],
        r.sales.map((s) => [s.number, formatDateTime(s.createdAt, tz), s.customerName, s.status, s.paymentMode, s.paymentStatus, s._count.items, s.total, s.amountPaid, s.refundedAmount]),
      );
      break;
    }
    case "purchases": {
      const r = await purchaseReport(actor, range);
      csv = toCsv(
        ["Purchase", "Received", "Supplier", "Supplier invoice", "Lines", "Total", "Paid", "Payment status"],
        r.purchases.map((p) => [p.number, p.receivedAt ? formatDateTime(p.receivedAt, tz) : "", p.supplier.name, p.invoiceNumber, p._count.items, p.total, p.amountPaid, p.paymentStatus]),
      );
      break;
    }
    case "inventory": {
      const { rows } = await listInventory(actor, { page: 1, pageSize: 100000, status: sp.status as "low" | "out" | undefined });
      csv = toCsv(
        ["Product", "Code", "Type", "Size", "Colour", "SKU", "Barcode", "Unit", "Sellable", "Damaged", "Min stock", "Reorder level", "Cost", "Price", "Stock value", "Status"],
        rows.map((r) => [r.productName, r.productCode, r.type, r.size, r.color, r.sku, r.barcode, r.unit, r.onHand, r.damaged, r.minStock, r.reorderLevel, r.purchasePrice, r.sellingPrice, D(r.onHand).gt(0) ? D(r.onHand).times(D(r.purchasePrice)).toFixed(2) : "0.00", r.status]),
      );
      break;
    }
    case "stock-movement": {
      const rows = await prisma.inventoryTransaction.findMany({
        where: { createdAt: { gte: range.from, lt: range.to }, ...(sp.type ? { type: sp.type as never } : {}) },
        orderBy: { createdAt: "asc" },
        take: 50000,
        include: { user: { select: { name: true } }, variant: { select: { sku: true, size: true, color: true, product: { select: { name: true } } } } },
      });
      csv = toCsv(
        ["Date", "Type", "Reference", "Product", "SKU", "Stock", "Qty in", "Qty out", "Balance", "User", "Note"],
        rows.map((t) => [
          formatDateTime(t.createdAt, tz),
          TXN_TYPE_LABELS[t.type] ?? t.type,
          t.refNumber,
          fullItemName(t.variant.product.name, t.variant),
          t.variant.sku,
          t.bucket,
          D(t.quantity).gt(0) ? t.quantity.toString() : "",
          D(t.quantity).lt(0) ? D(t.quantity).abs().toString() : "",
          t.balanceAfter.toString(),
          t.user.name,
          t.note,
        ]),
      );
      break;
    }
    case "production": {
      const r = await productionReport(actor, range);
      csv = toCsv(
        ["Run", "Date", "Product", "Quantity", "Unit", "Status", "By"],
        r.list.map((p) => [p.number, formatDateTime(p.createdAt, tz), fullItemName(p.variant.product.name, p.variant), p.quantity.toString(), p.variant.product.unit, p.status, p.user.name]),
      );
      break;
    }
    default:
      throw notFound("Report");
  }
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${params.kind}-${range.fromKey}_to_${range.toKey}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
