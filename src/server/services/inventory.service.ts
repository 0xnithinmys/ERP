import { Prisma, type InventoryTxnType, type StockBucket } from "@prisma/client";
import { D, Decimal, qtyStr, type DecimalInput } from "@/lib/decimal";
import { stockStatus, type StockStatus } from "@/lib/calculations";
import { variantLabel } from "@/lib/format";
import { prisma, type Tx } from "../db";
import { InsufficientStockError, type ShortageDetail } from "../errors";
import type { Actor } from "../auth/actor";
import { assertCan } from "../auth/actor";
import { getSettings } from "./settings.service";

// ─────────────────────────────────────────────────────────────────────────────
// The single place where stock changes. Every movement:
//   1. atomically updates the StockLevel row with a conditional UPDATE
//      (row-level lock; rejects if the result would go negative), and
//   2. writes an InventoryTransaction ledger row carrying the new balance.
// Callers must pass the transaction client of their business transaction so the
// document, the ledger and the balances commit or roll back together.
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentLinks {
  purchaseId?: string;
  saleId?: string;
  customerReturnId?: string;
  supplierReturnId?: string;
  adjustmentId?: string;
  productionId?: string;
}

export interface StockMovement {
  variantId: string;
  quantity: DecimalInput; // signed: positive adds stock, negative removes
  bucket?: StockBucket;
  type: InventoryTxnType;
  unitCost?: DecimalInput;
  note?: string;
}

export interface AppliedMovement {
  variantId: string;
  bucket: StockBucket;
  quantity: Decimal;
  balanceAfter: Decimal;
}

export async function applyStockMovements(
  tx: Tx,
  actor: Actor,
  movements: StockMovement[],
  ctx: { refNumber: string; links: DocumentLinks; allowNegative?: boolean; shortagePrefix?: string },
): Promise<AppliedMovement[]> {
  if (movements.length === 0) return [];
  const allowNegativeSellable = ctx.allowNegative ?? (await getSettings(tx)).allowNegativeStock;

  // Make sure balance rows exist (no-op when they already do).
  const ids = [...new Set(movements.map((m) => m.variantId))];
  await tx.stockLevel.createMany({ data: ids.map((variantId) => ({ variantId })), skipDuplicates: true });

  // Lock rows in a deterministic order to avoid deadlocks between concurrent documents.
  const ordered = movements
    .map((m, i) => ({ ...m, i }))
    .sort((a, b) => (a.variantId === b.variantId ? a.i - b.i : a.variantId < b.variantId ? -1 : 1));

  const applied: (AppliedMovement & { i: number; type: InventoryTxnType; unitCost?: DecimalInput; note?: string })[] = [];
  const shortages: { variantId: string; bucket: StockBucket; required: Decimal }[] = [];

  for (const m of ordered) {
    const bucket = m.bucket ?? "SELLABLE";
    const quantity = D(m.quantity);
    if (quantity.isZero()) continue;
    const q = quantity.toString();
    const enforce = quantity.isNegative() && (bucket === "DAMAGED" || !allowNegativeSellable);

    const rows =
      bucket === "SELLABLE"
        ? enforce
          ? await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
              UPDATE "StockLevel" SET "onHand" = "onHand" + ${q}::numeric, "updatedAt" = now()
              WHERE "variantId" = ${m.variantId} AND "onHand" + ${q}::numeric >= 0
              RETURNING "onHand" AS balance`
          : await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
              UPDATE "StockLevel" SET "onHand" = "onHand" + ${q}::numeric, "updatedAt" = now()
              WHERE "variantId" = ${m.variantId}
              RETURNING "onHand" AS balance`
        : enforce
          ? await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
              UPDATE "StockLevel" SET "damaged" = "damaged" + ${q}::numeric, "updatedAt" = now()
              WHERE "variantId" = ${m.variantId} AND "damaged" + ${q}::numeric >= 0
              RETURNING "damaged" AS balance`
          : await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
              UPDATE "StockLevel" SET "damaged" = "damaged" + ${q}::numeric, "updatedAt" = now()
              WHERE "variantId" = ${m.variantId}
              RETURNING "damaged" AS balance`;

    if (rows.length === 0) {
      const existing = shortages.find((s) => s.variantId === m.variantId && s.bucket === bucket);
      if (existing) existing.required = existing.required.plus(quantity.abs());
      else shortages.push({ variantId: m.variantId, bucket, required: quantity.abs() });
      continue;
    }
    applied.push({
      i: m.i,
      variantId: m.variantId,
      bucket,
      quantity,
      balanceAfter: D(rows[0].balance.toString()),
      type: m.type,
      unitCost: m.unitCost,
      note: m.note,
    });
  }

  if (shortages.length > 0) {
    throw new InsufficientStockError(await describeShortages(tx, shortages), ctx.shortagePrefix);
  }

  await tx.inventoryTransaction.createMany({
    data: applied
      .sort((a, b) => a.i - b.i)
      .map((a) => ({
        variantId: a.variantId,
        type: a.type,
        bucket: a.bucket,
        quantity: a.quantity.toString(),
        balanceAfter: a.balanceAfter.toString(),
        unitCost: a.unitCost !== undefined && a.unitCost !== null ? D(a.unitCost).toString() : null,
        refNumber: ctx.refNumber,
        note: a.note ?? null,
        userId: actor.id,
        ...ctx.links,
      })),
  });

  return applied.map(({ variantId, bucket, quantity, balanceAfter }) => ({ variantId, bucket, quantity, balanceAfter }));
}

