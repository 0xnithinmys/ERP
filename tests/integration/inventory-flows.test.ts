import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { purchaseCreateSchema, saleCreateSchema, customerReturnSchema, adjustmentSchema, supplierReturnSchema } from "@/validators/transactions";
import { createPurchase, receivePurchase, cancelPurchase, createSupplierReturn } from "@/server/services/purchase.service";
import { createSale, cancelSale, recordSalePayment } from "@/server/services/sale.service";
import { createCustomerReturn } from "@/server/services/return.service";
import { createAdjustment } from "@/server/services/adjustment.service";
import { verifyLedgerIntegrity, listInventory } from "@/server/services/inventory.service";
import { lookupCode, searchVariants, updateVariant, createProduct } from "@/server/services/product.service";
import { productCreateSchema, variantUpdateSchema } from "@/validators/masters";
import { AppError } from "@/server/errors";
import { key, makeActors, makeCustomer, makeProduct, makeSupplier, resetDb, stockOf } from "../helpers";

let A: { admin: Actor; store: Actor; sales: Actor };

beforeEach(async () => {
  await resetDb();
  A = await makeActors();
});

async function expectAppError(p: Promise<unknown>, code: string, msg?: RegExp) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, "expected an error").toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (msg) expect((err as AppError).message).toMatch(msg);
  return err as AppError;
}

const purchase = (supplierId: string, items: { variantId: string; quantity: string; rate: string }[], extra: Record<string, unknown> = {}) =>
  purchaseCreateSchema.parse({ supplierId, purchaseDate: "2026-10-09", items, receiveNow: true, idempotencyKey: key(), ...extra });

const sale = (items: { variantId: string; quantity: string; discount?: string }[], extra: Record<string, unknown> = {}) =>
  saleCreateSchema.parse({ items, paymentMode: "CASH", amountReceived: "100000", idempotencyKey: key(), ...extra });

describe("products & barcode", () => {
  it("opening stock creates a ledger entry and barcode lookup finds the variant", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ barcode: "8901000000017", opening: "100", size: "M", color: "Black" }] });
    expect(await stockOf(variants[0].id)).toEqual({ onHand: "100", damaged: "0" });
    const hit = await lookupCode(A.sales, " 8901000000017\n");
    expect(hit?.variantId).toBe(variants[0].id);
    expect(hit?.onHand).toBe("100");
    expect(await lookupCode(A.sales, "0000000000000")).toBeNull();
    const bySku = await lookupCode(A.sales, variants[0].sku.toLowerCase());
    expect(bySku?.variantId).toBe(variants[0].id);
    const txns = await prisma.inventoryTransaction.findMany({ where: { variantId: variants[0].id } });
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("OPENING");
  });

  it("rejects duplicate barcode and SKU with friendly messages", async () => {
    await makeProduct(A.admin, { code: "CS1", variants: [{ sku: "CS1-M", barcode: "111222333" }] });
    await expectAppError(makeProduct(A.admin, { code: "CS2", variants: [{ sku: "CS2-M", barcode: "111222333" }] }), "CONFLICT", /Barcode 111222333 is already assigned/);
    await expectAppError(makeProduct(A.admin, { code: "CS3", variants: [{ sku: "cs1-m", barcode: "999" }] }), "CONFLICT", /SKU CS1-M/);
    expect(() =>
      productCreateSchema.parse({
        name: "X",
        code: "X1",
        type: "FINISHED_GOOD",
        unit: "PAIR",
        variants: [
          { sku: "A1", barcode: "123", purchasePrice: "1", sellingPrice: "2" },
          { sku: "A2", barcode: "123", purchasePrice: "1", sellingPrice: "2", size: "L" },
        ],
      }),
    ).toThrow(/Duplicate barcode/);
  });

  it("sales users cannot create products; search matches tokens", async () => {
    await expectAppError(makeProduct(A.sales), "FORBIDDEN");
    await makeProduct(A.admin, { name: "Cotton Socks", variants: [{ size: "M", color: "Black" }, { size: "L", color: "White" }] });
    const hits = await searchVariants(A.sales, "cotton white");
    expect(hits).toHaveLength(1);
    expect(hits[0].color).toBe("White");
  });

  it("price changes are audited", async () => {
    const { variants } = await makeProduct(A.admin);
    const v = variants[0];
    await updateVariant(
      A.admin,
      v.id,
      variantUpdateSchema.parse({ sku: v.sku, barcode: v.barcode, purchasePrice: "50", sellingPrice: "120", minStock: "5", reorderLevel: "0" }),
    );
    const log = await prisma.auditLog.findFirst({ where: { action: "variant.price_change" } });
    expect(log?.summary).toMatch(/from 100.00 to 120.00/);
  });
});

