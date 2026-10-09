import type { Prisma } from "@prisma/client";
import { requiredMaterial, unitAllowsDecimal } from "@/lib/calculations";
import { D, Decimal, qtyStr } from "@/lib/decimal";
import { fullItemName } from "@/lib/format";
import type { BomInput, ProductionInput } from "@/validators/transactions";
import { prisma, transaction, type Tx } from "../db";
import { conflict, InsufficientStockError, notFound, validation } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { idempotent } from "../idempotency";
import { audit } from "./audit.service";
import { applyStockMovements, getStockMap } from "./inventory.service";
import { nextNumber } from "./settings.service";
import { loadDocumentVariants } from "./shared";

const bomInclude = {
  variant: { select: { id: true, sku: true, size: true, color: true, product: { select: { id: true, name: true, unit: true } } } },
  items: {
    orderBy: { id: "asc" },
    include: {
      material: {
        select: { id: true, sku: true, size: true, color: true, purchasePrice: true, product: { select: { name: true, unit: true } } },
      },
    },
  },
} satisfies Prisma.BillOfMaterialInclude;

export type BomDetail = Prisma.BillOfMaterialGetPayload<{ include: typeof bomInclude }>;

// ───────────── Bill of materials ─────────────

/** Creates or replaces the BOM of a finished variant (optionally all its sibling variants). */
export async function saveBom(actor: Actor, input: BomInput) {
  assertCan(actor, "manufacturing.manage_bom");
  return transaction(async (tx) => {
    const finished = await tx.productVariant.findUnique({ where: { id: input.variantId }, include: { product: true } });
    if (!finished) throw notFound("Finished product");
    if (finished.product.type !== "FINISHED_GOOD") throw validation("BOM output must be a finished good");

    await loadDocumentVariants(
      tx,
      input.items.map((i) => ({ variantId: i.materialId, quantity: "1" })),
      { type: "RAW_MATERIAL", context: "bill of materials" },
    );

    const targets = input.applyToAllVariants
      ? await tx.productVariant.findMany({ where: { productId: finished.productId, isActive: true }, select: { id: true } })
      : [{ id: finished.id }];

    const saved = [];
    for (const t of targets) {
      const existing = await tx.billOfMaterial.findUnique({ where: { variantId: t.id } });
      const bom = existing
        ? await tx.billOfMaterial.update({
            where: { id: existing.id },
            data: { outputQty: input.outputQty, notes: input.notes, isActive: true },
          })
        : await tx.billOfMaterial.create({ data: { variantId: t.id, outputQty: input.outputQty, notes: input.notes } });
      await tx.billOfMaterialItem.deleteMany({ where: { bomId: bom.id } });
      await tx.billOfMaterialItem.createMany({
        data: input.items.map((i) => ({ bomId: bom.id, materialId: i.materialId, quantity: qtyStr(i.quantity) })),
      });
      saved.push(bom);
    }
    await audit(tx, actor, {
      action: "bom.save",
      entity: "BillOfMaterial",
      entityId: saved[0].id,
      summary: `Saved bill of materials for ${fullItemName(finished.product.name, finished)}${targets.length > 1 ? ` and ${targets.length - 1} other variant(s)` : ""} — ${input.items.length} material(s) per ${qtyStr(input.outputQty)}`,
      changes: { items: input.items },
    });
    return saved[0];
  });
}

export async function listBoms(actor: Actor) {
  assertCan(actor, "manufacturing.view");
  return prisma.billOfMaterial.findMany({
    where: { isActive: true },
    include: bomInclude,
    orderBy: { variant: { product: { name: "asc" } } },
  });
}

export async function getBom(actor: Actor, id: string): Promise<BomDetail> {
  assertCan(actor, "manufacturing.view");
  const bom = await prisma.billOfMaterial.findUnique({ where: { id }, include: bomInclude });
  if (!bom) throw notFound("Bill of materials");
  return bom;
}

