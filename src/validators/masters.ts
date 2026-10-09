import { z } from "zod";
import { UNITS } from "@/lib/calculations";
import {
  zBarcode,
  zEmail,
  zId,
  zMoney,
  zOptionalText,
  zPercent,
  zPhone,
  zQtyNonNeg,
  zSku,
} from "./common";
import { ROLES } from "@/lib/permissions";

// ───────────── Products ─────────────

export const variantInputSchema = z.object({
  id: z.string().optional(),
  sku: zSku,
  barcode: zBarcode,
  size: zOptionalText(30),
  color: zOptionalText(40),
  purchasePrice: zMoney("Purchase price"),
  sellingPrice: zMoney("Selling price"),
  minStock: zQtyNonNeg("Minimum stock"),
  reorderLevel: zQtyNonNeg("Reorder level"),
  openingStock: zQtyNonNeg("Opening stock"),
  isActive: z.boolean().optional().default(true),
});
export type VariantInput = z.input<typeof variantInputSchema>;

const productBase = {
  name: z.string().trim().min(2, "Product name is required").max(120),
  code: z
    .string()
    .trim()
    .min(2, "Product code is required")
    .max(40)
    .regex(/^[A-Za-z0-9\-_.]+$/, "Code may contain letters, digits, '-', '_', '.'")
    .transform((v) => v.toUpperCase()),
  type: z.enum(["FINISHED_GOOD", "RAW_MATERIAL"]),
  categoryId: z.string().trim().optional().nullable().transform((v) => v || null),
  subcategoryId: z.string().trim().optional().nullable().transform((v) => v || null),
  supplierId: z.string().trim().optional().nullable().transform((v) => v || null),
  brand: zOptionalText(60),
  unit: z.enum(UNITS),
  description: zOptionalText(2000),
  imageUrl: zOptionalText(500),
  isActive: z.boolean().optional().default(true),
};

export const productCreateSchema = z
  .object({ ...productBase, variants: z.array(variantInputSchema).min(1, "Add at least one variant").max(200) })
  .superRefine((p, ctx) => {
    const skus = new Set<string>();
    const barcodes = new Set<string>();
    const combos = new Set<string>();
    p.variants.forEach((v, i) => {
      if (skus.has(v.sku)) ctx.addIssue({ code: "custom", path: ["variants", i, "sku"], message: `Duplicate SKU ${v.sku}` });
      skus.add(v.sku);
      if (v.barcode) {
        if (barcodes.has(v.barcode))
          ctx.addIssue({ code: "custom", path: ["variants", i, "barcode"], message: `Duplicate barcode ${v.barcode}` });
        barcodes.add(v.barcode);
      }
      const combo = `${(v.size ?? "").toLowerCase()}|${(v.color ?? "").toLowerCase()}`;
      if (combos.has(combo))
        ctx.addIssue({ code: "custom", path: ["variants", i, "size"], message: "Two variants have the same size and color" });
      combos.add(combo);
    });
  });
export type ProductCreateInput = z.output<typeof productCreateSchema>;

export const productUpdateSchema = z.object(productBase);
export type ProductUpdateInput = z.output<typeof productUpdateSchema>;

export const variantUpdateSchema = variantInputSchema.omit({ openingStock: true });
export type VariantUpdateInput = z.output<typeof variantUpdateSchema>;

export const variantCreateSchema = variantInputSchema;

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required").max(60),
  parentId: z.string().trim().optional().nullable().transform((v) => v || null),
});

// ───────────── Suppliers / customers ─────────────

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Supplier name is required").max(120),
  phone: zPhone,
  email: zEmail,
  address: zOptionalText(500),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 letters/digits")
    .or(z.literal(""))
    .optional()
    .nullable()
    .transform((v) => v || null),
  notes: zOptionalText(1000),
  isActive: z.boolean().optional().default(true),
});
export type SupplierInput = z.output<typeof supplierSchema>;

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Customer name is required").max(120),
  phone: zPhone,
  email: zEmail,
  address: zOptionalText(500),
  notes: zOptionalText(1000),
  isActive: z.boolean().optional().default(true),
});
export type CustomerInput = z.output<typeof customerSchema>;

// ───────────── Users ─────────────

export const passwordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .max(100, "Password is too long");

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Username must be at least 3 characters")
    .max(40)
    .regex(/^[a-z0-9._-]+$/, "Username may contain lowercase letters, digits, '.', '_', '-'"),
  email: zEmail,
  role: z.enum(ROLES),
  password: passwordSchema,
});
export type UserCreateInput = z.output<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  email: zEmail,
  role: z.enum(ROLES),
  isActive: z.boolean(),
  password: passwordSchema.or(z.literal("")).optional(),
});
export type UserUpdateInput = z.output<typeof userUpdateSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(40),
  password: z.string().min(1, "Password is required").max(100),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

export { zId, zPercent };
