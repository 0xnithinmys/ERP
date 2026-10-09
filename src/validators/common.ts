import { z } from "zod";
import { MAX_PRICE, MAX_QUANTITY } from "@/lib/calculations";

// Money and quantities travel as strings to keep them exact end-to-end.

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,7}(\.\d{1,3})?$/;
const SIGNED_QTY_RE = /^-?\d{1,7}(\.\d{1,3})?$/;

const trimmed = () => z.string().trim();

export const zMoney = (label = "Amount") =>
  trimmed()
    .min(1, `${label} is required`)
    .regex(MONEY_RE, `${label} must be a valid amount (max 2 decimals)`)
    .refine((v) => Number(v) <= MAX_PRICE, `${label} is too large`);

export const zMoneyOptional = (label = "Amount") =>
  trimmed()
    .regex(MONEY_RE, `${label} must be a valid amount (max 2 decimals)`)
    .refine((v) => Number(v) <= MAX_PRICE, `${label} is too large`)
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === undefined || v === "" ? "0" : v));

export const zQty = (label = "Quantity") =>
  trimmed()
    .min(1, `${label} is required`)
    .regex(QTY_RE, `${label} must be a positive number (max 3 decimals)`)
    .refine((v) => Number(v) > 0, `${label} must be greater than zero`)
    .refine((v) => Number(v) <= MAX_QUANTITY, `${label} cannot exceed ${MAX_QUANTITY.toLocaleString("en-IN")}`);

/** Non-negative quantity (stock thresholds, opening stock). */
export const zQtyNonNeg = (label = "Quantity") =>
  trimmed()
    .regex(QTY_RE, `${label} must be zero or a positive number`)
    .refine((v) => Number(v) <= MAX_QUANTITY, `${label} is too large`)
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === undefined || v === "" ? "0" : v));

export const zSignedQty = (label = "Quantity") =>
  trimmed().regex(SIGNED_QTY_RE, `${label} must be a number`).refine((v) => Number(v) !== 0, `${label} cannot be zero`);

export const zPercent = (label = "Rate") =>
  trimmed()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, `${label} must be a percentage`)
    .refine((v) => Number(v) <= 100, `${label} cannot exceed 100%`)
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === undefined || v === "" ? "0" : v));

export const zId = z.string().trim().min(1, "Required").max(64);

export const zIdempotencyKey = z.string().trim().min(8).max(100).optional();

export const zOptionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const zPhone = z
  .string()
  .trim()
  .regex(/^[+]?[\d\s-]{6,20}$/, "Enter a valid phone number")
  .or(z.literal(""))
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/[\s-]/g, "") : null));

export const zEmail = z
  .string()
  .trim()
  .email("Enter a valid email")
  .or(z.literal(""))
  .optional()
  .nullable()
  .transform((v) => (v ? v.toLowerCase() : null));

/** Barcodes: printable characters typically produced by scanners (EAN/UPC/Code128). */
export const BARCODE_RE = /^[A-Za-z0-9\-_.]{3,64}$/;
export const zBarcode = z
  .string()
  .trim()
  .regex(BARCODE_RE, "Barcode must be 3–64 letters, digits, '-', '_' or '.'")
  .or(z.literal(""))
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const zSku = z
  .string()
  .trim()
  .min(2, "SKU is required")
  .max(64)
  .regex(/^[A-Za-z0-9\-_.\/]+$/, "SKU may contain letters, digits, '-', '_', '.', '/'")
  .transform((v) => v.toUpperCase());

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(200).catch(25),
});

export const PAYMENT_MODES = ["CASH", "UPI", "CARD", "BANK", "CREDIT"] as const;
export const zPaymentMode = z.enum(PAYMENT_MODES);
