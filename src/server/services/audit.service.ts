import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import type { Actor } from "../auth/actor";
import { assertCan } from "../auth/actor";

export interface AuditEntry {
  action: string; // e.g. "sale.create"
  entity: string; // e.g. "Sale"
  entityId?: string | null;
  summary: string; // human readable: "Created sale SAL-00012 (₹540.00)"
  changes?: unknown;
}

/** Writes an audit record. Pass `tx` so the log commits/rolls back with the business change. */
export async function audit(db: Tx | typeof prisma, actor: Actor | null, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      userId: actor?.id ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes: entry.changes === undefined ? undefined : (JSON.parse(JSON.stringify(entry.changes)) as Prisma.InputJsonValue),
      ip: actor?.ip ?? null,
    },
  });
}

/** Returns only the fields whose values changed, for compact audit diffs. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    const norm = (v: unknown) => (v === undefined ? null : v !== null && typeof v === "object" ? String(v) : v);
    if (norm(a) !== norm(b)) changes[key] = { from: norm(a), to: norm(b) };
  }
  return changes;
}

export async function listAuditLogs(
  actor: Actor,
  params: { page: number; pageSize: number; entity?: string; userId?: string; q?: string; entityId?: string },
) {
  assertCan(actor, "audit.view");
  const where: Prisma.AuditLogWhereInput = {
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.q ? { summary: { contains: params.q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: { user: { select: { name: true, username: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total };
}