describe("purchase", () => {
  it("receipt increases stock, totals are exact and the document links to the ledger", async () => {
    const s = await makeSupplier(A.admin);
    const { variants } = await makeProduct(A.admin, { variants: [{ size: "M" }, { size: "L" }] });
    const { result: p } = await createPurchase(
      A.store,
      purchase(s.id, [
        { variantId: variants[0].id, quantity: "100", rate: "45.10" },
        { variantId: variants[1].id, quantity: "50", rate: "45.20" },
      ]),
    );
    expect(p.status).toBe("RECEIVED");
    expect(p.total.toFixed(2)).toBe("6770.00");
    expect((await stockOf(variants[0].id)).onHand).toBe("100");
    expect((await stockOf(variants[1].id)).onHand).toBe("50");
    const txns = await prisma.inventoryTransaction.findMany({ where: { purchaseId: p.id } });
    expect(txns).toHaveLength(2);
    expect(txns.every((t) => t.type === "PURCHASE" && t.refNumber === p.number)).toBe(true);
    // last purchase price refreshed
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0].id } })).purchasePrice.toFixed(2)).toBe("45.10");
  });

  it("draft purchase does not touch stock until received, and cannot be received twice", async () => {
    const s = await makeSupplier(A.admin);
    const { variants } = await makeProduct(A.admin);
    const { result: p } = await createPurchase(A.admin, purchase(s.id, [{ variantId: variants[0].id, quantity: "10", rate: "5" }], { receiveNow: false }));
    expect((await stockOf(variants[0].id)).onHand).toBe("0");
    await receivePurchase(A.store, p.id);
    expect((await stockOf(variants[0].id)).onHand).toBe("10");
    await expectAppError(receivePurchase(A.store, p.id), "CONFLICT", /already been received/);
    const results = await Promise.allSettled([receivePurchase(A.store, p.id), receivePurchase(A.store, p.id)]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect((await stockOf(variants[0].id)).onHand).toBe("10");
  });

  it("duplicate submission with the same idempotency key posts only once", async () => {
    const s = await makeSupplier(A.admin);
    const { variants } = await makeProduct(A.admin);
    const input = purchase(s.id, [{ variantId: variants[0].id, quantity: "10", rate: "5" }]);
    const [a, b, c] = await Promise.all([createPurchase(A.admin, input), createPurchase(A.admin, input), createPurchase(A.admin, input)]);
    expect(new Set([a.result.id, b.result.id, c.result.id]).size).toBe(1);
    expect(await prisma.purchase.count()).toBe(1);
    expect((await stockOf(variants[0].id)).onHand).toBe("10");
  });

  it("rejects duplicate supplier invoice numbers, inactive suppliers and invalid quantities", async () => {
    const s = await makeSupplier(A.admin);
    const { variants } = await makeProduct(A.admin);
    await createPurchase(A.admin, purchase(s.id, [{ variantId: variants[0].id, quantity: "1", rate: "5" }], { invoiceNumber: "INV-77" }));
    await expectAppError(
      createPurchase(A.admin, purchase(s.id, [{ variantId: variants[0].id, quantity: "1", rate: "5" }], { invoiceNumber: "inv-77" })),
      "CONFLICT",
      /already entered/,
    );
    await expectAppError(createPurchase(A.admin, purchase(s.id, [{ variantId: variants[0].id, quantity: "1.5", rate: "5" }])), "VALIDATION", /whole number/);
    expect(() => purchase(s.id, [{ variantId: variants[0].id, quantity: "0", rate: "5" }])).toThrow();
    expect(() => purchase(s.id, [{ variantId: variants[0].id, quantity: "-3", rate: "5" }])).toThrow();
    await prisma.supplier.update({ where: { id: s.id }, data: { isActive: false } });
    await expectAppError(createPurchase(A.admin, purchase(s.id, [{ variantId: variants[0].id, quantity: "1", rate: "5" }])), "BUSINESS_RULE", /inactive/);
  });

  it("sales role cannot create purchases", async () => {
    const s = await makeSupplier(A.admin);
    const { variants } = await makeProduct(A.admin);
    await expectAppError(createPurchase(A.sales, purchase(s.id, [{ variantId: variants[0].id, quantity: "1", rate: "5" }])), "FORBIDDEN");
  });

  it("cancelling a received purchase reverses stock, but not if the stock was sold", async () => {
    const s = await makeSupplier(A.admin);
    const { variants } = await makeProduct(A.admin);
    const v = variants[0].id;
    const { result: p1 } = await createPurchase(A.admin, purchase(s.id, [{ variantId: v, quantity: "10", rate: "5" }]));
    await cancelPurchase(A.admin, p1.id, "Entered by mistake");
    expect((await stockOf(v)).onHand).toBe("0");
    expect(await prisma.inventoryTransaction.count({ where: { purchaseId: p1.id } })).toBe(2);

    const { result: p2 } = await createPurchase(A.admin, purchase(s.id, [{ variantId: v, quantity: "10", rate: "5" }]));
    await createSale(A.sales, sale([{ variantId: v, quantity: "8" }]));
    await expectAppError(cancelPurchase(A.admin, p2.id, "oops"), "INSUFFICIENT_STOCK", /already been used or sold/);
    expect((await stockOf(v)).onHand).toBe("2");
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe("RECEIVED");
    await expectAppError(cancelPurchase(A.store, p2.id, "x"), "FORBIDDEN");
  });

  it("supplier return decreases stock and is limited to purchased quantity", async () => {
    const s = await makeSupplier(A.admin);
    const { variants } = await makeProduct(A.admin);
    const v = variants[0].id;
    const { result: p } = await createPurchase(A.admin, purchase(s.id, [{ variantId: v, quantity: "10", rate: "5" }]));
    const pi = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: p.id } });
    await createSupplierReturn(A.store, supplierReturnSchema.parse({ purchaseId: p.id, reason: "Defective lot", items: [{ purchaseItemId: pi.id, quantity: "4" }] }));
    expect((await stockOf(v)).onHand).toBe("6");
    await expectAppError(
      createSupplierReturn(A.store, supplierReturnSchema.parse({ purchaseId: p.id, reason: "Again", items: [{ purchaseItemId: pi.id, quantity: "7" }] })),
      "BUSINESS_RULE",
      /only 6 left/,
    );
    expect((await stockOf(v)).onHand).toBe("6");
  });
});