export async function deactivateBom(actor: Actor, id: string) {
  assertCan(actor, "manufacturing.manage_bom");
  const bom = await prisma.billOfMaterial.update({ where: { id }, data: { isActive: false }, include: bomInclude });
  await audit(prisma, actor, {
    action: "bom.deactivate",
    entity: "BillOfMaterial",
    entityId: id,
    summary: `Deactivated BOM for ${fullItemName(bom.variant.product.name, bom.variant)}`,
  });
  return bom;
}

// ───────────── Production ─────────────

export interface MaterialRequirement {
  materialId: string;
  name: string;
  unit: string;
  perOutput: string;
  required: string;
  available: string;
  shortBy: string;
  sufficient: boolean;
  wholeUnitsOk: boolean;
}

async function computeRequirements(db: Tx | typeof prisma, bom: BomDetail, quantity: string): Promise<MaterialRequirement[]> {
  const stock = await getStockMap(db, bom.items.map((i) => i.materialId));
  return bom.items.map((i) => {
    const required = requiredMaterial(i.quantity.toString(), bom.outputQty.toString(), quantity);
    const available = stock.get(i.materialId)!.onHand;
    const shortBy = Decimal.max(required.minus(available), 0);
    return {
      materialId: i.materialId,
      name: fullItemName(i.material.product.name, i.material),
      unit: i.material.product.unit,
      perOutput: qtyStr(i.quantity),
      required: qtyStr(required),
      available: qtyStr(available),
      shortBy: qtyStr(shortBy),
      sufficient: shortBy.isZero(),
      wholeUnitsOk: unitAllowsDecimal(i.material.product.unit) || required.isInteger(),
    };
  });
}

/** Read-only check used by the production screen before confirming. */
export async function previewProduction(actor: Actor, bomId: string, quantity: string) {
  assertCan(actor, "manufacturing.view");
  const bom = await getBom(actor, bomId);
  const requirements = await computeRequirements(prisma, bom, quantity);
  return {
    bom: { id: bom.id, name: fullItemName(bom.variant.product.name, bom.variant), outputQty: qtyStr(bom.outputQty), unit: bom.variant.product.unit },
    requirements,
    canProduce: requirements.every((r) => r.sufficient && r.wholeUnitsOk),
  };
}

/**
 * Production in ONE transaction: raw materials decrease (PRODUCTION_CONSUME) and
 * finished goods increase (PRODUCTION_OUTPUT). Insufficient material → nothing changes.
 */
