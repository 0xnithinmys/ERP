import type { PaymentMode, Prisma, SaleStatus } from "@prisma/client";
import { calculatePayment, calculateSale } from "@/lib/calculations";
import { D, moneyStr, qtyStr } from "@/lib/decimal";
import { formatMoney, fullItemName, variantLabel } from "@/lib/format";
import type { SaleCreateInput } from "@/validators/transactions";
import { prisma, transaction } from "../db";
import { businessRule, conflict, forbidden, notFound, validation } from "../errors";
import { assertCan, can, type Actor } from "../auth/actor";
import { idempotent } from "../idempotency";
import { audit } from "./audit.service";
import { applyStockMovements } from "./inventory.service";
import { getSettings, nextNumber } from "./settings.service";
import { loadDocumentVariants } from "./shared";

export const saleDetailInclude = {
  customer: { select: { id: true, name: true, phone: true, address: true } },
  createdBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
  items: {
    orderBy: { id: "asc" },
    include: { variant: { select: { sku: true, barcode: true, product: { select: { unit: true } } } } },
  },
  returns: {
    orderBy: { createdAt: "desc" },
    include: { items: true, user: { select: { name: true } } },
  },
  dispatch: { select: { id: true, number: true, status: true } },
} satisfies Prisma.SaleInclude;

export type SaleDetail = Prisma.SaleGetPayload<{ include: typeof saleDetailInclude }>;

/**
 * Confirms a sale. Validation → numbering → document → stock deduction → (dispatch)
 * → audit, all in ONE transaction. Stock is only deducted if everything commits.
 */
export async function createSale(actor: Actor, input: SaleCreateInput) {
  assertCan(actor, "sales.create");
  return idempotent(
    input.idempotencyKey,
    (key) => prisma.sale.findUnique({ where: { idempotencyKey: key } }),
    () =>
      transaction(async (tx) => {
        const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : null;
        if (input.customerId && !customer) throw notFound("Customer");
        if (customer && !customer.isActive) throw businessRule(`Customer "${customer.name}" is inactive`);

        const variants = await loadDocumentVariants(tx, input.items, { type: "FINISHED_GOOD", context: "sale" });
        const lines = input.items.map((it) => {
          const v = variants.get(it.variantId)!;
          const listPrice = D(v.sellingPrice);
          let unitPrice = listPrice;
          if (it.unitPrice !== undefined && !D(it.unitPrice).eq(listPrice)) {
            if (!can(actor, "sales.override_price")) throw forbidden("You are not allowed to change selling prices");
            unitPrice = D(it.unitPrice);
          }
          return { ...it, unitPrice, variant: v };
        });

        const settings = await getSettings(tx);
        const taxRate = settings.taxEnabled ? D(settings.taxRate) : D(0);
        const totals = calculateSale(lines, { billDiscount: input.billDiscount, taxRate });
        const received = input.amountReceived ?? (input.paymentMode === "CREDIT" ? "0" : totals.total.toFixed(2));
        const payment = calculatePayment(totals.total, received, input.paymentMode);
        if (payment.balanceDue.gt(0) && !customer) {
          throw validation("Select a customer for credit or partially paid sales");
        }
        if (input.requiresDispatch && !customer && !input.dispatchAddress) {
          throw validation("Select a customer or enter a delivery address for dispatch orders");
        }

        const number = await nextNumber(tx, "INV");
        const sale = await tx.sale.create({
          data: {
            number,
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? "Walk-in Customer",
            subtotal: moneyStr(totals.subtotal),
            billDiscount: moneyStr(totals.billDiscount),
            taxRate: totals.taxRate.toString(),
            taxAmount: moneyStr(totals.taxAmount),
            total: moneyStr(totals.total),
            amountReceived: moneyStr(payment.amountReceived),
            amountPaid: moneyStr(payment.amountPaid),
            changeGiven: moneyStr(payment.change),
            paymentMode: input.paymentMode as PaymentMode,
            paymentStatus: payment.status,
            requiresDispatch: input.requiresDispatch,
            notes: input.notes,
            idempotencyKey: input.idempotencyKey ?? null,
            createdById: actor.id,
            items: {
              create: lines.map((l, i) => ({
                variantId: l.variantId,
                productName: l.variant.product.name,
                variantLabel: variantLabel(l.variant) || null,
                quantity: qtyStr(l.quantity),
                unitPrice: moneyStr(l.unitPrice),
                discount: moneyStr(totals.lines[i].discount),
                lineTotal: moneyStr(totals.lines[i].lineTotal),
                netAmount: moneyStr(totals.lines[i].netAmount),
                unitCost: moneyStr(l.variant.purchasePrice),
              })),
            },
          },
          include: { items: true },
        });

        await applyStockMovements(
          tx,
          actor,
          sale.items.map((it) => ({
            variantId: it.variantId,
            quantity: D(it.quantity).neg(),
            type: "SALE" as const,
            unitCost: it.unitCost.toString(),
          })),
          { refNumber: number, links: { saleId: sale.id }, shortagePrefix: "Not enough stock" },
        );

        if (input.requiresDispatch) {
          const dNumber = await nextNumber(tx, "DSP");
          await tx.dispatch.create({
            data: {
              number: dNumber,
              saleId: sale.id,
              address: input.dispatchAddress ?? customer?.address ?? null,
              items: {
                create: sale.items.map((it) => ({ saleItemId: it.id, variantId: it.variantId, requiredQty: it.quantity })),
              },
            },
          });
        }

        await audit(tx, actor, {
          action: "sale.create",
          entity: "Sale",
          entityId: sale.id,
          summary: `Created sale ${number} for ${sale.customerName} — ${formatMoney(totals.total)} (${payment.status.toLowerCase()})`,
          changes: {
            items: lines.map((l) => ({ item: fullItemName(l.variant.product.name, l.variant), qty: l.quantity, price: l.unitPrice.toFixed(2) })),
          },
        });
        return sale;
      }),
  );
}

