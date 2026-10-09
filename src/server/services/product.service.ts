import { Prisma, type ProductType } from "@prisma/client";
import { D, qtyStr } from "@/lib/decimal";
import { stockStatus, validateQuantityForUnit } from "@/lib/calculations";
import { fullItemName, variantLabel } from "@/lib/format";
import { generateInStoreEan13, normalizeScan } from "@/lib/barcode";
import type {
  ProductCreateInput,
  ProductUpdateInput,
  VariantUpdateInput,
} from "@/validators/masters";
import { prisma, transaction, type Tx } from "../db";
import { AppError, conflict, notFound, validation } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { audit, diff } from "./audit.service";
import { applyStockMovements, isShortToken, searchTokens } from "./inventory.service";
import { nextNumber } from "./settings.service";
import { z } from "zod";
import { variantCreateSchema } from "@/validators/masters";

type VariantCreate = z.output<typeof variantCreateSchema>;

// ───────────── Uniqueness checks with friendly messages ─────────────

async function assertUniqueCodes(
  db: Tx | typeof prisma,
  args: { code?: string; skus?: string[]; barcodes?: string[]; excludeProductId?: string; excludeVariantId?: string },
) {
  if (args.code) {
    const p = await db.product.findFirst({
      where: { code: { equals: args.code, mode: "insensitive" }, ...(args.excludeProductId ? { NOT: { id: args.excludeProductId } } : {}) },
      select: { name: true },
    });
    if (p) throw conflict(`Product code ${args.code} is already used by "${p.name}"`);
  }
  if (args.skus?.length) {
    const v = await db.productVariant.findFirst({
      where: {
        OR: args.skus.map((s) => ({ sku: { equals: s, mode: "insensitive" as const } })),
        ...(args.excludeVariantId ? { NOT: { id: args.excludeVariantId } } : {}),
      },
      select: { sku: true, product: { select: { name: true } } },
    });
    if (v) throw conflict(`SKU ${v.sku} is already used by "${v.product.name}"`);
  }
  const barcodes = (args.barcodes ?? []).filter(Boolean);
  if (barcodes.length) {
    const v = await db.productVariant.findFirst({
      where: { barcode: { in: barcodes }, ...(args.excludeVariantId ? { NOT: { id: args.excludeVariantId } } : {}) },
      select: { barcode: true, size: true, color: true, product: { select: { name: true } } },
    });
    if (v) throw conflict(`Barcode ${v.barcode} is already assigned to "${fullItemName(v.product.name, v)}"`);
  }
}

function checkVariantQuantities(unit: string, v: { openingStock?: string; minStock: string; reorderLevel: string }) {
  for (const [label, value] of [
    ["Opening stock", v.openingStock],
    ["Minimum stock", v.minStock],
    ["Reorder level", v.reorderLevel],
  ] as const) {
    if (value && D(value).gt(0)) {
      const err = validateQuantityForUnit(value, unit);
      if (err) throw validation(`${label}: ${err}`);
    }
  }
}

async function assertCategory(db: Tx, categoryId: string | null, subcategoryId: string | null) {
  if (categoryId) {
    const c = await db.category.findUnique({ where: { id: categoryId } });
    if (!c) throw notFound("Category");
  }
  if (subcategoryId) {
    const s = await db.category.findUnique({ where: { id: subcategoryId } });
    if (!s) throw notFound("Subcategory");
    if (categoryId && s.parentId !== categoryId) throw validation("Subcategory does not belong to the selected category");
  }
}

// ───────────── Products ─────────────