describe("sale", () => {
  it("sale decreases stock with correct totals and links ledger rows", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ price: "120", opening: "50" }] });
    const v = variants[0].id;
    const { result: s } = await createSale(A.sales, sale([{ variantId: v, quantity: "3", discount: "10" }], { billDiscount: "5", amountReceived: "500" }));
    expect(s.total.toFixed(2)).toBe("345.00");
    expect(s.changeGiven.toFixed(2)).toBe("155.00");
    expect(s.paymentStatus).toBe("PAID");
    expect(s.customerName).toBe("Walk-in Customer");
    expect((await stockOf(v)).onHand).toBe("47");
    const txn = await prisma.inventoryTransaction.findFirstOrThrow({ where: { saleId: s.id } });
    expect(txn.quantity.toString()).toBe("-3");
    expect(txn.balanceAfter.toString()).toBe("47");
  });

  it("rejects selling unavailable stock and changes nothing", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "5", size: "M" }, { opening: "50", size: "L" }] });
    const err = await expectAppError(
      createSale(A.sales, sale([{ variantId: variants[1].id, quantity: "2" }, { variantId: variants[0].id, quantity: "6" }])),
      "INSUFFICIENT_STOCK",
      /required 6, available 5/,
    );
    expect(err.message).toMatch(/Not enough stock/);
    expect((await stockOf(variants[0].id)).onHand).toBe("5");
    expect((await stockOf(variants[1].id)).onHand).toBe("50");
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.counter.count({ where: { key: "INV" } })).toBe(0); // rolled back too
  });

  it("empty cart, zero/negative quantities and decimal pairs are rejected", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "5" }] });
    expect(() => sale([])).toThrow(/Cart is empty/);
    expect(() => sale([{ variantId: variants[0].id, quantity: "0" }])).toThrow();
    expect(() => sale([{ variantId: variants[0].id, quantity: "-1" }])).toThrow();
    await expectAppError(createSale(A.sales, sale([{ variantId: variants[0].id, quantity: "1.5" }])), "VALIDATION", /whole number/);
  });

  it("very large quantities are rejected by validation", () => {
    expect(() => sale([{ variantId: "x", quantity: "99999999" }])).toThrow();
  });

  it("concurrent sales cannot oversell the same stock", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "5" }] });
    const v = variants[0].id;
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createSale(A.sales, sale([{ variantId: v, quantity: "1" }]))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await stockOf(v)).onHand).toBe("0");
    expect(await prisma.sale.count()).toBe(5);
    expect(await verifyLedgerIntegrity()).toEqual([]);
  });

  it("double-click confirm with same key creates exactly one sale", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "10" }] });
    const input = sale([{ variantId: variants[0].id, quantity: "2" }]);
    const [a, b] = await Promise.all([createSale(A.sales, input), createSale(A.sales, input)]);
    expect(a.result.id).toBe(b.result.id);
    expect(await prisma.sale.count()).toBe(1);
    expect((await stockOf(variants[0].id)).onHand).toBe("8");
    const again = await createSale(A.sales, input); // refresh + resubmit
    expect(again.replayed).toBe(true);
    expect((await stockOf(variants[0].id)).onHand).toBe("8");
  });

  it("non-admins cannot override price; credit sale requires a customer", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "10", price: "100" }] });
    const v = variants[0].id;
    await expectAppError(createSale(A.sales, saleCreateSchema.parse({ items: [{ variantId: v, quantity: "1", unitPrice: "1" }], paymentMode: "CASH", amountReceived: "1" })), "FORBIDDEN");
    const { result: s } = await createSale(A.admin, saleCreateSchema.parse({ items: [{ variantId: v, quantity: "1", unitPrice: "90" }], paymentMode: "CASH", amountReceived: "90" }));
    expect(s.total.toFixed(2)).toBe("90.00");
    await expectAppError(createSale(A.sales, sale([{ variantId: v, quantity: "1" }], { paymentMode: "CREDIT", amountReceived: "0" })), "VALIDATION", /Select a customer/);
    const c = await makeCustomer(A.sales);
    const { result: credit } = await createSale(A.sales, sale([{ variantId: v, quantity: "1" }], { paymentMode: "CREDIT", amountReceived: "0", customerId: c.id }));
    expect(credit.paymentStatus).toBe("UNPAID");
    await recordSalePayment(A.sales, credit.id, "60", "CASH");
    const paid = await recordSalePayment(A.sales, credit.id, "40", "UPI");
    expect(paid.paymentStatus).toBe("PAID");
    await expectAppError(recordSalePayment(A.sales, credit.id, "1", "CASH"), "BUSINESS_RULE", /fully paid/);
  });

  it("empty amount received means paid in full, except for credit", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "10", price: "100" }] });
    const v = variants[0].id;
    const base = { items: [{ variantId: v, quantity: "2" }], idempotencyKey: key() };
    const { result: upi } = await createSale(A.sales, saleCreateSchema.parse({ ...base, paymentMode: "UPI", amountReceived: "" }));
    expect(upi.paymentStatus).toBe("PAID");
    expect(upi.amountPaid.toFixed(2)).toBe("200.00");
    const { result: cash } = await createSale(A.sales, saleCreateSchema.parse({ ...base, idempotencyKey: key(), paymentMode: "CASH" }));
    expect(cash.paymentStatus).toBe("PAID");
    expect(cash.changeGiven.toFixed(2)).toBe("0.00");
    await expectAppError(createSale(A.sales, saleCreateSchema.parse({ ...base, idempotencyKey: key(), paymentMode: "CREDIT" })), "VALIDATION", /Select a customer/);
  });

  it("inactive products cannot be sold", async () => {
    const { product, variants } = await makeProduct(A.admin, { variants: [{ opening: "10" }] });
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
    await expectAppError(createSale(A.sales, sale([{ variantId: variants[0].id, quantity: "1" }])), "BUSINESS_RULE", /inactive/);
  });

  it("cancel restores stock via reversal entries; not allowed after returns", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "10" }] });
    const v = variants[0].id;
    const { result: s } = await createSale(A.sales, sale([{ variantId: v, quantity: "4" }]));
    await expectAppError(cancelSale(A.sales, s.id, "Customer left"), "FORBIDDEN");
    await cancelSale(A.admin, s.id, "Customer left");
    expect((await stockOf(v)).onHand).toBe("10");
    expect(await prisma.inventoryTransaction.count({ where: { saleId: s.id } })).toBe(2);
    await expectAppError(cancelSale(A.admin, s.id, "again"), "CONFLICT");

    const { result: s2 } = await createSale(A.sales, sale([{ variantId: v, quantity: "2" }]));
    const si = await prisma.saleItem.findFirstOrThrow({ where: { saleId: s2.id } });
    await createCustomerReturn(A.sales, customerReturnSchema.parse({ saleId: s2.id, refundMode: "CASH", items: [{ saleItemId: si.id, quantity: "1", condition: "GOOD", reason: "Size issue" }] }));
    await expectAppError(cancelSale(A.admin, s2.id, "x"), "BUSINESS_RULE", /has returns/);
  });
});

