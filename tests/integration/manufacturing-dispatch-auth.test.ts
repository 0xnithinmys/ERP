import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { bomSchema, productionSchema, saleCreateSchema, customerReturnSchema } from "@/validators/transactions";
import { saveBom, createProduction, previewProduction, cancelProduction } from "@/server/services/production.service";
import { createSale } from "@/server/services/sale.service";
import { createDispatch, packDispatch, shipDispatch, completeDispatch, getDispatch } from "@/server/services/dispatch.service";
import { createCustomerReturn } from "@/server/services/return.service";
import { login, resolveSession, logout } from "@/server/services/auth.service";
import { createUser, updateUser } from "@/server/services/user.service";
import { verifyLedgerIntegrity } from "@/server/services/inventory.service";
import { userCreateSchema, userUpdateSchema } from "@/validators/masters";
import { AppError } from "@/server/errors";
import { hashPassword } from "@/server/auth/password";
import { key, makeActors, makeCustomer, makeProduct, resetDb, stockOf } from "../helpers";

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

async function setupBom(yarnStock = "10") {
  const yarn = (await makeProduct(A.admin, { name: "Cotton Yarn", type: "RAW_MATERIAL", unit: "KG", variants: [{ opening: yarnStock, cost: "300" }] })).variants[0];
  const elastic = (await makeProduct(A.admin, { name: "Elastic", type: "RAW_MATERIAL", unit: "PCS", variants: [{ opening: "500", cost: "1" }] })).variants[0];
  const label = (await makeProduct(A.admin, { name: "Label", type: "RAW_MATERIAL", unit: "PCS", variants: [{ opening: "500", cost: "0.5" }] })).variants[0];
  const socks = (await makeProduct(A.admin, { name: "Cotton Socks", variants: [{ size: "M", opening: "0" }] })).variants[0];
  const bom = await saveBom(
    A.admin,
    bomSchema.parse({
      variantId: socks.id,
      outputQty: "1",
      items: [
        { materialId: yarn.id, quantity: "0.05" },
        { materialId: elastic.id, quantity: "1" },
        { materialId: label.id, quantity: "1" },
      ],
    }),
  );
  return { yarn, elastic, label, socks, bom };
}