export async function createProduct(actor: Actor, input: ProductCreateInput) {
  assertCan(actor, "products.manage");
  for (const v of input.variants) checkVariantQuantities(input.unit, v);

  return transaction(async (tx) => {
    await assertUniqueCodes(tx, {
      code: input.code,
      skus: input.variants.map((v) => v.sku),
      barcodes: input.variants.map((v) => v.barcode ?? "").filter(Boolean),
    });
    await assertCategory(tx, input.categoryId, input.subcategoryId);
    if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId } }))) throw notFound("Supplier");

    const { variants, ...productData } = input;
    const product = await tx.product.create({ data: productData });
    const created = [];
    for (const v of variants) {
      created.push(await createVariantRow(tx, product.id, v));
    }
    await postOpeningStock(tx, actor, created, variants);

    await audit(tx, actor, {
      action: "product.create",
      entity: "Product",
      entityId: product.id,
      summary: `Created product ${product.name} (${product.code}) with ${variants.length} variant(s)`,
    });
    return product;
  });
}

async function createVariantRow(tx: Tx, productId: string, v: VariantCreate) {
  const variant = await tx.productVariant.create({
    data: {
      productId,
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      color: v.color,
      purchasePrice: v.purchasePrice,
      sellingPrice: v.sellingPrice,
      minStock: v.minStock,
      reorderLevel: v.reorderLevel,
      isActive: v.isActive ?? true,
    },
  });
  await tx.stockLevel.create({ data: { variantId: variant.id } });
  return variant;
}

async function postOpeningStock(
  tx: Tx,
  actor: Actor,
  variants: { id: string; purchasePrice: Prisma.Decimal }[],
  inputs: { openingStock?: string }[],
) {
  const movements = variants
    .map((v, i) => ({ v, opening: D(inputs[i].openingStock ?? 0) }))
    .filter((x) => x.opening.gt(0))
    .map((x) => ({ variantId: x.v.id, quantity: x.opening, type: "OPENING" as const, unitCost: x.v.purchasePrice.toString() }));
  if (movements.length === 0) return;
  const refNumber = await nextNumber(tx, "OPN");
  await applyStockMovements(tx, actor, movements, { refNumber, links: {} });
}

export async function updateProduct(actor: Actor, id: string, input: ProductUpdateInput) {
  assertCan(actor, "products.manage");
  return transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id }, include: { _count: { select: { variants: true } } } });
    if (!before) throw notFound("Product");
    await assertUniqueCodes(tx, { code: input.code, excludeProductId: id });
    await assertCategory(tx, input.categoryId, input.subcategoryId);
    if (before.unit !== input.unit) {
      const used = await tx.inventoryTransaction.count({ where: { variant: { productId: id } } });
      if (used > 0) throw AppErrorUnitLocked();
    }
    if (before.type !== input.type) {
      const used = await tx.inventoryTransaction.count({ where: { variant: { productId: id } } });
      if (used > 0) throw validation("Product type cannot be changed after stock transactions exist");
    }
    const updated = await tx.product.update({ where: { id }, data: input });
    const changes = diff(before as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>);
    if (Object.keys(changes).length) {
      await audit(tx, actor, {
        action: input.isActive === false && before.isActive ? "product.deactivate" : "product.update",
        entity: "Product",
        entityId: id,
        summary: `Updated product ${updated.name}`,
        changes,
      });
    }
    return updated;
  });
}

function AppErrorUnitLocked() {
  return validation("Unit cannot be changed after stock transactions exist (it would change the meaning of existing quantities)");
}

export async function addVariant(actor: Actor, productId: string, input: VariantCreate) {
  assertCan(actor, "products.manage");
  return transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound("Product");
    checkVariantQuantities(product.unit, input);
    await assertUniqueCodes(tx, { skus: [input.sku], barcodes: input.barcode ? [input.barcode] : [] });
    const dup = await tx.productVariant.findFirst({
      where: {
        productId,
        size: input.size ? { equals: input.size, mode: "insensitive" } : null,
        color: input.color ? { equals: input.color, mode: "insensitive" } : null,
      },
    });
    if (dup) throw conflict("A variant with this size and color already exists");
    const variant = await createVariantRow(tx, productId, input);
    await postOpeningStock(tx, actor, [variant], [input]);
    await audit(tx, actor, {
      action: "variant.create",
      entity: "ProductVariant",
      entityId: variant.id,
      summary: `Added variant ${fullItemName(product.name, variant)} (${variant.sku})`,
    });
    return variant;
  });
}

