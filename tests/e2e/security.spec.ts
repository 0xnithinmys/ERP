import { expect, test } from "@playwright/test";
import { login, pickVariant, uuid } from "./helpers";

test("unauthenticated users are redirected to login; APIs return 401", async ({ page, request }) => {
  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/login\?next=%2Finventory/);
  const res = await request.get("/api/variants/search?q=socks");
  expect(res.status()).toBe(401);
  const forged = await request.post("/api/adjustments", {
    headers: { cookie: "erp_session=forged-token-value" },
    data: { reason: "LOST", note: "hack", items: [{ variantId: "x", quantity: "1" }] },
  });
  expect(forged.status()).toBe(401);
});

test("wrong password is rejected with a friendly message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password")).toBeVisible();
});

test("sales role: no admin pages, cannot adjust stock or override price via API", async ({ page }) => {
  await login(page, "sales");
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/users");
  await expect(page).toHaveURL(/\/unauthorized/);
  await page.goto("/inventory/adjust");
  await expect(page).toHaveURL(/\/unauthorized/);

  const v = await pickVariant(page, "socks");
  const adj = await page.request.post("/api/adjustments", { data: { reason: "LOST", note: "trying", items: [{ variantId: v.variantId, quantity: "1" }] } });
  expect(adj.status()).toBe(403);
  const price = await page.request.post("/api/sales", {
    data: { items: [{ variantId: v.variantId, quantity: "1", unitPrice: "1.00" }], paymentMode: "CASH", amountReceived: "1", idempotencyKey: uuid() },
  });
  expect(price.status()).toBe(403);
  const users = await page.request.post("/api/users", { data: { name: "Evil", username: "evil", role: "ADMIN", password: "evil123" } });
  expect(users.status()).toBe(403);
});

test("store role: can open dispatch and inventory adjust, cannot manage users or settings", async ({ page }) => {
  await login(page, "store");
  await page.goto("/inventory/adjust");
  await expect(page.getByRole("heading", { name: "Adjust stock" })).toBeVisible();
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/unauthorized/);
  const res = await page.request.patch("/api/settings", { data: { businessName: "Hacked" } });
  expect(res.status()).toBe(403);
});

test("cross-site POST is blocked by origin check", async ({ page }) => {
  await login(page, "admin");
  const res = await page.request.post("/api/customers", { headers: { origin: "https://evil.example" }, data: { name: "CSRF" } });
  expect(res.status()).toBe(403);
});

test("duplicate sale submission (same idempotency key) creates one invoice", async ({ page }) => {
  await login(page, "sales");
  const v = await pickVariant(page, "crew");
  const body = { items: [{ variantId: v.variantId, quantity: "1" }], paymentMode: "CASH", amountReceived: "1000", idempotencyKey: uuid() };
  const [a, b] = await Promise.all([page.request.post("/api/sales", { data: body }), page.request.post("/api/sales", { data: body })]);
  const [ja, jb] = [await a.json(), await b.json()];
  expect(ja.data.id).toBe(jb.data.id);
});
