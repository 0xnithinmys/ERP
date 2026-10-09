import { z } from "zod";
import {
  zId,
  zIdempotencyKey,
  zMoney,
  zMoneyOptional,
  zOptionalText,
  zPaymentMode,
  zPercent,
  zQty,
} from "./common";

// ───────────── Purchase ─────────────

export const purchaseItemSchema = z.object({
  variantId: zId,
  quantity: zQty(),
  rate: zMoney("Rate"),
  discount: zMoneyOptional("Discount"),
  taxRate: zPercent("Tax rate"),
});

export const purchaseCreateSchema = z.object({
  supplierId: zId,
  invoiceNumber: zOptionalText(60),
  purchaseDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid date"),
  items: z.array(purchaseItemSchema).min(1, "Add at least one product").max(500),
  discount: zMoneyOptional("Discount"),
  amountPaid: zMoneyOptional("Amount paid"),
  notes: zOptionalText(1000),
  receiveNow: z.boolean().default(true),
  idempotencyKey: zIdempotencyKey,
});
export type PurchaseCreateInput = z.output<typeof purchaseCreateSchema>;

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Please enter a reason").max(300),
});

export const supplierReturnSchema = z.object({
  purchaseId: zId,
  reason: z.string().trim().min(3, "Please enter a reason").max(300),
  items: z
    .array(
      z.object({
        purchaseItemId: zId,
        quantity: zQty(),
        bucket: z.enum(["SELLABLE", "DAMAGED"]).default("SELLABLE"),
      }),
    )
    .min(1, "Select at least one item"),
  idempotencyKey: zIdempotencyKey,
});
export type SupplierReturnInput = z.output<typeof supplierReturnSchema>;

// ───────────── Sale ─────────────

export const saleItemSchema = z.object({
  variantId: zId,
  quantity: zQty(),
  unitPrice: zMoney("Price").optional(),
  discount: zMoneyOptional("Discount"),
});

export const saleCreateSchema = z.object({
  customerId: z.string().trim().optional().nullable().transform((v) => v || null),
  items: z.array(saleItemSchema).min(1, "Cart is empty — scan or add a product first").max(300),
  billDiscount: zMoneyOptional("Bill discount"),
  paymentMode: zPaymentMode,
  /** Empty = paid in full (CASH/UPI/CARD/BANK) or nothing paid yet (CREDIT). */
  amountReceived: zMoney("Amount received").or(z.literal("")).optional().nullable().transform((v) => (v ? v : null)),
  requiresDispatch: z.boolean().default(false),
  dispatchAddress: zOptionalText(500),
  notes: zOptionalText(500),
  idempotencyKey: zIdempotencyKey,
});
export type SaleCreateInput = z.output<typeof saleCreateSchema>;

export const salePaymentSchema = z.object({
  amount: zMoney("Amount"),
  paymentMode: zPaymentMode,
});

// ───────────── Customer return ─────────────

export const RETURN_REASONS = [
  "Size issue",
  "Color mismatch",
  "Defective / torn",
  "Wrong item",
  "Customer changed mind",
  "Other",
] as const;

export const customerReturnSchema = z.object({
  saleId: zId,
  items: z
    .array(
      z.object({
        saleItemId: zId,
        quantity: zQty("Return quantity"),
        condition: z.enum(["GOOD", "DAMAGED"]),
        reason: z.string().trim().min(2, "Select a reason").max(200),
      }),
    )
    .min(1, "Select at least one item to return"),
  refundMode: zPaymentMode,
  notes: zOptionalText(500),
  idempotencyKey: zIdempotencyKey,
});
export type CustomerReturnInput = z.output<typeof customerReturnSchema>;

// ───────────── Stock adjustment ─────────────

export const ADJUSTMENT_REASONS = ["DAMAGE", "DAMAGE_WRITE_OFF", "LOST", "FOUND", "CORRECTION", "OTHER"] as const;

export const adjustmentSchema = z.object({
  reason: z.enum(ADJUSTMENT_REASONS),
  note: z.string().trim().min(3, "Please describe the reason").max(500),
  items: z
    .array(
      z.object({
        variantId: zId,
        quantity: zQty(),
        direction: z.enum(["IN", "OUT"]).default("OUT"),
      }),
    )
    .min(1, "Add at least one product")
    .max(200),
  idempotencyKey: zIdempotencyKey,
});
export type AdjustmentInput = z.output<typeof adjustmentSchema>;

// ───────────── Manufacturing ─────────────

export const bomSchema = z.object({
  variantId: zId,
  outputQty: zQty("Output quantity"),
  notes: zOptionalText(500),
  items: z
    .array(z.object({ materialId: zId, quantity: zQty("Material quantity") }))
    .min(1, "Add at least one raw material")
    .max(50)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((it, i) => {
        if (seen.has(it.materialId))
          ctx.addIssue({ code: "custom", path: [i, "materialId"], message: "Material added twice" });
        seen.add(it.materialId);
      });
    }),
  applyToAllVariants: z.boolean().optional().default(false),
});
export type BomInput = z.output<typeof bomSchema>;

export const productionSchema = z.object({
  bomId: zId,
  quantity: zQty("Production quantity"),
  notes: zOptionalText(500),
  idempotencyKey: zIdempotencyKey,
});
export type ProductionInput = z.output<typeof productionSchema>;

// ───────────── Dispatch ─────────────

export const dispatchCreateSchema = z.object({
  saleId: zId,
  address: zOptionalText(500),
  notes: zOptionalText(500),
});

export const dispatchPackSchema = z.object({
  items: z.array(z.object({ dispatchItemId: zId, scannedQty: z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/) })).min(1),
});

export const dispatchShipSchema = z.object({
  carrier: zOptionalText(80),
  trackingNumber: zOptionalText(80),
});