async function describeShortages(
  tx: Tx,
  shortages: { variantId: string; bucket: StockBucket; required: Decimal }[],
): Promise<ShortageDetail[]> {
  const variants = await tx.productVariant.findMany({
    where: { id: { in: shortages.map((s) => s.variantId) } },
    include: { product: { select: { name: true, unit: true } }, stock: true },
  });
  return shortages.map((s) => {
    const v = variants.find((x) => x.id === s.variantId);
    const available = s.bucket === "DAMAGED" ? v?.stock?.damaged : v?.stock?.onHand;
    const label = v ? `${v.product.name}${variantLabel(v) ? ` (${variantLabel(v)})` : ""}` : s.variantId;
    return {
      variantId: s.variantId,
      name: s.bucket === "DAMAGED" ? `${label} [damaged stock]` : label,
      required: qtyStr(s.required),
      available: qtyStr(available ?? 0),
      unit: v?.product.unit,
    };
  });
}

/** Read balances for a set of variants (0 when no row exists yet). */
export async function getStockMap(db: Tx | typeof prisma, variantIds: string[]) {
  const rows = await db.stockLevel.findMany({ where: { variantId: { in: variantIds } } });
  const map = new Map<string, { onHand: Decimal; damaged: Decimal }>();
  for (const id of variantIds) map.set(id, { onHand: new Decimal(0), damaged: new Decimal(0) });
  for (const r of rows) map.set(r.variantId, { onHand: D(r.onHand), damaged: D(r.damaged) });
  return map;
}

// ───────────── Inventory list / ledger queries ─────────────

export interface InventoryFilters {
  q?: string;
  categoryId?: string;
  size?: string;
  color?: string;
  supplierId?: string;
  status?: "low" | "out" | "in" | "damaged";
  type?: "FINISHED_GOOD" | "RAW_MATERIAL";
  page: number;
  pageSize: number;
}

export interface InventoryRow {
  variantId: string;
  productId: string;
  productName: string;
  productCode: string;
  type: string;
  unit: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  category: string | null;
  onHand: string;
  damaged: string;
  minStock: string;
  reorderLevel: string;
  purchasePrice: string;
  sellingPrice: string;
  status: StockStatus;
  isActive: boolean;
}

/**
 * Paginated inventory listing. Status filters are evaluated in SQL so
 * pagination stays correct on large catalogues.
 */
export async function listInventory(actor: Actor, f: InventoryFilters) {
  assertCan(actor, "inventory.view");
  const conditions: Prisma.Sql[] = [Prisma.sql`p."isActive" = true`, Prisma.sql`v."isActive" = true`];
  if (f.type) conditions.push(Prisma.sql`p."type" = ${f.type}::"ProductType"`);
  if (f.categoryId) conditions.push(Prisma.sql`(p."categoryId" = ${f.categoryId} OR p."subcategoryId" = ${f.categoryId})`);
  if (f.supplierId) conditions.push(Prisma.sql`p."supplierId" = ${f.supplierId}`);
  if (f.size) conditions.push(Prisma.sql`v."size" ILIKE ${f.size}`);
  if (f.color) conditions.push(Prisma.sql`v."color" ILIKE ${f.color}`);
  const threshold = Prisma.sql`GREATEST(v."minStock", v."reorderLevel")`;
  const onHand = Prisma.sql`COALESCE(s."onHand", 0)`;
  if (f.status === "out") conditions.push(Prisma.sql`${onHand} <= 0`);
  if (f.status === "low") conditions.push(Prisma.sql`${onHand} > 0 AND ${threshold} > 0 AND ${onHand} <= ${threshold}`);
  if (f.status === "in") conditions.push(Prisma.sql`${onHand} > 0 AND (${threshold} = 0 OR ${onHand} > ${threshold})`);
  if (f.status === "damaged") conditions.push(Prisma.sql`COALESCE(s."damaged", 0) > 0`);
  for (const token of searchTokens(f.q)) {
    if (isShortToken(token)) {
      // 1–2 characters ("M", "XL") are treated as an exact size/color, not a substring.
      conditions.push(Prisma.sql`(v."size" ILIKE ${escapeLike(token)} OR v."color" ILIKE ${escapeLike(token)} OR v."sku" ILIKE ${escapeLike(token)})`);
      continue;
    }
    const like = `%${escapeLike(token)}%`;
    conditions.push(Prisma.sql`(
      p."name" ILIKE ${like} OR p."code" ILIKE ${like} OR v."sku" ILIKE ${like}
      OR v."barcode" = ${token} OR v."size" ILIKE ${escapeLike(token)} OR v."color" ILIKE ${like} OR p."brand" ILIKE ${like}
    )`);
  }
  const where = Prisma.join(conditions, " AND ");
  const offset = (f.page - 1) * f.pageSize;

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<
      {
        variantId: string;
        productId: string;
        productName: string;
        productCode: string;
        type: string;
        unit: string;
        sku: string;
        barcode: string | null;
        size: string | null;
        color: string | null;
        category: string | null;
        onHand: Prisma.Decimal;
        damaged: Prisma.Decimal;
        minStock: Prisma.Decimal;
        reorderLevel: Prisma.Decimal;
        purchasePrice: Prisma.Decimal;
        sellingPrice: Prisma.Decimal;
        isActive: boolean;
      }[]
    >`
      SELECT v."id" AS "variantId", p."id" AS "productId", p."name" AS "productName", p."code" AS "productCode",
             p."type"::text AS "type", p."unit"::text AS "unit", v."sku", v."barcode", v."size", v."color",
             c."name" AS "category", ${onHand} AS "onHand", COALESCE(s."damaged", 0) AS "damaged",
             v."minStock", v."reorderLevel", v."purchasePrice", v."sellingPrice", v."isActive"
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      LEFT JOIN "StockLevel" s ON s."variantId" = v."id"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      WHERE ${where}
      ORDER BY p."name" ASC, v."size" ASC NULLS FIRST, v."color" ASC NULLS FIRST
      LIMIT ${f.pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      LEFT JOIN "StockLevel" s ON s."variantId" = v."id"
      WHERE ${where}`,
  ]);

  return {
    total: Number(count[0]?.count ?? 0),
    rows: rows.map<InventoryRow>((r) => ({
      ...r,
      onHand: qtyStr(r.onHand.toString()),
      damaged: qtyStr(r.damaged.toString()),
      minStock: qtyStr(r.minStock.toString()),
      reorderLevel: qtyStr(r.reorderLevel.toString()),
      purchasePrice: D(r.purchasePrice.toString()).toFixed(2),
      sellingPrice: D(r.sellingPrice.toString()).toFixed(2),
      status: stockStatus(r.onHand.toString(), r.minStock.toString(), r.reorderLevel.toString()),
    })),
  };
}