export async function createProduction(actor: Actor, input: ProductionInput) {
  assertCan(actor, "manufacturing.produce");
  return idempotent(
    input.idempotencyKey,
    (key) => prisma.production.findUnique({ where: { idempotencyKey: key } }),
    () =>
      transaction(async (tx) => {
        const bom = await tx.billOfMaterial.findUnique({ where: { id: input.bomId }, include: bomInclude });
        if (!bom || !bom.isActive) throw notFound("Bill of materials");
        await loadDocumentVariants(tx, [{ variantId: bom.variantId, quantity: input.quantity }], {
          type: "FINISHED_GOOD",
          context: "production",
        });

        const requirements = await computeRequirements(tx, bom, input.quantity);
        const fractional = requirements.filter((r) => !r.wholeUnitsOk);
        if (fractional.length) {
          throw validation(
            `This quantity needs fractional units of ${fractional.map((r) => `${r.name} (${r.required} ${r.unit})`).join(", ")}. Adjust the production quantity.`,
          );
        }
        const short = requirements.filter((r) => !r.sufficient);
        if (short.length) {
          throw new InsufficientStockError(
            short.map((r) => ({ variantId: r.materialId, name: r.name, required: `${r.required} ${r.unit}`, available: `${r.available} ${r.unit}` })),
            "Cannot complete production",
          );
        }

        const number = await nextNumber(tx, "PRD");
        const production = await tx.production.create({
          data: {
            number,
            bomId: bom.id,
            variantId: bom.variantId,
            quantity: qtyStr(input.quantity),
            notes: input.notes,
            userId: actor.id,
            idempotencyKey: input.idempotencyKey ?? null,
            items: { create: requirements.map((r) => ({ materialId: r.materialId, quantity: r.required })) },
          },
        });

        const materialCost = bom.items.reduce(
          (acc, i) => acc.plus(D(i.material.purchasePrice).times(D(requirements.find((r) => r.materialId === i.materialId)!.required))),
          D(0),
        );
        // Re-checked under row locks: concurrent productions cannot both consume the same material.
        await applyStockMovements(
          tx,
          actor,
          [
            ...requirements.map((r) => ({
              variantId: r.materialId,
              quantity: D(r.required).neg(),
              type: "PRODUCTION_CONSUME" as const,
            })),
            {
              variantId: bom.variantId,
              quantity: input.quantity,
              type: "PRODUCTION_OUTPUT" as const,
              unitCost: materialCost.div(D(input.quantity)).toDecimalPlaces(2).toString(),
            },
          ],
          {
            refNumber: number,
            links: { productionId: production.id },
            allowNegative: false,
            shortagePrefix: "Cannot complete production",
          },
        );

        await audit(tx, actor, {
          action: "production.create",
          entity: "Production",
          entityId: production.id,
          summary: `Produced ${qtyStr(input.quantity)} × ${fullItemName(bom.variant.product.name, bom.variant)} (${number}) using ${requirements
            .map((r) => `${r.name} ${r.required} ${r.unit}`)
            .join(", ")}`,
        });
        return production;
      }),
  );
}

export async function cancelProduction(actor: Actor, productionId: string, reason: string) {
  assertCan(actor, "manufacturing.cancel");
  return transaction(async (tx) => {
    const p = await tx.production.findUnique({
      where: { id: productionId },
      include: { items: true, variant: { include: { product: true } } },
    });
    if (!p) throw notFound("Production");
    const claimed = await tx.production.updateMany({
      where: { id: productionId, status: "COMPLETED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    if (claimed.count === 0) throw conflict(`Production ${p.number} is already cancelled`);
    await applyStockMovements(
      tx,
      actor,
      [
        { variantId: p.variantId, quantity: D(p.quantity).neg(), type: "PRODUCTION_CANCEL" as const, note: reason },
        ...p.items.map((i) => ({ variantId: i.materialId, quantity: i.quantity.toString(), type: "PRODUCTION_CANCEL" as const, note: reason })),
      ],
      {
        refNumber: p.number,
        links: { productionId },
        allowNegative: false,
        shortagePrefix: "Cannot cancel — the produced goods have already been sold or used",
      },
    );
    await audit(tx, actor, {
      action: "production.cancel",
      entity: "Production",
      entityId: productionId,
      summary: `Cancelled production ${p.number} (${fullItemName(p.variant.product.name, p.variant)}): ${reason}`,
    });
    return tx.production.findUniqueOrThrow({ where: { id: productionId } });
  });
}

export async function listProductions(actor: Actor, f: { from?: Date; to?: Date; page: number; pageSize: number }) {
  assertCan(actor, "manufacturing.view");
  const where: Prisma.ProductionWhereInput = {
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.production.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        user: { select: { name: true } },
        variant: { select: { sku: true, size: true, color: true, product: { select: { name: true, unit: true } } } },
        items: { include: { material: { select: { size: true, color: true, product: { select: { name: true, unit: true } } } } } },
      },
    }),
    prisma.production.count({ where }),
  ]);
  return { rows, total };
}

export async function getProduction(actor: Actor, id: string) {
  assertCan(actor, "manufacturing.view");
  const p = await prisma.production.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      variant: { select: { sku: true, size: true, color: true, product: { select: { name: true, unit: true } } } },
      items: { include: { material: { select: { sku: true, size: true, color: true, product: { select: { name: true, unit: true } } } } } },
    },
  });
  if (!p) throw notFound("Production");
  return p;
}

