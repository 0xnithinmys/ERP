import type { Prisma } from "@prisma/client";
import { D, qtyStr } from "@/lib/decimal";
import { ADJUSTMENT_REASON_LABELS, fullItemName } from "@/lib/format";
import type { AdjustmentInput } from "@/validators/transactions";
import { prisma, transaction } from "../db";
import { validation } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { idempotent } from "../idempotency";
import { audit } from "./audit.service";
import { applyStockMovements, type StockMovement } from "./inventory.service";
import { nextNumber } from "./settings.service";
import { loadDocumentVariants } from "./shared";

/**
 * Controlled stock adjustments. A reason and note are mandatory and every change
 * is recorded with the user and time. Adjustments can never push stock negative.
 *
 *   DAMAGE            sellable −q, damaged +q
 *   DAMAGE_WRITE_OFF  damaged −q
 *   LOST              sellable −q
 *   FOUND             sellable +q
 *   CORRECTION/OTHER  sellable ±q (direction per line)
 */
export function movementsForAdjustment(
  reason: AdjustmentInput["reason"],
  item: { variantId: string; quantity: string; direction: "IN" | "OUT" },
): StockMovement[] {
  const q = D(item.quantity);
  const base = { variantId: item.variantId, type: "ADJUSTMENT" as const };
  switch (reason) {
    case "DAMAGE":
      return [
        { ...base, quantity: q.neg(), bucket: "SELLABLE" },
        { ...base, quantity: q, bucket: "DAMAGED" },
      ];
    case "DAMAGE_WRITE_OFF":
      return [{ ...base, quantity: q.neg(), bucket: "DAMAGED" }];
    case "LOST":
      return [{ ...base, quantity: q.neg(), bucket: "SELLABLE" }];
    case "FOUND":
      return [{ ...base, quantity: q, bucket: "SELLABLE" }];
    default:
      return [{ ...base, quantity: item.direction === "IN" ? q : q.neg(), bucket: "SELLABLE" }];
  }
}

export async function createAdjustment(actor: Actor, input: AdjustmentInput) {
  assertCan(actor, "inventory.adjust");
  return idempotent(
    input.idempotencyKey,
    (key) => prisma.stockAdjustment.findUnique({ where: { idempotencyKey: key } }),
    () =>
      transaction(async (tx) => {
        const ids = input.items.map((i) => i.variantId);
        if (new Set(ids).size !== ids.length) throw validation("Each product can appear only once per adjustment");
        const variants = await loadDocumentVariants(tx, input.items, { context: "adjustment", allowInactive: true });
        const number = await nextNumber(tx, "ADJ");
        const adjustment = await tx.stockAdjustment.create({
          data: { number, reason: input.reason, note: input.note, userId: actor.id, idempotencyKey: input.idempotencyKey ?? null },
        });
        const movements = input.items.flatMap((it) =>
          movementsForAdjustment(input.reason, it).map((m) => ({ ...m, note: `${ADJUSTMENT_REASON_LABELS[input.reason]}: ${input.note}` })),
        );
        const applied = await applyStockMovements(tx, actor, movements, {
          refNumber: number,
          links: { adjustmentId: adjustment.id },
          allowNegative: false,
          shortagePrefix: "Adjustment would make stock negative",
        });
        await tx.stockAdjustmentItem.createMany({
          data: applied.map<Prisma.StockAdjustmentItemCreateManyInput>((a) => ({
            adjustmentId: adjustment.id,
            variantId: a.variantId,
            bucket: a.bucket,
            quantity: a.quantity.toString(),
            balanceAfter: a.balanceAfter.toString(),
          })),
        });
        await audit(tx, actor, {
          action: "stock.adjust",
          entity: "StockAdjustment",
          entityId: adjustment.id,
          summary: `Adjusted stock (${ADJUSTMENT_REASON_LABELS[input.reason]}) ${number}: ${input.items
            .map((i) => {
              const v = variants.get(i.variantId)!;
              const sign = movementsForAdjustment(input.reason, i)[0].quantity;
              return `${fullItemName(v.product.name, v)} ${D(sign).isNegative() ? "−" : "+"}${qtyStr(i.quantity)}`;
            })
            .join(", ")} — ${input.note}`,
        });
        return adjustment;
      }),
  );
}

export async function listAdjustments(actor: Actor, f: { page: number; pageSize: number }) {
  assertCan(actor, "inventory.view");
  const [rows, total] = await Promise.all([
    prisma.stockAdjustment.findMany({
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        user: { select: { name: true } },
        items: { include: { variant: { select: { sku: true, size: true, color: true, product: { select: { name: true } } } } } },
      },
    }),
    prisma.stockAdjustment.count(),
  ]);
  return { rows, total };
}