export async function getInventorySummary(actor: Actor) {
  assertCan(actor, "inventory.view");
  const [row] = await prisma.$queryRaw<
    { totalVariants: bigint; low: bigint; out: bigint; value: Prisma.Decimal | null; damagedUnits: Prisma.Decimal | null }[]
  >`
    SELECT COUNT(*)::bigint AS "totalVariants",
      COUNT(*) FILTER (WHERE COALESCE(s."onHand",0) > 0 AND GREATEST(v."minStock", v."reorderLevel") > 0
                        AND COALESCE(s."onHand",0) <= GREATEST(v."minStock", v."reorderLevel"))::bigint AS low,
      COUNT(*) FILTER (WHERE COALESCE(s."onHand",0) <= 0)::bigint AS out,
      SUM(GREATEST(COALESCE(s."onHand",0),0) * v."purchasePrice") AS value,
      SUM(COALESCE(s."damaged",0)) AS "damagedUnits"
    FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    LEFT JOIN "StockLevel" s ON s."variantId" = v."id"
    WHERE p."isActive" = true AND v."isActive" = true`;
  return {
    totalVariants: Number(row?.totalVariants ?? 0),
    lowStock: Number(row?.low ?? 0),
    outOfStock: Number(row?.out ?? 0),
    value: D(row?.value?.toString() ?? 0).toFixed(2),
    damagedUnits: qtyStr(row?.damagedUnits?.toString() ?? 0),
  };
}

export async function getVariantLedger(
  actor: Actor,
  variantId: string,
  opts: { page: number; pageSize: number; bucket?: StockBucket },
) {
  assertCan(actor, "inventory.view");
  const where: Prisma.InventoryTransactionWhereInput = { variantId, ...(opts.bucket ? { bucket: opts.bucket } : {}) };
  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { user: { select: { name: true } } },
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Integrity check: recomputes every balance from the ledger and reports any variant
 * whose cached balance differs. Should always return an empty list.
 */
export async function verifyLedgerIntegrity(db: Tx | typeof prisma = prisma) {
  return db.$queryRaw<{ variantId: string; bucket: string; cached: Prisma.Decimal; ledger: Prisma.Decimal }[]>`
    WITH l AS (
      SELECT "variantId", "bucket"::text AS bucket, SUM("quantity") AS total
      FROM "InventoryTransaction" GROUP BY "variantId", "bucket"
    ), c AS (
      SELECT "variantId", 'SELLABLE' AS bucket, "onHand" AS cached FROM "StockLevel"
      UNION ALL SELECT "variantId", 'DAMAGED', "damaged" FROM "StockLevel"
    )
    SELECT c."variantId", c.bucket, c.cached, COALESCE(l.total, 0) AS ledger
    FROM c LEFT JOIN l ON l."variantId" = c."variantId" AND l.bucket = c.bucket
    WHERE c.cached <> COALESCE(l.total, 0)`;
}

export function searchTokens(q?: string | null): string[] {
  if (!q) return [];
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => t.slice(0, 60));
}

export function isShortToken(t: string): boolean {
  return t.length <= 2;
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
