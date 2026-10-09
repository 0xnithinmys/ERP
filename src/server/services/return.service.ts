import type { Prisma } from "@prisma/client";
import { calculateLineRefund, validateQuantityForUnit } from "@/lib/calculations";
import { D, moneyStr, qtyStr } from "@/lib/decimal";
import { formatMoney } from "@/lib/format";
import type { CustomerReturnInput } from "@/validators/transactions";
import { prisma, transaction } from "../db";
import { businessRule, notFound, validation } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { idempotent } from "../idempotency";
import { audit } from "./audit.service";
import { applyStockMovements, type StockMovement } from "./inventory.service";
import { nextNumber } from "./settings.service";

/**
 * Processes a customer return as a NEW document linked to the original sale.
 * The sale is never modified except for its returned/refunded counters, which are
 * incremented with a conditional UPDATE so that concurrent or duplicate returns
 * can never exceed the sold quantity (also enforced by a DB CHECK constraint).
 *
 *   GOOD    → sellable stock +qty
 *   DAMAGED → damaged stock  +qty (sellable stock unchanged)
 */
export async function createCustomerReturn(actor: Actor, input: CustomerReturnInput) {
  assertCan(actor, "returns.create");
  return idempotent(
    input.idempotencyKey,
    (key) => prisma.customerReturn.findUnique({ where: { idempotencyKey: key } }),
    () =>
      transaction(async (tx) => {
        const sale = await tx.sale.findUnique({
          where: { id: input.saleId },
          include: { items: { include: { variant: { select: { product: { select: { unit: true } } } } } }, dispatch: true },
        });
        if (!sale) throw notFound("Invoice");
        if (sale.status === "CANCELLED") throw businessRule(`Invoice ${sale.number} is cancelled and cannot be returned`);
        if (sale.dispatch && ["PENDING", "PACKED"].includes(sale.dispatch.status)) {
          throw businessRule("This order has not been dispatched yet. Cancel the sale instead of returning it.");
        }

        const number = await nextNumber(tx, "RET");
        let refundTotal = D(0);
        const itemRows: Omit<Prisma.CustomerReturnItemCreateManyInput, "returnId">[] = [];
        const movements: StockMovement[] = [];

        for (const line of input.items) {
          const si = sale.items.find((i) => i.id === line.saleItemId);
          if (!si) throw validation("Item does not belong to this invoice");
          const unitErr = validateQuantityForUnit(line.quantity, si.variant.product.unit);
          if (unitErr) throw validation(`${si.productName}: ${unitErr}`);

          const rows = await tx.$queryRaw<
            { quantity: Prisma.Decimal; returnedQty: Prisma.Decimal; netAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal }[]
          >`
            UPDATE "SaleItem" SET "returnedQty" = "returnedQty" + ${line.quantity}::numeric
            WHERE "id" = ${si.id} AND "returnedQty" + ${line.quantity}::numeric <= "quantity"
            RETURNING "quantity", "returnedQty", "netAmount", "refundedAmount"`;
          if (rows.length === 0) {
            const fresh = await tx.saleItem.findUniqueOrThrow({ where: { id: si.id } });
            const max = D(fresh.quantity).minus(D(fresh.returnedQty));
            throw businessRule(
              `${si.productName}${si.variantLabel ? ` (${si.variantLabel})` : ""}: sold ${qtyStr(fresh.quantity)}, already returned ${qtyStr(fresh.returnedQty)} — maximum additional return is ${qtyStr(max)}`,
              { saleItemId: si.id, max: qtyStr(max) },
            );
          }
          const r = rows[0];
          const refund = calculateLineRefund({
            soldQty: r.quantity.toString(),
            alreadyReturnedQty: D(r.returnedQty.toString()).minus(D(line.quantity)),
            netAmount: r.netAmount.toString(),
            alreadyRefunded: r.refundedAmount.toString(),
            returnQty: line.quantity,
          });
          await tx.saleItem.update({ where: { id: si.id }, data: { refundedAmount: { increment: moneyStr(refund) } } });
          refundTotal = refundTotal.plus(refund);
          itemRows.push({
            saleItemId: si.id,
            variantId: si.variantId,
            quantity: qtyStr(line.quantity),
            condition: line.condition,
            reason: line.reason,
            amount: moneyStr(refund),
          });
          movements.push({
            variantId: si.variantId,
            quantity: qtyStr(line.quantity),
            bucket: line.condition === "GOOD" ? "SELLABLE" : "DAMAGED",
            type: "CUSTOMER_RETURN",
            note: `${line.condition === "GOOD" ? "Good" : "Damaged"} — ${line.reason}`,
          });
        }

        const ret = await tx.customerReturn.create({
          data: {
            number,
            saleId: sale.id,
            customerId: sale.customerId,
            refundAmount: moneyStr(refundTotal),
            refundMode: input.refundMode,
            notes: input.notes,
            userId: actor.id,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        });
        await tx.customerReturnItem.createMany({ data: itemRows.map((r) => ({ ...r, returnId: ret.id })) });
        await tx.sale.update({ where: { id: sale.id }, data: { refundedAmount: { increment: moneyStr(refundTotal) } } });
        await applyStockMovements(tx, actor, movements, { refNumber: number, links: { customerReturnId: ret.id } });

        const good = input.items.filter((i) => i.condition === "GOOD").length;
        const damaged = input.items.length - good;
        await audit(tx, actor, {
          action: "return.create",
          entity: "CustomerReturn",
          entityId: ret.id,
          summary: `Processed return ${number} against ${sale.number} — ${good} good / ${damaged} damaged line(s), refund ${formatMoney(refundTotal)}`,
          changes: { items: itemRows.map((r) => ({ saleItemId: r.saleItemId, qty: r.quantity, condition: r.condition, reason: r.reason })) },
        });
        return ret;
      }),
  );
}

export async function listReturns(
  actor: Actor,
  f: { q?: string; customerId?: string; from?: Date; to?: Date; page: number; pageSize: number },
) {
  assertCan(actor, "returns.view");
  const where: Prisma.CustomerReturnWhereInput = {
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { number: { contains: f.q, mode: "insensitive" } },
            { sale: { number: { contains: f.q, mode: "insensitive" } } },
            { sale: { customerName: { contains: f.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.customerReturn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        sale: { select: { id: true, number: true, customerName: true } },
        user: { select: { name: true } },
        items: { select: { quantity: true, condition: true } },
      },
    }),
    prisma.customerReturn.count({ where }),
  ]);
  return { rows, total };
}

export async function getReturn(actor: Actor, id: string) {
  assertCan(actor, "returns.view");
  const r = await prisma.customerReturn.findUnique({
    where: { id },
    include: {
      sale: { select: { id: true, number: true, customerName: true, createdAt: true } },
      user: { select: { name: true } },
      items: { include: { saleItem: { select: { productName: true, variantLabel: true, unitPrice: true } } } },
    },
  });
  if (!r) throw notFound("Return");
  return r;
}