/**
 * Cancels a confirmed sale by posting SALE_CANCEL reversals. The original sale and
 * its ledger rows remain untouched. Not allowed once items were returned or shipped.
 */
export async function cancelSale(actor: Actor, saleId: string, reason: string) {
  assertCan(actor, "sales.cancel");
  return transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true, dispatch: true, returns: { select: { id: true } } } });
    if (!sale) throw notFound("Sale");
    if (sale.returns.length > 0) throw businessRule("This sale has returns and cannot be cancelled. Process a return instead.");
    if (sale.dispatch && ["DISPATCHED", "COMPLETED"].includes(sale.dispatch.status)) {
      throw businessRule("This order has already been dispatched. Process a return instead.");
    }
    const claimed = await tx.sale.updateMany({
      where: { id: saleId, status: "CONFIRMED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason },
    });
    if (claimed.count === 0) throw conflict(`Sale ${sale.number} is already cancelled`);

    await applyStockMovements(
      tx,
      actor,
      sale.items.map((it) => ({ variantId: it.variantId, quantity: it.quantity.toString(), type: "SALE_CANCEL" as const, note: reason })),
      { refNumber: sale.number, links: { saleId } },
    );
    if (sale.dispatch) {
      await tx.dispatch.update({ where: { id: sale.dispatch.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    }
    await audit(tx, actor, {
      action: "sale.cancel",
      entity: "Sale",
      entityId: saleId,
      summary: `Cancelled sale ${sale.number} (${formatMoney(sale.total)}): ${reason}`,
    });
    return tx.sale.findUniqueOrThrow({ where: { id: saleId } });
  });
}

/** Collects an outstanding balance on a credit/partially paid sale. */
export async function recordSalePayment(actor: Actor, saleId: string, amount: string, mode: PaymentMode) {
  assertCan(actor, "sales.create");
  return transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw notFound("Sale");
    if (sale.status === "CANCELLED") throw businessRule("Cannot take payment on a cancelled sale");
    const due = D(sale.total).minus(D(sale.amountPaid));
    if (due.lte(0)) throw businessRule("This sale is already fully paid");
    if (D(amount).gt(due)) throw validation(`Amount exceeds the balance due (${formatMoney(due)})`);
    // Conditional update protects against two cashiers collecting the same balance.
    const updated = await tx.$executeRaw`
      UPDATE "Sale" SET "amountPaid" = "amountPaid" + ${amount}::numeric,
        "paymentStatus" = CASE WHEN "amountPaid" + ${amount}::numeric >= "total" THEN 'PAID'::"PaymentStatus" ELSE 'PARTIAL'::"PaymentStatus" END,
        "updatedAt" = now()
      WHERE "id" = ${saleId} AND "amountPaid" + ${amount}::numeric <= "total"`;
    if (updated === 0) throw conflict("The balance changed. Please refresh and try again.");
    await audit(tx, actor, {
      action: "sale.payment",
      entity: "Sale",
      entityId: saleId,
      summary: `Collected ${formatMoney(amount)} (${mode}) against ${sale.number}`,
    });
    return tx.sale.findUniqueOrThrow({ where: { id: saleId } });
  });
}

export async function listSales(
  actor: Actor,
  f: {
    q?: string;
    status?: SaleStatus;
    paymentStatus?: "PAID" | "PARTIAL" | "UNPAID";
    customerId?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  },
) {
  assertCan(actor, "sales.view");
  const where: Prisma.SaleWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.paymentStatus ? { paymentStatus: f.paymentStatus } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { number: { contains: f.q, mode: "insensitive" } },
            { customerName: { contains: f.q, mode: "insensitive" } },
            { customer: { phone: { contains: f.q } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        _count: { select: { items: true, returns: true } },
        createdBy: { select: { name: true } },
        dispatch: { select: { status: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);
  return { rows, total };
}

export async function getSale(actor: Actor, id: string): Promise<SaleDetail> {
  assertCan(actor, "sales.view");
  const sale = await prisma.sale.findUnique({ where: { id }, include: saleDetailInclude });
  if (!sale) throw notFound("Sale");
  return sale;
}

export async function findSaleByNumber(actor: Actor, number: string): Promise<SaleDetail | null> {
  assertCan(actor, "sales.view");
  return prisma.sale.findFirst({
    where: { number: { equals: number.trim(), mode: "insensitive" } },
    include: saleDetailInclude,
  });
}
