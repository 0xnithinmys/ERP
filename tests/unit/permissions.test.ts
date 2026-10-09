import { describe, expect, it } from "vitest";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

describe("role permissions", () => {
  it("admin has every permission", () => {
    for (const p of PERMISSIONS) expect(hasPermission("ADMIN", p)).toBe(true);
  });

  it("store can receive stock, dispatch and process returns but not manage users/settings", () => {
    for (const p of ["inventory.view", "purchases.receive", "dispatch.manage", "returns.create", "purchases.view"] as const) {
      expect(hasPermission("STORE", p)).toBe(true);
    }
    for (const p of ["users.manage", "settings.manage", "sales.cancel", "purchases.cancel", "manufacturing.cancel"] as const) {
      expect(hasPermission("STORE", p)).toBe(false);
    }
  });

  it("sales can bill, manage customers and do returns but cannot change inventory directly", () => {
    for (const p of ["sales.create", "customers.manage", "returns.create"] as const) expect(hasPermission("SALES", p)).toBe(true);
    for (const p of ["inventory.adjust", "purchases.receive", "users.manage", "settings.manage", "sales.override_price"] as const) {
      expect(hasPermission("SALES", p)).toBe(false);
    }
  });

  it("unknown roles have nothing", () => {
    expect(hasPermission("HACKER", "dashboard.view")).toBe(false);
    expect(hasPermission(undefined, "dashboard.view")).toBe(false);
  });
});