describe("customer returns", () => {
  async function soldTen() {
    const c = await makeCustomer(A.admin);
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "20", price: "100" }] });
    const { result: s } = await createSale(A.sales, sale([{ variantId: variants[0].id, quantity: "10" }], { customerId: c.id }));
    const si = await prisma.saleItem.findFirstOrThrow({ where: { saleId: s.id } });
    return { v: variants[0].id, s, si, c };
  }
  const ret = (saleId: string, saleItemId: string, quantity: string, condition: "GOOD" | "DAMAGED" = "GOOD", k = key()) =>
    customerReturnSchema.parse({ saleId, refundMode: "CASH", idempotencyKey: k, items: [{ saleItemId, quantity, condition, reason: "Size issue" }] });

  it("good return increases sellable stock; damaged return goes to damaged stock only", async () => {
    const { v, s, si } = await soldTen();
    expect((await stockOf(v)).onHand).toBe("10");
    const { result: r1 } = await createCustomerReturn(A.store, ret(s.id, si.id, "2", "GOOD"));
    expect(r1.refundAmount.toFixed(2)).toBe("200.00");
    expect(await stockOf(v)).toEqual({ onHand: "12", damaged: "0" });
    await createCustomerReturn(A.store, ret(s.id, si.id, "1", "DAMAGED"));
    expect(await stockOf(v)).toEqual({ onHand: "12", damaged: "1" });
    const txns = await prisma.inventoryTransaction.findMany({ where: { type: "CUSTOMER_RETURN" }, orderBy: { createdAt: "asc" } });
    expect(txns.map((t) => t.bucket)).toEqual(["SELLABLE", "DAMAGED"]);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CONFIRMED"); // original untouched
    expect(await prisma.auditLog.count({ where: { action: "return.create" } })).toBe(2);
  });

  it("cannot return more than sold minus already returned (sold 10, returned 3 → reject 8, accept 7)", async () => {
    const { v, s, si } = await soldTen();
    await createCustomerReturn(A.sales, ret(s.id, si.id, "3"));
    await expectAppError(createCustomerReturn(A.sales, ret(s.id, si.id, "8")), "BUSINESS_RULE", /maximum additional return is 7/);
    await createCustomerReturn(A.sales, ret(s.id, si.id, "7"));
    await expectAppError(createCustomerReturn(A.sales, ret(s.id, si.id, "1")), "BUSINESS_RULE", /maximum additional return is 0/);
    expect((await stockOf(v)).onHand).toBe("20");
    const refunded = await prisma.saleItem.findUniqueOrThrow({ where: { id: si.id } });
    expect(refunded.refundedAmount.toFixed(2)).toBe(refunded.netAmount.toFixed(2));
  });

  it("duplicate return (same key or concurrent over-limit) is prevented", async () => {
    const { v, s, si } = await soldTen();
    const k = key();
    const [a, b] = await Promise.all([createCustomerReturn(A.sales, ret(s.id, si.id, "6", "GOOD", k)), createCustomerReturn(A.sales, ret(s.id, si.id, "6", "GOOD", k))]);
    expect(a.result.id).toBe(b.result.id);
    expect((await stockOf(v)).onHand).toBe("16");
    // two different submissions racing for the remaining 4
    const results = await Promise.allSettled([createCustomerReturn(A.sales, ret(s.id, si.id, "4")), createCustomerReturn(A.sales, ret(s.id, si.id, "4"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await stockOf(v)).onHand).toBe("20");
    expect(await verifyLedgerIntegrity()).toEqual([]);
  });

  it("returns on cancelled invoices are rejected", async () => {
    const { s, si } = await soldTen();
    await cancelSale(A.admin, s.id, "test");
    await expectAppError(createCustomerReturn(A.sales, ret(s.id, si.id, "1")), "BUSINESS_RULE", /cancelled/);
  });
});

