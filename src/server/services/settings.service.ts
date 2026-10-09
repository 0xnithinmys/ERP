import type { Setting } from "@prisma/client";
import { prisma, type Tx } from "../db";
import type { Actor } from "../auth/actor";
import { assertCan } from "../auth/actor";
import { audit, diff } from "./audit.service";
import type { SettingsInput } from "@/validators/settings";

export async function getSettings(db: Tx | typeof prisma = prisma): Promise<Setting> {
  const existing = await db.setting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  // Atomic create-if-missing (safe when several first requests race).
  await db.$executeRaw`INSERT INTO "Setting" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT ("id") DO NOTHING`;
  return db.setting.findUniqueOrThrow({ where: { id: 1 } });
}

/** Plain-JSON settings for client components. */
export async function getPublicSettings() {
  const s = await getSettings();
  return {
    businessName: s.businessName,
    address: s.address,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    currency: s.currency,
    timezone: s.timezone,
    taxEnabled: s.taxEnabled,
    taxRate: s.taxRate.toString(),
    taxLabel: s.taxLabel,
    allowNegativeStock: s.allowNegativeStock,
    invoiceFooter: s.invoiceFooter,
  };
}
export type PublicSettings = Awaited<ReturnType<typeof getPublicSettings>>;

export async function updateSettings(actor: Actor, input: SettingsInput) {
  assertCan(actor, "settings.manage");
  const before = await getSettings();
  const updated = await prisma.setting.update({ where: { id: 1 }, data: { ...input, taxRate: input.taxRate } });
  await audit(prisma, actor, {
    action: "settings.update",
    entity: "Setting",
    entityId: "1",
    summary: "Updated business settings",
    changes: diff(before as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>),
  });
  return updated;
}

/** Atomically allocates the next document number, e.g. SAL-00042. */
export async function nextNumber(tx: Tx, prefix: string): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${prefix}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return `${prefix}-${String(rows[0].value).padStart(5, "0")}`;
}
