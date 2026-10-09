// Central role → permission map. The server enforces these on every route
// handler and page; the UI uses the same map only to hide unavailable actions.

export const ROLES = ["ADMIN", "STORE", "SALES"] as const;
export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: "Admin / Owner",
  STORE: "Store / Warehouse",
  SALES: "Sales / Billing",
};

export const PERMISSIONS = [
  "dashboard.view",
  "dashboard.financials",
  "products.view",
  "products.manage",
  "inventory.view",
  "inventory.adjust",
  "purchases.view",
  "purchases.create",
  "purchases.receive",
  "purchases.cancel",
  "supplier_returns.create",
  "sales.view",
  "sales.create",
  "sales.override_price",
  "sales.cancel",
  "dispatch.view",
  "dispatch.manage",
  "returns.view",
  "returns.create",
  "manufacturing.view",
  "manufacturing.manage_bom",
  "manufacturing.produce",
  "manufacturing.cancel",
  "suppliers.view",
  "suppliers.manage",
  "customers.view",
  "customers.manage",
  "reports.view",
  "audit.view",
  "users.manage",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<RoleCode, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  STORE: new Set<Permission>([
    "dashboard.view",
    "products.view",
    "inventory.view",
    "inventory.adjust",
    "purchases.view",
    "purchases.create",
    "purchases.receive",
    "supplier_returns.create",
    "sales.view",
    "dispatch.view",
    "dispatch.manage",
    "returns.view",
    "returns.create",
    "manufacturing.view",
    "manufacturing.produce",
    "suppliers.view",
    "customers.view",
  ]),
  SALES: new Set<Permission>([
    "dashboard.view",
    "products.view",
    "inventory.view",
    "sales.view",
    "sales.create",
    "dispatch.view",
    "returns.view",
    "returns.create",
    "customers.view",
    "customers.manage",
  ]),
};

export function hasPermission(role: RoleCode | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const set = ROLE_PERMISSIONS[role as RoleCode];
  return set ? set.has(permission) : false;
}

export function permissionsFor(role: RoleCode): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