describe("stock adjustment", () => {
  it("damage moves stock to damaged bucket, requires reason, never goes negative", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "100" }] });
    const v = variants[0].id;
    await createAdjustment(A.store, adjustmentSchema.parse({ reason: "DAMAGE", note: "Product damaged", items: [{ variantId: v, quantity: "3" }] }));
    expect(await stockOf(v)).toEqual({ onHand: "97", damaged: "3" });
    await createAdjustment(A.admin, adjustmentSchema.parse({ reason: "DAMAGE_WRITE_OFF", note: "Disposed", items: [{ variantId: v, quantity: "3" }] }));
    expect(await stockOf(v)).toEqual({ onHand: "97", damaged: "0" });
    await createAdjustment(A.admin, adjustmentSchema.parse({ reason: "FOUND", note: "Found in back room", items: [{ variantId: v, quantity: "3" }] }));
    await createAdjustment(A.admin, adjustmentSchema.parse({ reason: "CORRECTION", note: "Recount", items: [{ variantId: v, quantity: "10", direction: "OUT" }] }));
    expect((await stockOf(v)).onHand).toBe("90");
    await expectAppError(
      createAdjustment(A.admin, adjustmentSchema.parse({ reason: "LOST", note: "Lost", items: [{ variantId: v, quantity: "91" }] })),
      "INSUFFICIENT_STOCK",
    );
    expect(() => adjustmentSchema.parse({ reason: "LOST", note: "", items: [{ variantId: v, quantity: "1" }] })).toThrow();
    await expectAppError(
      createAdjustment(A.sales, adjustmentSchema.parse({ reason: "LOST", note: "Lost one", items: [{ variantId: v, quantity: "1" }] })),
      "FORBIDDEN",
    );
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { reason: "DAMAGE" }, include: { user: true } });
    expect(adj.user.username).toBe("store");
    expect(await verifyLedgerIntegrity()).toEqual([]);
  });

  it("negative stock setting allows overselling only when enabled", async () => {
    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "1" }] });
    await prisma.setting.upsert({ where: { id: 1 }, create: { id: 1, allowNegativeStock: true }, update: { allowNegativeStock: true } });
    await createSale(A.sales, sale([{ variantId: variants[0].id, quantity: "3" }]));
    expect((await stockOf(variants[0].id)).onHand).toBe("-2");
    const inv = await listInventory(A.store, { status: "out", page: 1, pageSize: 10 });
    expect(inv.rows.map((r) => r.variantId)).toContain(variants[0].id);
  });
});

