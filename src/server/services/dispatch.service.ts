import type { DispatchStatus, Prisma } from "@prisma/client";
import { D, qtyStr } from "@/lib/decimal";
import { prisma, transaction } from "../db";
import { businessRule, conflict, notFound, validation } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { audit } from "./audit.service";
import { nextNumber } from "./settings.service";

// Status flow: PENDING → PACKED (all items scan-verified) → DISPATCHED → COMPLETED.
// Stock is deducted when the sale is confirmed; dispatch only tracks fulfilment.

const dispatchInclude = {
  sale: {
    select: {
      id: true,
      number: true,
      customerName: true,
      total: true,
      createdAt: true,
      status: true,
      customer: { select: { phone: true, address: true } },
    },
  },
  packedBy: { select: { name: true } },
  dispatchedBy: { select: { name: true } },
  items: {
    orderBy: { id: "asc" },
    include: {
      saleItem: { select: { productName: true, variantLabel: true } },
      variant: { select: { sku: true, barcode: true, product: { select: { unit: true } } } },
    },
  },
} satisfies Prisma.DispatchInclude;

export type DispatchDetail = Prisma.DispatchGetPayload<{ include: typeof dispatchInclude }>;

export async function createDispatch(actor: Actor, input: { saleId: string; address: string | null; notes: string | null }) {
  assertCan(actor, "dispatch.manage");
  return transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true, dispatch: true, customer: true } });
    if (!sale) throw notFound("Sale");
    if (sale.status !== "CONFIRMED") throw businessRule("Only confirmed sales can be dispatched");
    if (sale.dispatch) throw conflict(`A dispatch (${sale.dispatch.number}) already exists for this sale`);
    const items = sale.items
      .map((it) => ({ it, remaining: D(it.quantity).minus(D(it.returnedQty)) }))
      .filter((x) => x.remaining.gt(0));
    if (items.length === 0) throw businessRule("All items on this sale were returned — nothing to dispatch");

    const number = await nextNumber(tx, "DSP");
    const dispatch = await tx.dispatch.create({
      data: {
        number,
        saleId: sale.id,
        address: input.address ?? sale.customer?.address ?? null,
        notes: input.notes,
        items: { create: items.map((x) => ({ saleItemId: x.it.id, variantId: x.it.variantId, requiredQty: x.remaining.toString() })) },
      },
    });
    await tx.sale.update({ where: { id: sale.id }, data: { requiresDispatch: true } });
    await audit(tx, actor, {
      action: "dispatch.create",
      entity: "Dispatch",
      entityId: dispatch.id,
      summary: `Created dispatch ${number} for sale ${sale.number}`,
    });
    return dispatch;
  });
}

/**
 * Marks the order packed. The scanned quantity of EVERY line must equal the
 * required quantity — otherwise nothing changes and the mismatches are reported.
 */
export async function packDispatch(actor: Actor, dispatchId: string, scanned: { dispatchItemId: string; scannedQty: string }[]) {
  assertCan(actor, "dispatch.manage");
  return transaction(async (tx) => {
    const d = await tx.dispatch.findUnique({ where: { id: dispatchId }, include: dispatchInclude });
    if (!d) throw notFound("Dispatch");
    if (d.status !== "PENDING") throw conflict(`Dispatch ${d.number} is already ${d.status.toLowerCase()}`);
    if (d.sale.status !== "CONFIRMED") throw businessRule("The sale for this dispatch was cancelled");

    const byId = new Map(scanned.map((s) => [s.dispatchItemId, D(s.scannedQty)]));
    for (const s of scanned) {
      if (!d.items.some((i) => i.id === s.dispatchItemId)) throw validation("Scanned item does not belong to this order");
    }
    const mismatches = d.items
      .map((i) => ({ i, got: byId.get(i.id) ?? D(0) }))
      .filter((x) => !x.got.eq(D(x.i.requiredQty)))
      .map((x) => ({
        item: `${x.i.saleItem.productName}${x.i.saleItem.variantLabel ? ` (${x.i.saleItem.variantLabel})` : ""}`,
        required: qtyStr(x.i.requiredQty),
        scanned: qtyStr(x.got),
      }));
    if (mismatches.length > 0) {
      throw businessRule(
        `Quantities do not match. ${mismatches.map((m) => `${m.item} — Required: ${m.required}, Scanned: ${m.scanned}`).join("; ")}`,
        { mismatches },
      );
    }

    const claimed = await tx.dispatch.updateMany({
      where: { id: dispatchId, status: "PENDING" },
      data: { status: "PACKED", packedAt: new Date(), packedById: actor.id },
    });
    if (claimed.count === 0) throw conflict("This dispatch was updated by someone else. Please refresh.");
    for (const i of d.items) {
      await tx.dispatchItem.update({ where: { id: i.id }, data: { scannedQty: byId.get(i.id)!.toString() } });
    }
    await audit(tx, actor, {
      action: "dispatch.pack",
      entity: "Dispatch",
      entityId: dispatchId,
      summary: `Packed ${d.number} (sale ${d.sale.number}) — all items verified by scan`,
    });
    return tx.dispatch.findUniqueOrThrow({ where: { id: dispatchId } });
  });
}

