import type { Prisma } from "@prisma/client";
import { D } from "@/lib/decimal";
import type { CustomerInput, SupplierInput } from "@/validators/masters";
import { prisma, transaction } from "../db";
import { conflict, notFound } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { audit, diff } from "./audit.service";

// ───────────── Suppliers ─────────────

export async function listSuppliers(actor: Actor, f: { q?: string; status?: "active" | "inactive" | "all"; page: number; pageSize: number }) {
  assertCan(actor, "suppliers.view");
  const where: Prisma.SupplierWhereInput = {
    ...(f.status === "inactive" ? { isActive: false } : f.status === "all" ? {} : { isActive: true }),
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: "insensitive" } },
            { phone: { contains: f.q } },
            { gstin: { contains: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({ where, orderBy: { name: "asc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.supplier.count({ where }),
  ]);
  const stats = await prisma.purchase.groupBy({
    by: ["supplierId"],
    where: { supplierId: { in: rows.map((r) => r.id) }, status: "RECEIVED" },
    _sum: { total: true, amountPaid: true },
    _count: { _all: true },
  });
  return {
    total,
    rows: rows.map((r) => {
      const s = stats.find((x) => x.supplierId === r.id);
      return {
        ...r,
        purchaseCount: s?._count._all ?? 0,
        totalPurchases: D(s?._sum.total ?? 0).toFixed(2),
        outstanding: D(s?._sum.total ?? 0).minus(D(s?._sum.amountPaid ?? 0)).toFixed(2),
      };
    }),
  };
}

export async function getSupplier(actor: Actor, id: string) {
  assertCan(actor, "suppliers.view");
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw notFound("Supplier");
  const [agg, recent, returns] = await Promise.all([
    prisma.purchase.aggregate({
      where: { supplierId: id, status: "RECEIVED" },
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.purchase.findMany({
      where: { supplierId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { _count: { select: { items: true } } },
    }),
    prisma.supplierReturn.findMany({ where: { supplierId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return {
    supplier,
    purchaseCount: agg._count._all,
    totalPurchases: D(agg._sum.total ?? 0).toFixed(2),
    outstanding: D(agg._sum.total ?? 0).minus(D(agg._sum.amountPaid ?? 0)).toFixed(2),
    recent,
    returns,
  };
}

export async function createSupplier(actor: Actor, input: SupplierInput) {
  assertCan(actor, "suppliers.manage");
  return transaction(async (tx) => {
    const dup = await tx.supplier.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
    if (dup) throw conflict(`Supplier "${input.name}" already exists`);
    const s = await tx.supplier.create({ data: input });
    await audit(tx, actor, { action: "supplier.create", entity: "Supplier", entityId: s.id, summary: `Created supplier ${s.name}` });
    return s;
  });
}

export async function updateSupplier(actor: Actor, id: string, input: SupplierInput) {
  assertCan(actor, "suppliers.manage");
  return transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw notFound("Supplier");
    const dup = await tx.supplier.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id } } });
    if (dup) throw conflict(`Supplier "${input.name}" already exists`);
    const s = await tx.supplier.update({ where: { id }, data: input });
    await audit(tx, actor, {
      action: "supplier.update",
      entity: "Supplier",
      entityId: id,
      summary: `Updated supplier ${s.name}`,
      changes: diff(before as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>),
    });
    return s;
  });
}

// ───────────── Customers ─────────────

export async function listCustomers(actor: Actor, f: { q?: string; status?: "active" | "inactive" | "all"; page: number; pageSize: number }) {
  assertCan(actor, "customers.view");
  const where: Prisma.CustomerWhereInput = {
    ...(f.status === "inactive" ? { isActive: false } : f.status === "all" ? {} : { isActive: true }),
    ...(f.q
      ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { phone: { contains: f.q } }, { email: { contains: f.q, mode: "insensitive" } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { name: "asc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.customer.count({ where }),
  ]);
  const stats = await prisma.sale.groupBy({
    by: ["customerId"],
    where: { customerId: { in: rows.map((r) => r.id) }, status: "CONFIRMED" },
    _sum: { total: true, amountPaid: true },
    _count: { _all: true },
  });
  return {
    total,
    rows: rows.map((r) => {
      const s = stats.find((x) => x.customerId === r.id);
      return {
        ...r,
        saleCount: s?._count._all ?? 0,
        totalSales: D(s?._sum.total ?? 0).toFixed(2),
        balanceDue: D(s?._sum.total ?? 0).minus(D(s?._sum.amountPaid ?? 0)).toFixed(2),
      };
    }),
  };
}

/** Fast customer picker for the POS: name or phone. */
export async function searchCustomers(actor: Actor, q: string) {
  assertCan(actor, "customers.view");
  const term = q.trim();
  return prisma.customer.findMany({
    where: {
      isActive: true,
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term.replace(/[\s-]/g, "") } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 10,
    select: { id: true, name: true, phone: true, address: true },
  });
}

export async function getCustomer(actor: Actor, id: string) {
  assertCan(actor, "customers.view");
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw notFound("Customer");
  const [agg, recent, returns] = await Promise.all([
    prisma.sale.aggregate({
      where: { customerId: id, status: "CONFIRMED" },
      _sum: { total: true, amountPaid: true, refundedAmount: true },
      _count: { _all: true },
    }),
    prisma.sale.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { items: true } } } }),
    prisma.customerReturn.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { sale: { select: { number: true } }, items: { select: { quantity: true, condition: true } } },
    }),
  ]);
  return {
    customer,
    saleCount: agg._count._all,
    totalSales: D(agg._sum.total ?? 0).toFixed(2),
    totalRefunds: D(agg._sum.refundedAmount ?? 0).toFixed(2),
    balanceDue: D(agg._sum.total ?? 0).minus(D(agg._sum.amountPaid ?? 0)).toFixed(2),
    recent,
    returns,
  };
}

export async function createCustomer(actor: Actor, input: CustomerInput) {
  assertCan(actor, "customers.manage");
  return transaction(async (tx) => {
    if (input.phone) {
      const dup = await tx.customer.findUnique({ where: { phone: input.phone } });
      if (dup) throw conflict(`Phone ${input.phone} already belongs to ${dup.name}`);
    }
    const c = await tx.customer.create({ data: input });
    await audit(tx, actor, { action: "customer.create", entity: "Customer", entityId: c.id, summary: `Created customer ${c.name}` });
    return c;
  });
}

export async function updateCustomer(actor: Actor, id: string, input: CustomerInput) {
  assertCan(actor, "customers.manage");
  return transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw notFound("Customer");
    if (input.phone) {
      const dup = await tx.customer.findFirst({ where: { phone: input.phone, NOT: { id } } });
      if (dup) throw conflict(`Phone ${input.phone} already belongs to ${dup.name}`);
    }
    const c = await tx.customer.update({ where: { id }, data: input });
    await audit(tx, actor, {
      action: "customer.update",
      entity: "Customer",
      entityId: id,
      summary: `Updated customer ${c.name}`,
      changes: diff(before as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>),
    });
    return c;
  });
}