describe("inventory listing", () => {
  it("filters low / out of stock in SQL with pagination", async () => {
    await makeProduct(A.admin, {
      name: "Ankle Socks",
      variants: [
        { size: "S", opening: "0", min: "5" },
        { size: "M", opening: "3", min: "5" },
        { size: "L", opening: "30", min: "5" },
      ],
    });
    const low = await listInventory(A.sales, { status: "low", page: 1, pageSize: 10 });
    const out = await listInventory(A.sales, { status: "out", page: 1, pageSize: 10 });
    const all = await listInventory(A.sales, { page: 1, pageSize: 2 });
    expect(low.rows.map((r) => r.size)).toEqual(["M"]);
    expect(out.rows.map((r) => r.size)).toEqual(["S"]);
    expect(all.total).toBe(3);
    expect(all.rows).toHaveLength(2);
    const search = await listInventory(A.sales, { q: "ankle l", page: 1, pageSize: 10 });
    expect(search.rows.map((r) => r.size)).toEqual(["L"]);
  });

  it("product creation with variants works through the service", async () => {
    const p = await createProduct(
      A.admin,
      productCreateSchema.parse({
        name: "Woollen Gloves",
        code: "WG01",
        type: "FINISHED_GOOD",
        unit: "PAIR",
        variants: [
          { sku: "WG01-M-BLK", barcode: "2100000000011", size: "M", color: "Black", purchasePrice: "80", sellingPrice: "150", openingStock: "12" },
          { sku: "WG01-L-WHT", barcode: "2100000000028", size: "L", color: "White", purchasePrice: "85", sellingPrice: "160" },
        ],
      }),
    );
    const vs = await prisma.productVariant.findMany({ where: { productId: p.id }, include: { stock: true } });
    expect(vs).toHaveLength(2);
    expect(vs.find((v) => v.sku === "WG01-M-BLK")?.stock?.onHand.toString()).toBe("12");
  });
});