async function transition(
  actor: Actor,
  dispatchId: string,
  from: DispatchStatus[],
  to: DispatchStatus,
  data: Prisma.DispatchUncheckedUpdateManyInput,
  verb: string,
) {
  assertCan(actor, "dispatch.manage");
  return transaction(async (tx) => {
    const d = await tx.dispatch.findUnique({ where: { id: dispatchId }, include: { sale: { select: { number: true, status: true } } } });
    if (!d) throw notFound("Dispatch");
    if (d.sale.status !== "CONFIRMED") throw businessRule("The sale for this dispatch was cancelled");
    const claimed = await tx.dispatch.updateMany({ where: { id: dispatchId, status: { in: from } }, data: { ...data, status: to } });
    if (claimed.count === 0) {
      throw conflict(`Cannot mark ${d.number} as ${to.toLowerCase()} — it is currently ${d.status.toLowerCase()}`);
    }
    await audit(tx, actor, {
      action: `dispatch.${to.toLowerCase()}`,
      entity: "Dispatch",
      entityId: dispatchId,
      summary: `${verb} ${d.number} (sale ${d.sale.number})`,
    });
    return tx.dispatch.findUniqueOrThrow({ where: { id: dispatchId } });
  });
}

export function shipDispatch(actor: Actor, dispatchId: string, input: { carrier: string | null; trackingNumber: string | null }) {
  return transition(
    actor,
    dispatchId,
    ["PACKED"],
    "DISPATCHED",
    { carrier: input.carrier, trackingNumber: input.trackingNumber, dispatchedAt: new Date(), dispatchedById: actor.id },
    "Dispatched",
  );
}

export function completeDispatch(actor: Actor, dispatchId: string) {
  return transition(actor, dispatchId, ["DISPATCHED"], "COMPLETED", { completedAt: new Date() }, "Completed delivery of");
}

/** Re-opens a packed order (e.g. a box must be repacked) so it can be scanned again. */
export function unpackDispatch(actor: Actor, dispatchId: string) {
  return transition(actor, dispatchId, ["PACKED"], "PENDING", { packedAt: null, packedById: null }, "Re-opened packing for");
}

export async function listDispatches(actor: Actor, f: { status?: DispatchStatus; q?: string; page: number; pageSize: number }) {
  assertCan(actor, "dispatch.view");
  const where: Prisma.DispatchWhereInput = {
    ...(f.status ? { status: f.status } : {}),
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
  const [rows, total, counts] = await Promise.all([
    prisma.dispatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: { sale: { select: { number: true, customerName: true, total: true } }, _count: { select: { items: true } } },
    }),
    prisma.dispatch.count({ where }),
    prisma.dispatch.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { rows, total, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
}

export async function getDispatch(actor: Actor, id: string): Promise<DispatchDetail> {
  assertCan(actor, "dispatch.view");
  const d = await prisma.dispatch.findUnique({ where: { id }, include: dispatchInclude });
  if (!d) throw notFound("Dispatch");
  return d;
}