export async function updateVariant(actor: Actor, variantId: string, input: VariantUpdateInput) {
  assertCan(actor, "products.manage");
  return transaction(async (tx) => {
    const before = await tx.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
    if (!before) throw notFound("Variant");
    checkVariantQuantities(before.product.unit, input);
    await assertUniqueCodes(tx, {
      skus: [input.sku],
      barcodes: input.barcode ? [input.barcode] : [],
      excludeVariantId: variantId,
    });
    const { id: _ignore, ...data } = input;
    void _ignore;
    const updated = await tx.productVariant.update({ where: { id: variantId }, data });
    const changes = diff(
      {
        sku: before.sku,
        barcode: before.barcode,
        size: before.size,
        color: before.color,
        purchasePrice: before.purchasePrice.toFixed(2),
        sellingPrice: before.sellingPrice.toFixed(2),
        minStock: qtyStr(before.minStock),
        reorderLevel: qtyStr(before.reorderLevel),
        isActive: before.isActive,
      },
      {
        sku: data.sku,
        barcode: data.barcode,
        size: data.size,
        color: data.color,
        purchasePrice: D(data.purchasePrice).toFixed(2),
        sellingPrice: D(data.sellingPrice).toFixed(2),
        minStock: qtyStr(data.minStock),
        reorderLevel: qtyStr(data.reorderLevel),
        isActive: data.isActive,
      },
    );
    if (Object.keys(changes).length) {
      const name = fullItemName(before.product.name, updated);
      const priceChanged = "sellingPrice" in changes;
      await audit(tx, actor, {
        action: priceChanged ? "variant.price_change" : "variant.update",
        entity: "ProductVariant",
        entityId: variantId,
        summary: priceChanged
          ? `Changed selling price of ${name} from ${changes.sellingPrice.from} to ${changes.sellingPrice.to}`
          : `Updated variant ${name}`,
        changes,
      });
    }
    return updated;
  });
}

/** Assigns a barcode to an existing variant ("Register barcode" from an unknown scan). */
export async function assignBarcode(actor: Actor, variantId: string, rawBarcode: string) {
  assertCan(actor, "products.manage");
  const barcode = normalizeScan(rawBarcode);
  if (!/^[A-Za-z0-9\-_.]{3,64}$/.test(barcode)) throw validation("Invalid barcode");
  return transaction(async (tx) => {
    const v = await tx.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
    if (!v) throw notFound("Variant");
    await assertUniqueCodes(tx, { barcodes: [barcode], excludeVariantId: variantId });
    const updated = await tx.productVariant.update({ where: { id: variantId }, data: { barcode } });
    await audit(tx, actor, {
      action: "variant.barcode",
      entity: "ProductVariant",
      entityId: variantId,
      summary: `Registered barcode ${barcode} for ${fullItemName(v.product.name, v)}`,
      changes: { barcode: { from: v.barcode, to: barcode } },
    });
    return updated;
  });
}