describe("manufacturing", () => {
  it("production consumes raw materials and produces finished goods in one transaction", async () => {
    const { yarn, elastic, label, socks, bom } = await setupBom("10");
    const preview = await previewProduction(A.store, bom.id, "100");
    expect(preview.canProduce).toBe(true);
    expect(preview.requirements.find((r) => r.materialId === yarn.id)?.required).toBe("5");

    const { result: prod } = await createProduction(A.store, productionSchema.parse({ bomId: bom.id, quantity: "100", idempotencyKey: key() }));
    expect((await stockOf(yarn.id)).onHand).toBe("5");
    expect((await stockOf(elastic.id)).onHand).toBe("400");
    expect((await stockOf(label.id)).onHand).toBe("400");
    expect((await stockOf(socks.id)).onHand).toBe("100");
    const txns = await prisma.inventoryTransaction.findMany({ where: { productionId: prod.id } });
    expect(txns.filter((t) => t.type === "PRODUCTION_CONSUME")).toHaveLength(3);
    expect(txns.filter((t) => t.type === "PRODUCTION_OUTPUT")).toHaveLength(1);
    // cost = 0.05*300 + 1 + 0.5 = 16.50 per pair
    expect(txns.find((t) => t.type === "PRODUCTION_OUTPUT")?.unitCost?.toFixed(2)).toBe("16.50");
  });

  it("insufficient raw material rejects production and changes nothing", async () => {
    const { yarn, elastic, socks, bom } = await setupBom("7");
    const preview = await previewProduction(A.store, bom.id, "200");
    expect(preview.canProduce).toBe(false);
    const err = await expectAppError(
      createProduction(A.store, productionSchema.parse({ bomId: bom.id, quantity: "200" })),
      "INSUFFICIENT_STOCK",
      /Cannot complete production/,
    );
    expect(err.message).toMatch(/Cotton Yarn: required 10 KG, available 7 KG/);
    expect((await stockOf(yarn.id)).onHand).toBe("7");
    expect((await stockOf(elastic.id)).onHand).toBe("500");
    expect((await stockOf(socks.id)).onHand).toBe("0");
    expect(await prisma.production.count()).toBe(0);
  });

  it("duplicate production posting is prevented and concurrent runs cannot over-consume", async () => {
    const { yarn, socks, bom } = await setupBom("10"); // enough for 200
    const input = productionSchema.parse({ bomId: bom.id, quantity: "150", idempotencyKey: key() });
    const [a, b] = await Promise.all([createProduction(A.store, input), createProduction(A.store, input)]);
    expect(a.result.id).toBe(b.result.id);
    expect((await stockOf(socks.id)).onHand).toBe("150");
    const races = await Promise.allSettled([
      createProduction(A.store, productionSchema.parse({ bomId: bom.id, quantity: "40" })),
      createProduction(A.store, productionSchema.parse({ bomId: bom.id, quantity: "40" })),
    ]);
    expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await stockOf(yarn.id)).onHand).toBe("0.5");
    expect(await verifyLedgerIntegrity()).toEqual([]);
  });

  it("rejects fractional consumption of whole-unit materials, wrong product types, and unauthorised BOM edits", async () => {
    const { socks, yarn } = await setupBom();
    const halfLabel = await saveBom(A.admin, bomSchema.parse({ variantId: socks.id, outputQty: "2", items: [{ materialId: yarn.id, quantity: "0.1" }] }));
    expect(halfLabel.outputQty.toString()).toBe("2");
    await expectAppError(saveBom(A.store, bomSchema.parse({ variantId: socks.id, outputQty: "1", items: [{ materialId: yarn.id, quantity: "1" }] })), "FORBIDDEN");
    await expectAppError(saveBom(A.admin, bomSchema.parse({ variantId: yarn.id, outputQty: "1", items: [{ materialId: yarn.id, quantity: "1" }] })), "VALIDATION", /finished good/);
    await expectAppError(saveBom(A.admin, bomSchema.parse({ variantId: socks.id, outputQty: "1", items: [{ materialId: socks.id, quantity: "1" }] })), "BUSINESS_RULE", /finished good/);
    const elastic = (await makeProduct(A.admin, { name: "Thread", type: "RAW_MATERIAL", unit: "PCS", variants: [{ opening: "10" }] })).variants[0];
    const bom = await saveBom(A.admin, bomSchema.parse({ variantId: socks.id, outputQty: "2", items: [{ materialId: elastic.id, quantity: "1" }] }));
    await expectAppError(createProduction(A.store, productionSchema.parse({ bomId: bom.id, quantity: "3" })), "VALIDATION", /fractional/);
  });

  it("cancelling production reverses both sides", async () => {
    const { yarn, socks, bom } = await setupBom("10");
    const { result: p } = await createProduction(A.store, productionSchema.parse({ bomId: bom.id, quantity: "20" }));
    await expectAppError(cancelProduction(A.store, p.id, "Mistake"), "FORBIDDEN");
    await cancelProduction(A.admin, p.id, "Mistake");
    expect((await stockOf(yarn.id)).onHand).toBe("10");
    expect((await stockOf(socks.id)).onHand).toBe("0");
  });
});

