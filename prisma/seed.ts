/* Realistic demo data for a hosiery shop. Every document is created through the
 * real services, so the stock ledger and balances are fully consistent.
 * Safe to run once on a fresh database; it exits if data already exists. */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/server/db";
import type { Actor } from "../src/server/auth/actor";
import { hashPassword } from "../src/server/auth/password";
import { createCategory, createProduct } from "../src/server/services/product.service";
import { createCustomer, createSupplier } from "../src/server/services/party.service";
import { createPurchase } from "../src/server/services/purchase.service";
import { createSale } from "../src/server/services/sale.service";
import { createCustomerReturn } from "../src/server/services/return.service";
import { createProduction, saveBom } from "../src/server/services/production.service";
import { packDispatch, shipDispatch } from "../src/server/services/dispatch.service";
import { createAdjustment } from "../src/server/services/adjustment.service";
import { verifyLedgerIntegrity } from "../src/server/services/inventory.service";
import { buildSku, ean13CheckDigit } from "../src/lib/barcode";
import { productCreateSchema, customerSchema, supplierSchema } from "../src/validators/masters";
import {
  purchaseCreateSchema,
  saleCreateSchema,
  customerReturnSchema,
  bomSchema,
  productionSchema,
  adjustmentSchema,
} from "../src/validators/transactions";
import { toDateKey } from "../src/lib/dates";
import { calculateSale } from "../src/lib/calculations";

const TZ = "Asia/Kolkata";
let barcodeSeq = 1;
const nextBarcode = () => {
  const body = `890${String(7000000 + barcodeSeq++).padStart(9, "0")}`;
  return `${body}${ean13CheckDigit(body)}`;
};

