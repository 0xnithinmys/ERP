import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { createProduct } from "@/server/services/product.service";
import { createSupplier, createCustomer } from "@/server/services/party.service";
import { productCreateSchema, supplierSchema, customerSchema } from "@/validators/masters";
import { D } from "@/lib/decimal";

const TABLES = [
  "AuditLog",
  "InventoryTransaction",
  "StockAdjustmentItem",
  "StockAdjustment",
  "ProductionItem",
  "Production",
  "BillOfMaterialItem",
  "BillOfMaterial",
  "DispatchItem",
  "Dispatch",
  "CustomerReturnItem",
  "CustomerReturn",
  "SupplierReturnItem",
  "SupplierReturn",
  "SaleItem",
  "Sale",
  "PurchaseItem",
  "Purchase",
  "StockLevel",
  "ProductVariant",
  "Product",
  "Category",
  "Supplier",
  "Customer",
  "Session",
  "User",
  "Counter",
  "Setting",
];

export async function resetDb() {
  // Safety: only ever wipe the dedicated test database.
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!url.pathname.endsWith("_test")) throw new Error(`resetDb refused: ${url.pathname} is not a test database`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function makeActors() {
  const mk = async (username: string, role: "ADMIN" | "STORE" | "SALES"): Promise<Actor> => {
    const u = await prisma.user.create({
      data: { username, name: username.toUpperCase(), role, passwordHash: "$2b$10$abcdefghijklmnopqrstuuJ0d1x9Yqz5r9k3l2m1n0o9p8q7r6s5t" },
    });
    return { id: u.id, name: u.name, username: u.username, role };
  };
  return { admin: await mk("admin", "ADMIN"), store: await mk("store", "STORE"), sales: await mk("sales", "SALES") };
}

export const key = () => randomUUID();

export async function makeProduct(
  actor: Actor,
  opts: {
    name?: string;
    code?: string;
    type?: "FINISHED_GOOD" | "RAW_MATERIAL";
    unit?: string;
    variants?: { sku?: string; barcode?: string | null; size?: string | null; color?: string | null; price?: string; cost?: string; opening?: string; min?: string }[];
  } = {},
) {
  const code = opts.code ?? `P${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const variants = opts.variants ?? [{}];
  const input = productCreateSchema.parse({
    name: opts.name ?? "Cotton Socks",
    code,
    type: opts.type ?? "FINISHED_GOOD",
    unit: opts.unit ?? "PAIR",
    variants: variants.map((v, i) => ({
      sku: v.sku ?? `${code}-${i}`,
      barcode: v.barcode === undefined ? `${Math.floor(1e11 + Math.random() * 9e11)}` : v.barcode,
      size: v.size === undefined ? (variants.length > 1 ? `S${i}` : null) : v.size,
      color: v.color ?? null,
      purchasePrice: v.cost ?? "50",
      sellingPrice: v.price ?? "100",
      minStock: v.min ?? "5",
      reorderLevel: "0",
      openingStock: v.opening ?? "0",
    })),
  });
  const product = await createProduct(actor, input);
  const rows = await prisma.productVariant.findMany({ where: { productId: product.id }, orderBy: { sku: "asc" } });
  return { product, variants: rows };
}

export async function makeSupplier(actor: Actor, name = "Tiruppur Yarns") {
  return createSupplier(actor, supplierSchema.parse({ name, phone: "9876543210" }));
}

export async function makeCustomer(actor: Actor, name = "Ravi Kumar", phone = "9123456780") {
  return createCustomer(actor, customerSchema.parse({ name, phone, address: "12 Market Road" }));
}

export async function stockOf(variantId: string) {
  const s = await prisma.stockLevel.findUnique({ where: { variantId } });
  return { onHand: D(s?.onHand ?? 0).toString(), damaged: D(s?.damaged ?? 0).toString() };
}
