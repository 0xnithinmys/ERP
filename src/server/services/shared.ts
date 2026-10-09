import type { ProductType } from "@prisma/client";
import { validateQuantityForUnit } from "@/lib/calculations";
import { fullItemName } from "@/lib/format";
import type { Tx } from "../db";
import { businessRule, notFound, validation } from "../errors";

/**
 * Loads the variants referenced by a document and validates them:
 * they must exist, be active (unless allowInactive), match the expected
 * product type, and each quantity must suit the product's unit.
 */
export async function loadDocumentVariants(
  tx: Tx,
  lines: { variantId: string; quantity: string }[],
  opts: { type?: ProductType; allowInactive?: boolean; context: string },
) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const variants = await tx.productVariant.findMany({
    where: { id: { in: ids } },
    include: { product: { select: { id: true, name: true, unit: true, type: true, isActive: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  for (const line of lines) {
    const v = byId.get(line.variantId);
    if (!v) throw notFound("Product");
    const name = fullItemName(v.product.name, v);
    if (!opts.allowInactive && (!v.isActive || !v.product.isActive)) {
      throw businessRule(`${name} is inactive and cannot be used in a ${opts.context}`);
    }
    if (opts.type && v.product.type !== opts.type) {
      throw businessRule(
        `${name} is a ${v.product.type === "RAW_MATERIAL" ? "raw material" : "finished good"} and cannot be used here`,
      );
    }
    const err = validateQuantityForUnit(line.quantity, v.product.unit);
    if (err) throw validation(`${name}: ${err}`);
  }
  return byId;
}

export type DocumentVariant = Awaited<ReturnType<typeof loadDocumentVariants>> extends Map<string, infer V> ? V : never;
