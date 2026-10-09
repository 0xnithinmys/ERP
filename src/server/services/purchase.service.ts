import type { Prisma, PurchaseStatus } from "@prisma/client";
import { calculatePurchase, calculatePayment } from "@/lib/calculations";
import { D, moneyStr, qtyStr } from "@/lib/decimal";
import { fullItemName } from "@/lib/format";
import { formatMoney } from "@/lib/format";
import { startOfDayInTz } from "@/lib/dates";
import type { PurchaseCreateInput, SupplierReturnInput } from "@/validators/transactions";
import { prisma, transaction, type Tx } from "../db";
import { businessRule, conflict, notFound, validation } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { idempotent } from "../idempotency";
import { audit } from "./audit.service";
import { applyStockMovements } from "./inventory.service";
import { getSettings, nextNumber } from "./settings.service";
import { loadDocumentVariants } from "./shared";

const purchaseInclude = {
  supplier: { select: { id: true, name: true, phone: true, gstin: true } },
  createdBy: { select: { name: true } },
  receivedBy: { select: { name: true } },
  items: {
    include: {
      variant: { select: { id: true, sku: true, barcode: true, size: true, color: true, product: { select: { name: true, unit: true } } } },
    },
  },
  supplierReturns: { include: { items: true, user: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.PurchaseInclude;

export type PurchaseDetail = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

export async function createPurchase(actor: Actor, input: PurchaseCreateInput) {
  assertCan(actor, "purchases.create");
  if (input.receiveNow) assertCan(actor, "purchases.receive");

  return idempotent(
    input.idempotencyKey,
    (key) => prisma.purchase.findUnique({ where: { idempotencyKey: key } }),
    () =>
      transaction(async (tx) => {
        const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
        if (!supplier) throw notFound("Supplier");
        if (!supplier.isActive) throw businessRule(`Supplier "${supplier.name}" is inactive`);

        if (input.invoiceNumber) {
          const dup = await tx.purchase.findFirst({
            where: {
              supplierId: supplier.id,
              invoiceNumber: { equals: input.invoiceNumber, mode: "insensitive" },
              status: { not: "CANCELLED" },
            },
            select: { number: true },
          });
          if (dup) throw conflict(`Supplier invoice ${input.invoiceNumber} was already entered as ${dup.number}`);
        }

        const variants = await loadDocumentVariants(tx, input.items, { context: "purchase" });
        const totals = calculatePurchase(input.items, { discount: input.discount });
        const payment = calculatePayment(totals.total, input.amountPaid, "CREDIT");
        if (D(input.amountPaid).gt(totals.total)) throw validation("Amount paid cannot exceed the purchase total");

        const settings = await getSettings(tx);
        const number = await nextNumber(tx, "PUR");
        const now = new Date();
        const purchase = await tx.purchase.create({
          data: {
            number,
            supplierId: supplier.id,
            invoiceNumber: input.invoiceNumber,
            purchaseDate: startOfDayInTz(input.purchaseDate, settings.timezone),
            status: input.receiveNow ? "RECEIVED" : "DRAFT",
            subtotal: moneyStr(totals.subtotal),
            discount: moneyStr(totals.discount),
            taxAmount: moneyStr(totals.taxAmount),
            total: moneyStr(totals.total),
            amountPaid: moneyStr(payment.amountPaid),
            paymentStatus: payment.status,
            notes: input.notes,
            idempotencyKey: input.idempotencyKey ?? null,
            createdById: actor.id,
            receivedById: input.receiveNow ? actor.id : null,
            receivedAt: input.receiveNow ? now : null,
            items: {
              create: input.items.map((it, i) => ({
                variantId: it.variantId,
                quantity: qtyStr(it.quantity),
                rate: moneyStr(it.rate),
                discount: moneyStr(totals.lines[i].discount),
                taxRate: totals.lines[i].taxRate.toString(),
                taxAmount: moneyStr(totals.lines[i].taxAmount),
                lineTotal: moneyStr(totals.lines[i].lineTotal),
              })),
            },
          },
        });

        if (input.receiveNow) await postReceipt(tx, actor, purchase.id, number);

        await audit(tx, actor, {
          action: input.receiveNow ? "purchase.receive" : "purchase.create",
          entity: "Purchase",
          entityId: purchase.id,
          summary: `${input.receiveNow ? "Received" : "Created draft"} purchase ${number} from ${supplier.name} — ${input.items.length} item(s), ${formatMoney(totals.total)}`,
          changes: { items: input.items.map((it) => ({ item: fullItemName(variants.get(it.variantId)!.product.name, variants.get(it.variantId)!), qty: it.quantity, rate: it.rate })) },
        });
        return purchase;
      }),
  );
}

/** Adds received quantities to stock and refreshes the last purchase price. */
async function postReceipt(tx: Tx, actor: Actor, purchaseId: string, number: string) {
  const items = await tx.purchaseItem.findMany({ where: { purchaseId } });
  await applyStockMovements(
    tx,
    actor,
    items.map((it) => ({
      variantId: it.variantId,
      quantity: it.quantity.toString(),
      type: "PURCHASE" as const,
      unitCost: it.quantity.isZero() ? it.rate.toString() : D(it.lineTotal).div(D(it.quantity)).toDecimalPlaces(2).toString(),
    })),
    { refNumber: number, links: { purchaseId } },
  );
  for (const it of items) {
    await tx.productVariant.update({ where: { id: it.variantId }, data: { purchasePrice: it.rate } });
  }
}

/** Receives a draft purchase. The conditional status update makes double-receiving impossible. */
export async function receivePurchase(actor: Actor, purchaseId: string) {
  assertCan(actor, "purchases.receive");
  return transaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({ where: { id: purchaseId }, include: { supplier: true, items: true } });
    if (!purchase) throw notFound("Purchase");
    const claimed = await tx.purchase.updateMany({
      where: { id: purchaseId, status: "DRAFT" },
      data: { status: "RECEIVED", receivedById: actor.id, receivedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw conflict(
        purchase.status === "RECEIVED" ? `Purchase ${purchase.number} has already been received` : `Purchase ${purchase.number} is cancelled`,
      );
    }
    await loadDocumentVariants(
      tx,
      purchase.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity.toString() })),
      { context: "purchase" },
    );
    await postReceipt(tx, actor, purchaseId, purchase.number);
    await audit(tx, actor, {
      action: "purchase.receive",
      entity: "Purchase",
      entityId: purchaseId,
      summary: `Received purchase ${purchase.number} from ${purchase.supplier.name}`,
    });
    return tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  });
}