export async function generateUniqueBarcode(db: Tx | typeof prisma = prisma): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInStoreEan13();
    const exists = await db.productVariant.findUnique({ where: { barcode: code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new AppError("INTERNAL", "Could not generate a unique barcode, please try again");
}

export async function listProducts(
  actor: Actor,
  f: { q?: string; type?: ProductType; categoryId?: string; status?: "active" | "inactive" | "all"; page: number; pageSize: number },
) {
  assertCan(actor, "products.view");
  const tokens = searchTokens(f.q);
  const where: Prisma.ProductWhereInput = {
    ...(f.type ? { type: f.type } : {}),
    ...(f.categoryId ? { OR: [{ categoryId: f.categoryId }, { subcategoryId: f.categoryId }] } : {}),
    ...(f.status === "inactive" ? { isActive: false } : f.status === "all" ? {} : { isActive: true }),
    AND: tokens.map((t) => ({
      OR: [
        { name: { contains: t, mode: "insensitive" as const } },
        { code: { contains: t, mode: "insensitive" as const } },
        { brand: { contains: t, mode: "insensitive" as const } },
        { variants: { some: { OR: [{ sku: { contains: t, mode: "insensitive" as const } }, { barcode: t }] } } },
      ],
    })),
  };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        category: { select: { name: true } },
        variants: { select: { id: true, sellingPrice: true, isActive: true, stock: { select: { onHand: true } } } },
      },
    }),
    prisma.product.count({ where }),
  ]);
  return {
    total,
    rows: rows.map((p) => {
      const prices = p.variants.map((v) => D(v.sellingPrice));
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        type: p.type,
        unit: p.unit,
        brand: p.brand,
        imageUrl: p.imageUrl,
        isActive: p.isActive,
        category: p.category?.name ?? null,
        variantCount: p.variants.length,
        totalStock: qtyStr(p.variants.reduce((acc, v) => acc.plus(D(v.stock?.onHand)), D(0))),
        minPrice: prices.length ? prices.reduce((a, b) => (a.lt(b) ? a : b)).toFixed(2) : "0.00",
        maxPrice: prices.length ? prices.reduce((a, b) => (a.gt(b) ? a : b)).toFixed(2) : "0.00",
      };
    }),
  };
}

export async function getProduct(actor: Actor, id: string) {
  assertCan(actor, "products.view");
  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      subcategory: true,
      supplier: { select: { id: true, name: true } },
      variants: { orderBy: [{ size: "asc" }, { color: "asc" }], include: { stock: true, bom: { select: { id: true } } } },
    },
  });
  if (!p) throw notFound("Product");
  return p;
}

// ───────────── Lookup & search (POS / scanning) ─────────────

export interface VariantHit {
  variantId: string;
  productId: string;
  name: string;
  productName: string;
  label: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  unit: string;
  type: string;
  sellingPrice: string;
  purchasePrice: string;
  onHand: string;
  damaged: string;
  status: ReturnType<typeof stockStatus>;
  isActive: boolean;
  imageUrl: string | null;
}

const hitInclude = {
  product: { select: { id: true, name: true, unit: true, type: true, isActive: true, imageUrl: true } },
  stock: { select: { onHand: true, damaged: true } },
} satisfies Prisma.ProductVariantInclude;

type HitSource = Prisma.ProductVariantGetPayload<{ include: typeof hitInclude }>;

function toHit(v: HitSource): VariantHit {
  return {
    variantId: v.id,
    productId: v.product.id,
    name: fullItemName(v.product.name, v),
    productName: v.product.name,
    label: variantLabel(v),
    sku: v.sku,
    barcode: v.barcode,
    size: v.size,
    color: v.color,
    unit: v.product.unit,
    type: v.product.type,
    sellingPrice: v.sellingPrice.toFixed(2),
    purchasePrice: v.purchasePrice.toFixed(2),
    onHand: qtyStr(v.stock?.onHand ?? 0),
    damaged: qtyStr(v.stock?.damaged ?? 0),
    status: stockStatus(v.stock?.onHand ?? 0, v.minStock, v.reorderLevel),
    isActive: v.isActive && v.product.isActive,
    imageUrl: v.product.imageUrl,
  };
}

/** Exact lookup for scanners: indexed barcode match first, then case-insensitive SKU. */
export async function lookupCode(actor: Actor, raw: string): Promise<VariantHit | null> {
  assertCan(actor, "products.view");
  const code = normalizeScan(raw);
  if (!code || code.length > 64) return null;
  const byBarcode = await prisma.productVariant.findUnique({ where: { barcode: code }, include: hitInclude });
  if (byBarcode) return toHit(byBarcode);
  const bySku = await prisma.productVariant.findFirst({
    where: { sku: { equals: code, mode: "insensitive" } },
    include: hitInclude,
  });
  return bySku ? toHit(bySku) : null;
}