async function main() {
  if (await prisma.user.findFirst()) {
    console.log("Database already has data — seed skipped.");
    return;
  }
  console.log("Seeding…");
  if (process.env.SEED_DEMO === "false") {
    for (const k of ["SEED_ADMIN_PASSWORD", "SEED_STORE_PASSWORD", "SEED_SALES_PASSWORD"]) {
      const v = process.env[k] ?? "";
      if (v.length < 8 || /^(admin|store|sales)123$/.test(v)) throw new Error(`${k} must be set to a strong password (8+ characters) for a production seed`);
    }
  }

  // The settings row may already exist (the app creates a default one on first visit).
  // A production seed (SEED_DEMO=false) keeps it; the demo seed fills in demo details.
  const demoSettings = {
    businessName: "Sri Lakshmi Hosiery",
    address: "14, Kumaran Road, Tiruppur, Tamil Nadu 641601",
    phone: "+91 98431 22110",
    email: "sales@srilakshmihosiery.in",
    gstin: "33ABCDE1234F1Z5",
    currency: "INR",
    timezone: TZ,
    taxEnabled: true,
    taxRate: "5",
    taxLabel: "GST",
    invoiceFooter: "Thank you for shopping with us! Goods once sold can be exchanged within 7 days with invoice.",
  };
  const minimal = process.env.SEED_DEMO === "false";
  await prisma.setting.upsert({
    where: { id: 1 },
    create: minimal ? { id: 1 } : { id: 1, ...demoSettings },
    update: minimal ? {} : demoSettings,
  });

  const mkUser = async (name: string, username: string, role: "ADMIN" | "STORE" | "SALES", password: string): Promise<Actor> => {
    const u = await prisma.user.create({ data: { name, username, role, passwordHash: await hashPassword(password) } });
    return { id: u.id, name: u.name, username: u.username, role };
  };
  const admin = await mkUser(minimal ? "Owner" : "Lakshmi Narayanan", "admin", "ADMIN", process.env.SEED_ADMIN_PASSWORD || "admin123");
  const store = await mkUser(minimal ? "Store" : "Murugan K", "store", "STORE", process.env.SEED_STORE_PASSWORD || "store123");
  const sales = await mkUser(minimal ? "Sales" : "Priya S", "sales", "SALES", process.env.SEED_SALES_PASSWORD || "sales123");

  // Production setup: settings + users only (no demo products or transactions).
  if (process.env.SEED_DEMO === "false") {
    console.log("Created settings and users (SEED_DEMO=false, no demo data).");
    console.log("Logins → admin · store · sales (passwords from SEED_*_PASSWORD)");
    return;
  }

  // ── Categories ──
  const socks = await createCategory(admin, { name: "Socks", parentId: null });
  const ankle = await createCategory(admin, { name: "Ankle socks", parentId: socks.id });
  const crew = await createCategory(admin, { name: "Crew socks", parentId: socks.id });
  const sports = await createCategory(admin, { name: "Sports socks", parentId: socks.id });
  const gloves = await createCategory(admin, { name: "Gloves", parentId: null });
  const innerwear = await createCategory(admin, { name: "Innerwear", parentId: null });
  const rawCat = await createCategory(admin, { name: "Raw materials", parentId: null });

  // ── Suppliers & customers ──
  const sup = async (name: string, phone: string, gstin: string, address: string) =>
    createSupplier(admin, supplierSchema.parse({ name, phone, gstin, address }));
  const yarnCo = await sup("Tiruppur Spinning Mills", "9443012345", "33AAACT1234Q1Z2", "SIDCO Industrial Estate, Tiruppur");
  const knitCo = await sup("Erode Knit Works", "9842098420", "33AAFCE5678K1Z9", "Perundurai Road, Erode");
  const accessCo = await sup("Coimbatore Trims & Labels", "9894011223", "33AABCC9988L1Z4", "Gandhipuram, Coimbatore");

  const cust = async (name: string, phone: string, address: string, email?: string) =>
    createCustomer(admin, customerSchema.parse({ name, phone, address, email }));
  const c1 = await cust("Ravi Textiles (Retail)", "9876501234", "22 Big Bazaar Street, Coimbatore", "ravi.textiles@example.in");
  const c2 = await cust("Anitha Garments", "9123409876", "5 Market Road, Salem");
  const c3 = await cust("Kumar Sports Mart", "9001122334", "88 Avinashi Road, Coimbatore");
  await cust("Meena R", "9790012345", "Tiruppur");

  // ── Finished goods ──
  type V = { size?: string; color?: string; price: string; cost: string; min?: string };
  const fg = async (name: string, code: string, categoryId: string, subcategoryId: string | null, unit: "PAIR" | "PCS" | "PACK", brand: string, variants: V[], supplierId?: string) =>
    createProduct(
      admin,
      productCreateSchema.parse({
        name,
        code,
        type: "FINISHED_GOOD",
        categoryId,
        subcategoryId,
        supplierId,
        unit,
        brand,
        description: `${name} — ${brand}`,
        variants: variants.map((v) => ({
          sku: buildSku(code, v.size, v.color),
          barcode: nextBarcode(),
          size: v.size,
          color: v.color,
          purchasePrice: v.cost,
          sellingPrice: v.price,
          minStock: v.min ?? "10",
          reorderLevel: v.min ?? "10",
        })),
      }),
    );

  const grid = (sizes: string[], colors: string[], price: string, cost: string, min = "10"): V[] =>
    sizes.flatMap((size) => colors.map((color) => ({ size, color, price, cost, min })));

  const cottonSocks = await fg("Cotton Crew Socks", "CCS", socks.id, crew.id, "PAIR", "Lakshmi Comfort", grid(["S", "M", "L"], ["Black", "White", "Navy"], "120", "55"), knitCo.id);
  const ankleSocks = await fg("Ankle Socks", "ANK", socks.id, ankle.id, "PAIR", "Lakshmi Comfort", grid(["M", "L"], ["Black", "Grey", "White"], "80", "35"), knitCo.id);
  const sportsSocks = await fg("Cushioned Sports Socks", "SPT", socks.id, sports.id, "PAIR", "StrideFit", grid(["M", "L", "XL"], ["White", "Black"], "180", "85", "8"), knitCo.id);
  const kidsSocks = await fg("Kids Cartoon Socks (3-pack)", "KID", socks.id, crew.id, "PACK", "TinyToes", grid(["2-4Y", "5-8Y"], ["Assorted"], "199", "95", "6"), knitCo.id);
  const gloves1 = await fg("Woollen Gloves", "WGL", gloves.id, null, "PAIR", "WarmHands", grid(["M", "L"], ["Black", "Maroon"], "250", "120", "5"), knitCo.id);
  const vests = await fg("Cotton Vest", "VST", innerwear.id, null, "PCS", "Lakshmi Comfort", grid(["85", "90", "95"], ["White"], "140", "68", "12"), knitCo.id);

  // ── Raw materials ──
  const raw = async (name: string, code: string, unit: "KG" | "PCS" | "METER", cost: string, min: string, supplierId: string) =>
    createProduct(
      admin,
      productCreateSchema.parse({
        name,
        code,
        type: "RAW_MATERIAL",
        categoryId: rawCat.id,
        supplierId,
        unit,
        variants: [{ sku: code, barcode: nextBarcode(), purchasePrice: cost, sellingPrice: "0", minStock: min, reorderLevel: min }],
      }),
    );
  const yarn = await raw("Combed Cotton Yarn 30s", "RM-YARN30", "KG", "310", "25", yarnCo.id);
  const elastic = await raw("Elastic Band (cuff)", "RM-ELASTIC", "PCS", "1.20", "500", accessCo.id);
  const labels = await raw("Woven Brand Label", "RM-LABEL", "PCS", "0.60", "500", accessCo.id);
  const pouch = await raw("Packaging Pouch", "RM-POUCH", "PCS", "1.50", "300", accessCo.id);

  const variantsOf = async (productId: string) => prisma.productVariant.findMany({ where: { productId }, orderBy: { sku: "asc" } });
  const firstVariant = async (productId: string) => (await variantsOf(productId))[0];

  // ── Purchases (received) ──
  const purchase = async (supplierId: string, invoiceNumber: string, date: string, items: { variantId: string; quantity: string; rate: string }[], paid?: string, actor: Actor = store) =>
    createPurchase(
      actor,
      purchaseCreateSchema.parse({
        supplierId,
        invoiceNumber,
        purchaseDate: date,
        items: items.map((i) => ({ ...i, taxRate: "5" })),
        amountPaid: paid ?? "",
        receiveNow: true,
        idempotencyKey: randomUUID(),
      }),
    );

  const daysAgo = (n: number) => toDateKey(new Date(Date.now() - n * 86400000), TZ);
  const fgProducts = [cottonSocks, ankleSocks, sportsSocks, kidsSocks, gloves1, vests];
  let inv = 1;
  for (const p of fgProducts) {
    const vs = await variantsOf(p.id);
    const r = await purchase(
      knitCo.id,
      `EKW/26-27/${100 + inv++}`,
      daysAgo(20),
      vs.map((v) => ({ variantId: v.id, quantity: p.code === "KID" || p.code === "WGL" ? "30" : "60", rate: v.purchasePrice.toFixed(2) })),
    );
    await backdate("purchase", r.result.id, 20);
  }
  const rp1 = await purchase(yarnCo.id, "TSM-5521", daysAgo(18), [{ variantId: (await firstVariant(yarn.id)).id, quantity: "80.5", rate: "310" }], "15000");
  await backdate("purchase", rp1.result.id, 18);
  const rp2 = await purchase(accessCo.id, "CTL-0912", daysAgo(18), [
    { variantId: (await firstVariant(elastic.id)).id, quantity: "3000", rate: "1.20" },
    { variantId: (await firstVariant(labels.id)).id, quantity: "3000", rate: "0.60" },
    { variantId: (await firstVariant(pouch.id)).id, quantity: "1500", rate: "1.50" },
  ]);
  await backdate("purchase", rp2.result.id, 18);

  // ── BOM & production ──
  const cottonVariants = await variantsOf(cottonSocks.id);
  const bomItems = [
    { materialId: (await firstVariant(yarn.id)).id, quantity: "0.045" },
    { materialId: (await firstVariant(elastic.id)).id, quantity: "1" },
    { materialId: (await firstVariant(labels.id)).id, quantity: "1" },
    { materialId: (await firstVariant(pouch.id)).id, quantity: "1" },
  ];
  await saveBom(admin, bomSchema.parse({ variantId: cottonVariants[0].id, outputQty: "1", items: bomItems, applyToAllVariants: true, notes: "Standard cotton crew sock, 1 pair" }));
  const ankleVariants = await variantsOf(ankleSocks.id);
  await saveBom(
    admin,
    bomSchema.parse({
      variantId: ankleVariants[0].id,
      outputQty: "1",
      items: [
        { materialId: (await firstVariant(yarn.id)).id, quantity: "0.03" },
        { materialId: (await firstVariant(elastic.id)).id, quantity: "1" },
        { materialId: (await firstVariant(labels.id)).id, quantity: "1" },
      ],
      applyToAllVariants: true,
    }),
  );
  // ── 14 days of trading, in chronological order (production runs interleaved) ──
  const allFg = (await Promise.all(fgProducts.map((p) => variantsOf(p.id)))).flat();
  const priceOf = new Map(allFg.map((v) => [v.id, v.sellingPrice.toString()]));
  const customers = [null, null, null, c1.id, c2.id, c3.id];
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 9301 + 49297) % 233280;
    return Math.floor((seed / 233280) * n);
  };
  const exactTotal = (items: { variantId: string; quantity: string }[]) =>
    calculateSale(items.map((i) => ({ quantity: i.quantity, unitPrice: priceOf.get(i.variantId)! })), { taxRate: "5" }).total.toFixed(2);

  const productionDays = new Map([[12, 0], [11, 1], [10, 2], [9, 3]]);
  for (let day = 13; day >= 0; day--) {
    const pIdx = productionDays.get(day);
    if (pIdx !== undefined) {
      const bom = await prisma.billOfMaterial.findUniqueOrThrow({ where: { variantId: cottonVariants[pIdx].id } });
      const pr = await createProduction(store, productionSchema.parse({ bomId: bom.id, quantity: String(100 + pIdx * 20), notes: "Weekly knitting batch", idempotencyKey: randomUUID() }));
      await backdate("production", pr.result.id, day, 10);
    }
    const count = 2 + rand(4);
    for (let k = 0; k < count; k++) {
      const lines = new Map<string, number>();
      const n = 1 + rand(3);
      for (let j = 0; j < n; j++) {
        const v = allFg[rand(allFg.length)];
        lines.set(v.id, (lines.get(v.id) ?? 0) + 1 + rand(3));
      }
      const items = [...lines].map(([variantId, q]) => ({ variantId, quantity: String(q) }));
      const mode = (["CASH", "UPI", "CASH", "CARD"] as const)[rand(4)];
      const r = await createSale(
        sales,
        saleCreateSchema.parse({
          customerId: customers[rand(customers.length)],
          items,
          paymentMode: mode,
          amountReceived: mode === "CASH" ? "5000" : exactTotal(items),
          idempotencyKey: randomUUID(),
        }),
      );
      await backdate("sale", r.result.id, day, count - k);
    }
  }

  // A credit sale with balance due
  await createSale(
    sales,
    saleCreateSchema.parse({
      customerId: c1.id,
      items: [{ variantId: cottonVariants[4].id, quantity: "12" }],
      paymentMode: "CREDIT",
      amountReceived: "500",
      idempotencyKey: randomUUID(),
      notes: "Monthly credit account",
    }),
  );

  // Orders for dispatch: one already dispatched, one pending packing
  const sportsVariants = await variantsOf(sportsSocks.id);
  const order1 = await createSale(
    sales,
    saleCreateSchema.parse({
      customerId: c3.id,
      items: [
        { variantId: sportsVariants[0].id, quantity: "6" },
        { variantId: sportsVariants[1].id, quantity: "4" },
      ],
      paymentMode: "CASH",
      amountReceived: "3000",
      requiresDispatch: true,
      idempotencyKey: randomUUID(),
    }),
  );
  const d1 = await prisma.dispatch.findUniqueOrThrow({ where: { saleId: order1.result.id }, include: { items: true } });
  await packDispatch(store, d1.id, d1.items.map((i) => ({ dispatchItemId: i.id, scannedQty: i.requiredQty.toString() })));
  await shipDispatch(store, d1.id, { carrier: "Professional Couriers", trackingNumber: "PC88123456" });

  await createSale(
    sales,
    saleCreateSchema.parse({
      customerId: c2.id,
      items: [
        { variantId: ankleVariants[0].id, quantity: "10" },
        { variantId: ankleVariants[1].id, quantity: "10" },
      ],
      paymentMode: "CASH",
      amountReceived: "2000",
      requiresDispatch: true,
      dispatchAddress: "5 Market Road, Salem — deliver before 6 pm",
      idempotencyKey: randomUUID(),
    }),
  );

  // ── Customer returns (one good, one damaged) ──
  const withCustomer = await prisma.sale.findFirst({
    where: { customerId: { not: null }, requiresDispatch: false, paymentMode: "CASH" },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
  if (withCustomer) {
    await createCustomerReturn(
      store,
      customerReturnSchema.parse({
        saleId: withCustomer.id,
        refundMode: "CASH",
        items: [{ saleItemId: withCustomer.items[0].id, quantity: "1", condition: "GOOD", reason: "Size issue" }],
        idempotencyKey: randomUUID(),
      }),
    );
  }
  const another = await prisma.sale.findFirst({
    where: { requiresDispatch: false, id: { not: withCustomer?.id }, items: { some: { quantity: { gte: 2 } } } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
  if (another) {
    const item = another.items.find((i) => Number(i.quantity) >= 2) ?? another.items[0];
    await createCustomerReturn(
      sales,
      customerReturnSchema.parse({
        saleId: another.id,
        refundMode: "CASH",
        items: [{ saleItemId: item.id, quantity: "1", condition: "DAMAGED", reason: "Defective / torn" }],
        idempotencyKey: randomUUID(),
      }),
    );
  }

  // ── A damage adjustment ──
  await createAdjustment(store, adjustmentSchema.parse({ reason: "DAMAGE", note: "Water damage in storeroom", items: [{ variantId: (await variantsOf(vests.id))[0].id, quantity: "2" }] }));

  // Make one item low stock for the dashboard demo
  const kidsV = await variantsOf(kidsSocks.id);
  const lowQty = String(Math.max(1, Number((await prisma.stockLevel.findUniqueOrThrow({ where: { variantId: kidsV[0].id } })).onHand) - 4));
  const lowItems = [{ variantId: kidsV[0].id, quantity: lowQty }];
  const lowSale = await createSale(sales, saleCreateSchema.parse({ items: lowItems, paymentMode: "CASH", amountReceived: exactTotal(lowItems), idempotencyKey: randomUUID() }));
  void lowSale;

  const problems = await verifyLedgerIntegrity();
  if (problems.length) throw new Error(`Ledger integrity check failed: ${JSON.stringify(problems)}`);
  console.log(`Seed complete: ${await prisma.product.count()} products, ${await prisma.productVariant.count()} variants, ${await prisma.sale.count()} sales, ${await prisma.purchase.count()} purchases.`);
  console.log("Logins → admin/admin123 · store/store123 · sales/sales123");
}

/** Demo-only: spreads seeded documents over past days so charts/reports have history. */
async function backdate(kind: "sale" | "purchase" | "production", id: string, days: number, offsetHours = 0) {
  const at = new Date(Date.now() - days * 86400000 - offsetHours * 3600000 - 2 * 3600000);
  if (kind === "sale") {
    await prisma.sale.update({ where: { id }, data: { createdAt: at } });
    await prisma.inventoryTransaction.updateMany({ where: { saleId: id }, data: { createdAt: at } });
    await prisma.dispatch.updateMany({ where: { saleId: id }, data: { createdAt: at } });
  } else if (kind === "purchase") {
    await prisma.purchase.update({ where: { id }, data: { createdAt: at, receivedAt: at } });
    await prisma.inventoryTransaction.updateMany({ where: { purchaseId: id }, data: { createdAt: at } });
  } else {
    await prisma.production.update({ where: { id }, data: { createdAt: at } });
    await prisma.inventoryTransaction.updateMany({ where: { productionId: id }, data: { createdAt: at } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