/**
 * Cancels a purchase. A received purchase is reversed with PURCHASE_CANCEL ledger
 * entries (never deleted); this fails if the stock has already been sold.
 */
export async function cancelPurchase(actor: Actor, purchaseId: string, reason: string) {
  assertCan(actor, "purchases.cancel");
  return transaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({ where: { id: purchaseId }, include: { items: true, supplier: true } });
    if (!purchase) throw notFound("Purchase");
    const claimed = await tx.purchase.updateMany({
      where: { id: purchaseId, status: { in: ["DRAFT", "RECEIVED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    if (claimed.count === 0) throw conflict(`Purchase ${purchase.number} is already cancelled`);

    if (purchase.status === "RECEIVED") {
      await applyStockMovements(
        tx,
        actor,
        purchase.items
          .map((it) => ({ it, remaining: D(it.quantity).minus(D(it.returnedQty)) }))
          .filter((x) => x.remaining.gt(0))
          .map((x) => ({ variantId: x.it.variantId, quantity: x.remaining.neg(), type: "PURCHASE_CANCEL" as const, note: reason })),
        {
          refNumber: purchase.number,
          links: { purchaseId },
          allowNegative: false,
          shortagePrefix: "Cannot cancel — some of this stock has already been used or sold",
        },
      );
    }
    await audit(tx, actor, {
      action: "purchase.cancel",
      entity: "Purchase",
      entityId: purchaseId,
      summary: `Cancelled purchase ${purchase.number} (${purchase.supplier.name}): ${reason}`,
    });
    return tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  });
}

export async function recordPurchasePayment(actor: Actor, purchaseId: string, amount: string) {
  assertCan(actor, "purchases.create");
  return transaction(async (tx) => {
    const p = await tx.purchase.findUnique({ where: { id: purchaseId } });
    if (!p) throw notFound("Purchase");
    if (p.status === "CANCELLED") throw businessRule("Cannot record payment on a cancelled purchase");
    const newPaid = D(p.amountPaid).plus(D(amount));
    if (newPaid.gt(D(p.total))) throw validation(`Payment exceeds the balance due (${formatMoney(D(p.total).minus(D(p.amountPaid)))})`);
    const status = newPaid.gte(D(p.total)) ? "PAID" : newPaid.gt(0) ? "PARTIAL" : "UNPAID";
    const updated = await tx.purchase.update({ where: { id: purchaseId }, data: { amountPaid: moneyStr(newPaid), paymentStatus: status } });
    await audit(tx, actor, {
      action: "purchase.payment",
      entity: "Purchase",
      entityId: purchaseId,
      summary: `Recorded payment of ${formatMoney(amount)} against ${p.number}`,
    });
    return updated;
  });
}

export async function listPurchases(
  actor: Actor,
  f: { q?: string; status?: PurchaseStatus; supplierId?: string; from?: Date; to?: Date; page: number; pageSize: number },
) {
  assertCan(actor, "purchases.view");
  const where: Prisma.PurchaseWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.from || f.to ? { purchaseDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { number: { contains: f.q, mode: "insensitive" } },
            { invoiceNumber: { contains: f.q, mode: "insensitive" } },
            { supplier: { name: { contains: f.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: { supplier: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    prisma.purchase.count({ where }),
  ]);
  return { rows, total };
}

export async function getPurchase(actor: Actor, id: string): Promise<PurchaseDetail> {
  assertCan(actor, "purchases.view");
  const p = await prisma.purchase.findUnique({ where: { id }, include: purchaseInclude });
  if (!p) throw notFound("Purchase");
  return p;
}

// ───────────── Supplier returns ─────────────

export async function createSupplierReturn(actor: Actor, input: SupplierReturnInput) {
  assertCan(actor, "supplier_returns.create");
  return idempotent(
    input.idempotencyKey,
    (key) => prisma.supplierReturn.findUnique({ where: { idempotencyKey: key } }),
    () =>
      transaction(async (tx) => {
        const purchase = await tx.purchase.findUnique({ where: { id: input.purchaseId }, include: { items: true, supplier: true } });
        if (!purchase) throw notFound("Purchase");
        if (purchase.status !== "RECEIVED") throw businessRule("Only received purchases can be returned to the supplier");

        const number = await nextNumber(tx, "SRT");
        let total = D(0);
        const itemRows: Prisma.SupplierReturnItemCreateManyInput[] = [];
        const movements = [];
        for (const line of input.items) {
          const pi = purchase.items.find((i) => i.id === line.purchaseItemId);
          if (!pi) throw validation("Item does not belong to this purchase");
          // Atomic guard: cannot return more than was received minus earlier returns.
          const updated = await tx.$executeRaw`
            UPDATE "PurchaseItem" SET "returnedQty" = "returnedQty" + ${line.quantity}::numeric
            WHERE "id" = ${pi.id} AND "returnedQty" + ${line.quantity}::numeric <= "quantity"`;
          if (updated === 0) {
            const fresh = await tx.purchaseItem.findUniqueOrThrow({ where: { id: pi.id } });
            throw businessRule(
              `Cannot return ${line.quantity}: only ${qtyStr(D(fresh.quantity).minus(D(fresh.returnedQty)))} left to return on this line`,
            );
          }
          const amount = D(pi.lineTotal).div(D(pi.quantity)).times(D(line.quantity)).toDecimalPlaces(2);
          total = total.plus(amount);
          itemRows.push({
            supplierReturnId: "",
            purchaseItemId: pi.id,
            variantId: pi.variantId,
            quantity: qtyStr(line.quantity),
            bucket: line.bucket,
            amount: moneyStr(amount),
          });
          movements.push({
            variantId: pi.variantId,
            quantity: D(line.quantity).neg(),
            bucket: line.bucket,
            type: "SUPPLIER_RETURN" as const,
            note: input.reason,
          });
        }
        const sr = await tx.supplierReturn.create({
          data: {
            number,
            purchaseId: purchase.id,
            supplierId: purchase.supplierId,
            reason: input.reason,
            totalAmount: moneyStr(total),
            userId: actor.id,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        });
        await tx.supplierReturnItem.createMany({ data: itemRows.map((r) => ({ ...r, supplierReturnId: sr.id })) });
        await applyStockMovements(tx, actor, movements, {
          refNumber: number,
          links: { supplierReturnId: sr.id },
          allowNegative: false,
          shortagePrefix: "Not enough stock to return to supplier",
        });
        await audit(tx, actor, {
          action: "supplier_return.create",
          entity: "SupplierReturn",
          entityId: sr.id,
          summary: `Returned goods to ${purchase.supplier.name} (${number}) against ${purchase.number} — ${formatMoney(total)}`,
        });
        return sr;
      }),
  );
}