export async function getVariantHits(actor: Actor, ids: string[]): Promise<VariantHit[]> {
  assertCan(actor, "products.view");
  const rows = await prisma.productVariant.findMany({ where: { id: { in: ids } }, include: hitInclude });
  return rows.map(toHit);
}

/**
 * Token search: every word must match name, code, SKU, size, color or brand
 * ("cotton black m" works). Predictable ordering: exact SKU/barcode first, then name.
 */
export async function searchVariants(
  actor: Actor,
  q: string,
  opts: { type?: ProductType; limit?: number; includeInactive?: boolean } = {},
): Promise<VariantHit[]> {
  assertCan(actor, "products.view");
  const tokens = searchTokens(q);
  const limit = Math.min(opts.limit ?? 20, 50);
  const where: Prisma.ProductVariantWhereInput = {
    ...(opts.includeInactive ? {} : { isActive: true, product: { isActive: true } }),
    ...(opts.type ? { product: { type: opts.type, ...(opts.includeInactive ? {} : { isActive: true }) } } : {}),
    AND: tokens.map((t) => ({
      OR: isShortToken(t)
        ? [
            { size: { equals: t, mode: "insensitive" as const } },
            { color: { equals: t, mode: "insensitive" as const } },
            { sku: { equals: t, mode: "insensitive" as const } },
          ]
        : [
        { product: { name: { contains: t, mode: "insensitive" as const } } },
        { product: { code: { contains: t, mode: "insensitive" as const } } },
        { product: { brand: { contains: t, mode: "insensitive" as const } } },
        { sku: { contains: t, mode: "insensitive" as const } },
        { barcode: t },
        { size: { equals: t, mode: "insensitive" as const } },
        { color: { contains: t, mode: "insensitive" as const } },
      ],
    })),
  };
  const rows = await prisma.productVariant.findMany({
    where,
    include: hitInclude,
    orderBy: [{ product: { name: "asc" } }, { size: "asc" }, { color: "asc" }],
    take: limit,
  });
  const hits = rows.map(toHit);
  const exact = q.trim().toLowerCase();
  return hits.sort((a, b) => {
    const ae = a.sku.toLowerCase() === exact || a.barcode === q.trim() ? 0 : 1;
    const be = b.sku.toLowerCase() === exact || b.barcode === q.trim() ? 0 : 1;
    return ae - be;
  });
}

// ───────────── Categories ─────────────

export async function listCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ parentId: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true },
  });
}

export async function createCategory(actor: Actor, input: { name: string; parentId: string | null }) {
  assertCan(actor, "products.manage");
  return transaction(async (tx) => {
    if (input.parentId) {
      const parent = await tx.category.findUnique({ where: { id: input.parentId } });
      if (!parent) throw notFound("Parent category");
      if (parent.parentId) throw validation("Subcategories cannot be nested further");
    }
    const dup = await tx.category.findFirst({
      where: { parentId: input.parentId, name: { equals: input.name, mode: "insensitive" } },
    });
    if (dup) throw conflict(`Category "${input.name}" already exists`);
    const c = await tx.category.create({ data: input });
    await audit(tx, actor, { action: "category.create", entity: "Category", entityId: c.id, summary: `Created category ${c.name}` });
    return c;
  });
}

export async function nextProductCode(): Promise<string> {
  const count = await prisma.product.count();
  for (let n = count + 1; n < count + 1000; n++) {
    const code = `P${String(n).padStart(4, "0")}`;
    const exists = await prisma.product.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
  }
  return `P${Date.now().toString().slice(-8)}`;
}