describe("dispatch", () => {
  async function orderSale() {
    const c = await makeCustomer(A.admin);
    const { variants } = await makeProduct(A.admin, { variants: [{ size: "M", opening: "20" }, { size: "L", opening: "20" }] });
    const { result: s } = await createSale(
      A.sales,
      saleCreateSchema.parse({
        customerId: c.id,
        items: [
          { variantId: variants[0].id, quantity: "5" },
          { variantId: variants[1].id, quantity: "2" },
        ],
        paymentMode: "UPI",
        amountReceived: "700",
        requiresDispatch: true,
      }),
    );
    return { s, variants };
  }

  it("verifies scanned quantities before packing and follows the status flow", async () => {
    const { s } = await orderSale();
    const d = await prisma.dispatch.findUniqueOrThrow({ where: { saleId: s.id }, include: { items: { orderBy: { id: "asc" } } } });
    expect(d.status).toBe("PENDING");
    const [m, l] = d.items;
    const err = await expectAppError(
      packDispatch(A.store, d.id, [
        { dispatchItemId: m.id, scannedQty: "4" },
        { dispatchItemId: l.id, scannedQty: "2" },
      ]),
      "BUSINESS_RULE",
      /Required: 5, Scanned: 4/,
    );
    expect(err.details).toBeTruthy();
    expect((await getDispatch(A.store, d.id)).status).toBe("PENDING");
    await expectAppError(shipDispatch(A.store, d.id, { carrier: null, trackingNumber: null }), "CONFLICT");
    await packDispatch(A.store, d.id, [
      { dispatchItemId: m.id, scannedQty: "5" },
      { dispatchItemId: l.id, scannedQty: "2" },
    ]);
    await expectAppError(
      packDispatch(A.store, d.id, [
        { dispatchItemId: m.id, scannedQty: "5" },
        { dispatchItemId: l.id, scannedQty: "2" },
      ]),
      "CONFLICT",
    );
    await expectAppError(completeDispatch(A.store, d.id), "CONFLICT");
    await shipDispatch(A.store, d.id, { carrier: "DTDC", trackingNumber: "D123" });
    const done = await completeDispatch(A.store, d.id);
    expect(done.status).toBe("COMPLETED");
    await expectAppError(shipDispatch(A.store, d.id, { carrier: null, trackingNumber: null }), "CONFLICT");
    expect(await prisma.auditLog.count({ where: { entity: "Dispatch" } })).toBe(3);
  });

  it("sales role cannot pack; returns blocked before dispatch; dispatch can be created for a counter sale", async () => {
    const { s } = await orderSale();
    const d = await prisma.dispatch.findUniqueOrThrow({ where: { saleId: s.id }, include: { items: true } });
    await expectAppError(packDispatch(A.sales, d.id, d.items.map((i) => ({ dispatchItemId: i.id, scannedQty: i.requiredQty.toString() }))), "FORBIDDEN");
    const si = await prisma.saleItem.findFirstOrThrow({ where: { saleId: s.id } });
    await expectAppError(
      createCustomerReturn(A.sales, customerReturnSchema.parse({ saleId: s.id, refundMode: "CASH", items: [{ saleItemId: si.id, quantity: "1", condition: "GOOD", reason: "Size issue" }] })),
      "BUSINESS_RULE",
      /not been dispatched/,
    );

    const { variants } = await makeProduct(A.admin, { variants: [{ opening: "5" }] });
    const { result: counter } = await createSale(A.sales, saleCreateSchema.parse({ items: [{ variantId: variants[0].id, quantity: "1" }], paymentMode: "CASH", amountReceived: "100" }));
    const nd = await createDispatch(A.store, { saleId: counter.id, address: "Shop pickup", notes: null });
    expect(nd.status).toBe("PENDING");
    await expectAppError(createDispatch(A.store, { saleId: counter.id, address: null, notes: null }), "CONFLICT", /already exists/);
  });
});

describe("authentication & users", () => {
  it("login issues a session; wrong password and disabled users are rejected", async () => {
    await prisma.user.update({ where: { id: A.admin.id }, data: { passwordHash: await hashPassword("secret1") } });
    const { token, user } = await login({ username: "ADMIN ", password: "secret1", ip: "10.0.0.1" });
    expect(user.role).toBe("ADMIN");
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(token); // only the hash is stored
    expect((await resolveSession(token))?.id).toBe(A.admin.id);
    await expectAppError(login({ username: "admin", password: "wrong", ip: "10.0.0.2" }), "UNAUTHENTICATED", /Invalid username or password/);
    await expectAppError(login({ username: "nobody", password: "x", ip: "10.0.0.2" }), "UNAUTHENTICATED");
    await logout(token);
    expect(await resolveSession(token)).toBeNull();
    expect(await resolveSession("garbage")).toBeNull();
  });

  it("rate limits repeated failed logins", async () => {
    const attempts = [];
    for (let i = 0; i < 10; i++) attempts.push(await login({ username: "store", password: "bad", ip: "1.2.3.4" }).catch((e: AppError) => e.code));
    expect(attempts.slice(-1)[0]).toBe("RATE_LIMITED");
  });

  it("only admins manage users; deactivation kills sessions; last admin is protected", async () => {
    const input = userCreateSchema.parse({ name: "New Clerk", username: "clerk", role: "SALES", password: "clerk123" });
    await expectAppError(createUser(A.store, input), "FORBIDDEN");
    const u = await createUser(A.admin, input);
    const { token } = await login({ username: "clerk", password: "clerk123", ip: "9.9.9.9" });
    expect(await resolveSession(token)).not.toBeNull();
    await updateUser(A.admin, u.id, userUpdateSchema.parse({ name: "New Clerk", role: "SALES", isActive: false }));
    expect(await resolveSession(token)).toBeNull();
    await expectAppError(login({ username: "clerk", password: "clerk123", ip: "9.9.9.8" }), "UNAUTHENTICATED", /disabled/);
    await expectAppError(updateUser(A.admin, A.admin.id, userUpdateSchema.parse({ name: "Admin", role: "SALES", isActive: true })), "BUSINESS_RULE");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.passwordHash).not.toContain("clerk123");
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
  });
});
