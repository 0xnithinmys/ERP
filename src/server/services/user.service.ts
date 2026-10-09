import type { UserCreateInput, UserUpdateInput } from "@/validators/masters";
import { ROLE_LABELS } from "@/lib/permissions";
import { prisma, transaction } from "../db";
import { AppError, businessRule, conflict, notFound } from "../errors";
import { assertCan, type Actor } from "../auth/actor";
import { hashPassword, verifyPassword } from "../auth/password";
import { audit } from "./audit.service";

const publicUser = {
  id: true,
  name: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export async function listUsers(actor: Actor) {
  assertCan(actor, "users.manage");
  return prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: publicUser });
}

export async function createUser(actor: Actor, input: UserCreateInput) {
  assertCan(actor, "users.manage");
  return transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { username: input.username } })) throw conflict(`Username "${input.username}" is taken`);
    if (input.email && (await tx.user.findUnique({ where: { email: input.email } }))) throw conflict("Email already in use");
    const user = await tx.user.create({
      data: { name: input.name, username: input.username, email: input.email, role: input.role, passwordHash: await hashPassword(input.password) },
      select: publicUser,
    });
    await audit(tx, actor, {
      action: "user.create",
      entity: "User",
      entityId: user.id,
      summary: `Created user ${user.username} (${ROLE_LABELS[user.role]})`,
    });
    return user;
  });
}

export async function updateUser(actor: Actor, id: string, input: UserUpdateInput) {
  assertCan(actor, "users.manage");
  return transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw notFound("User");
    if (id === actor.id && (!input.isActive || input.role !== "ADMIN")) {
      throw businessRule("You cannot deactivate yourself or remove your own admin role");
    }
    if (before.role === "ADMIN" && (input.role !== "ADMIN" || !input.isActive)) {
      const admins = await tx.user.count({ where: { role: "ADMIN", isActive: true, NOT: { id } } });
      if (admins === 0) throw businessRule("At least one active admin is required");
    }
    if (input.email) {
      const dup = await tx.user.findFirst({ where: { email: input.email, NOT: { id } } });
      if (dup) throw conflict("Email already in use");
    }
    const user = await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        isActive: input.isActive,
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      },
      select: publicUser,
    });
    // Role, status or password changes end existing sessions immediately.
    if (input.password || before.role !== input.role || !input.isActive) {
      await tx.session.deleteMany({ where: { userId: id } });
    }
    const changed = [
      before.role !== input.role && `role ${before.role} → ${input.role}`,
      before.isActive !== input.isActive && (input.isActive ? "activated" : "deactivated"),
      input.password && "password reset",
      before.name !== input.name && "name changed",
    ].filter(Boolean);
    await audit(tx, actor, {
      action: "user.update",
      entity: "User",
      entityId: id,
      summary: `Updated user ${user.username}${changed.length ? `: ${changed.join(", ")}` : ""}`,
    });
    return user;
  });
}

export async function changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string, keepSessionTokenHash?: string) {
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user) throw notFound("User");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new AppError("VALIDATION", "Current password is incorrect");
  await prisma.$transaction([
    prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.session.deleteMany({ where: { userId: actor.id, ...(keepSessionTokenHash ? { NOT: { tokenHash: keepSessionTokenHash } } : {}) } }),
  ]);
  await audit(prisma, actor, { action: "user.password", entity: "User", entityId: actor.id, summary: `${actor.name} changed their password` });
}
