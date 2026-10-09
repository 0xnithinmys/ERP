import { hasPermission, type Permission, type RoleCode } from "@/lib/permissions";
import { forbidden } from "../errors";

/** The authenticated user performing an operation. Always resolved server-side. */
export interface Actor {
  id: string;
  name: string;
  username: string;
  role: RoleCode;
  ip?: string | null;
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  return !!actor && hasPermission(actor.role, permission);
}

/** Throws FORBIDDEN unless the actor holds the permission. Used inside every mutating service. */
export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw forbidden();
}
