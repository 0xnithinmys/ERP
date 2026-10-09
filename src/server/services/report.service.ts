import { Prisma, type InventoryTxnType } from "@prisma/client";
import { D, qtyStr } from "@/lib/decimal";
import { dayKeys, resolveRange, type DateRange } from "@/lib/dates";
import { fullItemName } from "@/lib/format";
import { prisma } from "../db";
import { assertCan, can, type Actor } from "../auth/actor";
import { getInventorySummary } from "./inventory.service";
import { getSettings } from "./settings.service";

export async function rangeFromParams(params: { range?: string; from?: string; to?: string }): Promise<DateRange & { tz: string }> {
  const { timezone } = await getSettings();
  return { ...resolveRange(params.range, timezone, { from: params.from, to: params.to }), tz: timezone };
}

const n = (v: Prisma.Decimal | number | bigint | null | undefined) => D(v === null || v === undefined ? 0 : v.toString());

// ───────────── Dashboard ─────────────

export async function getDashboard(actor: Actor) {
  assertCan(actor, "dashboard.view");
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = resolveRange("today", tz);
  const last14 = resolveRange("custom", tz, { from: shiftKey(today.fromKey, -13), to: today.toKey });
  const showMoney = can(actor, "dashboard.financials");

  const [salesToday, purchasesToday, returnsToday, pendingDispatch, inventory, salesDaily, topProducts, recentSales, lowStock] =
    await Promise.all([
      prisma.sale.aggregate({
        where: { status: "CONFIRMED", createdAt: { gte: today.from, lt: today.to } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.purchase.aggregate({
        where: { status: "RECEIVED", receivedAt: { gte: today.from, lt: today.to } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.customerReturn.aggregate({
        where: { createdAt: { gte: today.from, lt: today.to } },
        _sum: { refundAmount: true },
        _count: { _all: true },
      }),
      prisma.dispatch.count({ where: { status: { in: ["PENDING", "PACKED"] } } }),
      getInventorySummary(actor),
      dailySeries("Sale", last14, tz),
      topSelling(last14, 5),
      prisma.sale.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, number: true, customerName: true, total: true, status: true, createdAt: true, paymentStatus: true },
      }),
      lowStockList(8),
    ]);

  return {
    showMoney,
    timezone: tz,
    currency: settings.currency,
    cards: {
      salesToday: { count: salesToday._count._all, value: n(salesToday._sum.total).toFixed(2) },
      purchasesToday: { count: purchasesToday._count._all, value: n(purchasesToday._sum.total).toFixed(2) },
      returnsToday: { count: returnsToday._count._all, value: n(returnsToday._sum.refundAmount).toFixed(2) },
      pendingDispatch,
      inventoryValue: inventory.value,
      lowStock: inventory.lowStock,
      outOfStock: inventory.outOfStock,
    },
    salesDaily,
    topProducts,
    recentSales: recentSales.map((s) => ({ ...s, total: s.total.toFixed(2) })),
    lowStock,
  };
}

function shiftKey(key: string, days: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function dailySeries(kind: "Sale" | "Purchase", range: DateRange, tz: string) {
  const rows =
    kind === "Sale"
      ? await prisma.$queryRaw<{ day: string; total: Prisma.Decimal; count: bigint }[]>`
          SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
                 SUM("total") AS total, COUNT(*)::bigint AS count
          FROM "Sale" WHERE "status" = 'CONFIRMED' AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
          GROUP BY 1 ORDER BY 1`
      : await prisma.$queryRaw<{ day: string; total: Prisma.Decimal; count: bigint }[]>`
          SELECT to_char(("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
                 SUM("total") AS total, COUNT(*)::bigint AS count
          FROM "Purchase" WHERE "status" = 'RECEIVED' AND "receivedAt" >= ${range.from} AND "receivedAt" < ${range.to}
          GROUP BY 1 ORDER BY 1`;
  const map = new Map(rows.map((r) => [r.day, r]));
  return dayKeys(range.fromKey, range.toKey).map((day) => ({
    day,
    total: Number(n(map.get(day)?.total).toFixed(2)),
    count: Number(map.get(day)?.count ?? 0),
  }));
}

async function topSelling(range: DateRange, limit: number) {
  const rows = await prisma.$queryRaw<{ variantId: string; name: string; label: string | null; qty: Prisma.Decimal; value: Prisma.Decimal }[]>`
    SELECT si."variantId", si."productName" AS name, si."variantLabel" AS label,
           SUM(si."quantity" - si."returnedQty") AS qty, SUM(si."netAmount" - si."refundedAmount") AS value
    FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
    WHERE s."status" = 'CONFIRMED' AND s."createdAt" >= ${range.from} AND s."createdAt" < ${range.to}
    GROUP BY si."variantId", si."productName", si."variantLabel"
    ORDER BY qty DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    variantId: r.variantId,
    name: r.label ? `${r.name} — ${r.label}` : r.name,
    qty: qtyStr(r.qty.toString()),
    value: n(r.value).toFixed(2),
  }));
}

async function lowStockList(limit: number) {
  const rows = await prisma.$queryRaw<
    { variantId: string; productId: string; name: string; size: string | null; color: string | null; onHand: Prisma.Decimal; threshold: Prisma.Decimal; unit: string }[]
  >`
    SELECT v."id" AS "variantId", p."id" AS "productId", p."name", v."size", v."color", COALESCE(s."onHand",0) AS "onHand",
           GREATEST(v."minStock", v."reorderLevel") AS threshold, p."unit"::text AS unit
    FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId"
    LEFT JOIN "StockLevel" s ON s."variantId" = v."id"
    WHERE p."isActive" AND v."isActive"
      AND (COALESCE(s."onHand",0) <= 0 OR (GREATEST(v."minStock", v."reorderLevel") > 0 AND COALESCE(s."onHand",0) <= GREATEST(v."minStock", v."reorderLevel")))
    ORDER BY COALESCE(s."onHand",0) ASC, p."name" ASC LIMIT ${limit}`;
  return rows.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    name: fullItemName(r.name, r),
    onHand: qtyStr(r.onHand.toString()),
    threshold: qtyStr(r.threshold.toString()),
    unit: r.unit,
  }));
}

// ───────────── Sales report ─────────────

export async function salesReport(actor: Actor, range: DateRange & { tz: string }) {
  assertCan(actor, "reports.view");
  const where = { status: "CONFIRMED" as const, createdAt: { gte: range.from, lt: range.to } };
  const [agg, items, returns, returnQty, byMode, daily, top, sales, cancelled] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { total: true, taxAmount: true, billDiscount: true, amountPaid: true }, _count: { _all: true } }),
    prisma.saleItem.aggregate({ where: { sale: where }, _sum: { quantity: true, discount: true } }),
    prisma.customerReturn.aggregate({ where: { createdAt: { gte: range.from, lt: range.to } }, _sum: { refundAmount: true }, _count: { _all: true } }),
    prisma.customerReturnItem.aggregate({ where: { return: { createdAt: { gte: range.from, lt: range.to } } }, _sum: { quantity: true } }),
    prisma.sale.groupBy({ by: ["paymentMode"], where, _sum: { total: true }, _count: { _all: true } }),
    dailySeries("Sale", range, range.tz),
    topSelling(range, 10),
    prisma.sale.findMany({
      where: { createdAt: { gte: range.from, lt: range.to } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        number: true,
        createdAt: true,
        customerName: true,
        status: true,
        total: true,
        amountPaid: true,
        paymentMode: true,
        paymentStatus: true,
        refundedAmount: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.sale.count({ where: { status: "CANCELLED", createdAt: { gte: range.from, lt: range.to } } }),
  ]);
  const value = n(agg._sum.total);
  const refunds = n(returns._sum.refundAmount);
  return {
    range,
    summary: {
      salesCount: agg._count._all,
      salesValue: value.toFixed(2),
      itemsSold: qtyStr(items._sum.quantity?.toString() ?? 0),
      discounts: n(items._sum.discount).plus(n(agg._sum.billDiscount)).toFixed(2),
      tax: n(agg._sum.taxAmount).toFixed(2),
      collected: n(agg._sum.amountPaid).toFixed(2),
      returnsCount: returns._count._all,
      returnsQty: qtyStr(returnQty._sum.quantity?.toString() ?? 0),
      returnsValue: refunds.toFixed(2),
      netSales: value.minus(refunds).toFixed(2),
      cancelled,
    },
    byMode: byMode.map((m) => ({ mode: m.paymentMode, count: m._count._all, total: n(m._sum.total).toFixed(2) })),
    daily,
    top,
    sales: sales.map((s) => ({ ...s, total: s.total.toFixed(2), amountPaid: s.amountPaid.toFixed(2), refundedAmount: s.refundedAmount.toFixed(2) })),
  };
}

// ───────────── Purchase report ─────────────

export async function purchaseReport(actor: Actor, range: DateRange & { tz: string }) {
  assertCan(actor, "reports.view");
  const where = { status: "RECEIVED" as const, receivedAt: { gte: range.from, lt: range.to } };
  const [agg, items, bySupplier, daily, purchases] = await Promise.all([
    prisma.purchase.aggregate({ where, _sum: { total: true, amountPaid: true, taxAmount: true }, _count: { _all: true } }),
    prisma.purchaseItem.aggregate({ where: { purchase: where }, _sum: { quantity: true } }),
    prisma.purchase.groupBy({ by: ["supplierId"], where, _sum: { total: true }, _count: { _all: true }, orderBy: { _sum: { total: "desc" } } }),
    dailySeries("Purchase", range, range.tz),
    prisma.purchase.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: 500,
      select: {
        id: true,
        number: true,
        invoiceNumber: true,
        receivedAt: true,
        total: true,
        amountPaid: true,
        paymentStatus: true,
        supplier: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: bySupplier.map((s) => s.supplierId) } }, select: { id: true, name: true } });
  return {
    range,
    summary: {
      purchaseCount: agg._count._all,
      purchaseValue: n(agg._sum.total).toFixed(2),
      itemsPurchased: qtyStr(items._sum.quantity?.toString() ?? 0),
      tax: n(agg._sum.taxAmount).toFixed(2),
      paid: n(agg._sum.amountPaid).toFixed(2),
      outstanding: n(agg._sum.total).minus(n(agg._sum.amountPaid)).toFixed(2),
    },
    bySupplier: bySupplier.map((s) => ({
      supplier: suppliers.find((x) => x.id === s.supplierId)?.name ?? "—",
      count: s._count._all,
      total: n(s._sum.total).toFixed(2),
    })),
    daily,
    purchases: purchases.map((p) => ({ ...p, total: p.total.toFixed(2), amountPaid: p.amountPaid.toFixed(2) })),
  };
}

// ───────────── Stock movement report ─────────────

export async function stockMovementReport(
  actor: Actor,
  range: DateRange & { tz: string },
  f: { type?: InventoryTxnType; variantId?: string; page: number; pageSize: number },
) {
  assertCan(actor, "reports.view");
  const where: Prisma.InventoryTransactionWhereInput = {
    createdAt: { gte: range.from, lt: range.to },
    ...(f.type ? { type: f.type } : {}),
    ...(f.variantId ? { variantId: f.variantId } : {}),
  };
  const [byType, rows, total] = await Promise.all([
    prisma.$queryRaw<{ type: string; bucket: string; qtyIn: Prisma.Decimal; qtyOut: Prisma.Decimal; count: bigint }[]>`
      SELECT "type"::text AS type, "bucket"::text AS bucket,
             SUM(CASE WHEN "quantity" > 0 THEN "quantity" ELSE 0 END) AS "qtyIn",
             SUM(CASE WHEN "quantity" < 0 THEN -"quantity" ELSE 0 END) AS "qtyOut",
             COUNT(*)::bigint AS count
      FROM "InventoryTransaction" WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
      GROUP BY 1, 2 ORDER BY 1, 2`,
    prisma.inventoryTransaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        user: { select: { name: true } },
        variant: { select: { sku: true, size: true, color: true, product: { select: { id: true, name: true, unit: true } } } },
      },
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);
  return {
    range,
    byType: byType.map((t) => ({ type: t.type, bucket: t.bucket, qtyIn: qtyStr(t.qtyIn.toString()), qtyOut: qtyStr(t.qtyOut.toString()), count: Number(t.count) })),
    rows,
    total,
  };
}

// ───────────── Production report ─────────────

export async function productionReport(actor: Actor, range: DateRange & { tz: string }) {
  assertCan(actor, "reports.view");
  const [produced, consumed, list] = await Promise.all([
    prisma.$queryRaw<{ variantId: string; name: string; size: string | null; color: string | null; unit: string; qty: Prisma.Decimal; runs: bigint }[]>`
      SELECT pr."variantId", p."name", v."size", v."color", p."unit"::text AS unit, SUM(pr."quantity") AS qty, COUNT(*)::bigint AS runs
      FROM "Production" pr JOIN "ProductVariant" v ON v."id" = pr."variantId" JOIN "Product" p ON p."id" = v."productId"
      WHERE pr."status" = 'COMPLETED' AND pr."createdAt" >= ${range.from} AND pr."createdAt" < ${range.to}
      GROUP BY 1,2,3,4,5 ORDER BY qty DESC`,
    prisma.$queryRaw<{ materialId: string; name: string; size: string | null; color: string | null; unit: string; qty: Prisma.Decimal; cost: Prisma.Decimal }[]>`
      SELECT pi."materialId", p."name", v."size", v."color", p."unit"::text AS unit, SUM(pi."quantity") AS qty,
             SUM(pi."quantity" * v."purchasePrice") AS cost
      FROM "ProductionItem" pi JOIN "Production" pr ON pr."id" = pi."productionId"
      JOIN "ProductVariant" v ON v."id" = pi."materialId" JOIN "Product" p ON p."id" = v."productId"
      WHERE pr."status" = 'COMPLETED' AND pr."createdAt" >= ${range.from} AND pr."createdAt" < ${range.to}
      GROUP BY 1,2,3,4,5 ORDER BY p."name"`,
    prisma.production.findMany({
      where: { createdAt: { gte: range.from, lt: range.to } },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { user: { select: { name: true } }, variant: { select: { size: true, color: true, product: { select: { name: true, unit: true } } } } },
    }),
  ]);
  return {
    range,
    summary: {
      runs: list.filter((p) => p.status === "COMPLETED").length,
      totalProduced: qtyStr(produced.reduce((a, r) => a.plus(n(r.qty)), D(0))),
      materialCost: consumed.reduce((a, r) => a.plus(n(r.cost)), D(0)).toFixed(2),
    },
    produced: produced.map((r) => ({ name: fullItemName(r.name, r), unit: r.unit, qty: qtyStr(r.qty.toString()), runs: Number(r.runs) })),
    consumed: consumed.map((r) => ({ name: fullItemName(r.name, r), unit: r.unit, qty: qtyStr(r.qty.toString()), cost: n(r.cost).toFixed(2) })),
    list,
  };
}
