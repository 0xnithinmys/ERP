import { expect, test } from "@playwright/test";
import { apiPost, expectToast, login, lookup, pickVariant, uuid } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Flow 1 — purchase: scan product, receive quantity, inventory increases", async ({ page }) => {
  await login(page, "admin");
  const v = await pickVariant(page, "cotton crew");
  const before = Number(v.onHand);

  await page.goto("/purchases/new");
  await page.getByRole("combobox", { name: "Supplier" }).click();
  await page.getByRole("option", { name: "Erode Knit Works" }).click();
  const search = page.getByRole("combobox", { name: /Scan barcode or search product/ });
  await search.fill(v.barcode!);
  await search.press("Enter");
  const qty = page.getByLabel(`Quantity for ${v.name}`);
  await expect(qty).toBeVisible();
  await qty.fill("24");
  await page.getByTestId("submit-purchase").click();
  await expectToast(page, "Purchase received successfully");
  await page.waitForURL(/\/purchases\/(?!new)/);
  await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();

  await page.goto(`/inventory?q=${encodeURIComponent(v.sku)}`);
  await expect(page.getByRole("cell", { name: new RegExp(`^${before + 24}\\s`) })).toBeVisible();
  expect(Number((await lookup(page, v.barcode!)).onHand)).toBe(before + 24);
});

test("Flow 2 — sale: scan in POS, adjust quantity, complete payment, invoice, stock decreases", async ({ page }) => {
  await login(page, "sales");
  const v = await pickVariant(page, "ankle");
  const before = Number(v.onHand);

  await page.goto("/sales/new");
  const scan = page.getByTestId("pos-scan");
  await scan.fill(v.barcode!);
  await scan.press("Enter");
  await expect(page.getByLabel(`Quantity for ${v.name}`)).toHaveValue("1");
  // Rapid repeat scan + "3*" multiplier
  await scan.fill(v.barcode!);
  await scan.press("Enter");
  await scan.fill(`3*${v.barcode}`);
  await scan.press("Enter");
  await expect(page.getByLabel(`Quantity for ${v.name}`)).toHaveValue("5");
  await expect(scan).toBeFocused();

  await page.getByRole("button", { name: "Exact" }).click();
  await page.getByTestId("complete-sale").click();
  await expect(page.getByRole("heading", { name: "Sale completed" })).toBeVisible();
  const invoice = (await page.getByTestId("invoice-number").textContent())!.trim();
  expect(invoice).toMatch(/^INV-\d{5}$/);
  await expectToast(page, "Sale completed successfully");

  expect(Number((await lookup(page, v.barcode!)).onHand)).toBe(before - 5);

  await page.goto("/sales");
  await page.getByRole("link", { name: invoice }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Invoice ${invoice}`) })).toBeVisible();
  await expect(page.getByLabel(`Invoice ${invoice}`).getByText(v.name.split(" — ")[0])).toBeVisible();
});

test("POS — unknown barcode shows 'Product not found'; empty cart cannot be completed", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/sales/new");
  const scan = page.getByTestId("pos-scan");
  await scan.fill("0000000999999");
  await scan.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Product not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create product" })).toBeVisible();
  await expect(page.getByTestId("complete-sale")).toBeDisabled();
});

async function makeSale(page: import("@playwright/test").Page, variantId: string, qty: string, extra: Record<string, unknown> = {}) {
  return apiPost<{ id: string; number: string }>(page, "/api/sales", {
    items: [{ variantId, quantity: qty }],
    paymentMode: "CASH",
    amountReceived: "100000",
    idempotencyKey: uuid(),
    ...extra,
  });
}

test("Flow 3 — good return increases sellable inventory", async ({ page }) => {
  await login(page, "sales");
  const v = await pickVariant(page, "sports");
  const sale = await makeSale(page, v.variantId, "4");
  const afterSale = Number((await lookup(page, v.barcode!)).onHand);

  await page.goto(`/returns/new?invoice=${sale.number}`);
  await page.getByLabel("Return qty").fill("2");
  await page.getByRole("combobox", { name: /Reason for/ }).click();
  await page.getByRole("option", { name: "Size issue" }).click();
  await expect(page.getByText("Will go back to sellable stock")).toBeVisible();
  await page.getByTestId("confirm-return").click();
  await expectToast(page, /Return processed successfully/);
  await page.waitForURL(/\/returns\/(?!new)/);

  const after = await lookup(page, v.barcode!);
  expect(Number(after.onHand)).toBe(afterSale + 2);

  // Over-return is blocked in the UI: sold 4, returned 2 → max 2
  await page.goto(`/returns/new?invoice=${sale.number}`);
  await page.getByLabel("Return qty").fill("3");
  await expect(page.getByText("Maximum additional return is 2")).toBeVisible();
  await expect(page.getByTestId("confirm-return")).toBeDisabled();
});

test("Flow 4 — damaged return leaves sellable stock unchanged and increases damaged stock", async ({ page }) => {
  await login(page, "store");
  const v = await pickVariant(page, "vest");
  await page.request.post("/api/auth/logout", { data: {} });
  await login(page, "sales");
  const sale = await makeSale(page, v.variantId, "3");
  const mid = await lookup(page, v.barcode!);

  await page.goto(`/returns/new?invoice=${sale.number}`);
  await page.getByLabel("Return qty").fill("1");
  await page.getByLabel("Damaged").click();
  await page.getByRole("combobox", { name: /Reason for/ }).click();
  await page.getByRole("option", { name: "Defective / torn" }).click();
  await expect(page.getByText("Will go to damaged stock")).toBeVisible();
  await page.getByTestId("confirm-return").click();
  await expectToast(page, /Return processed successfully/);

  const after = await lookup(page, v.barcode!);
  expect(after.onHand).toBe(mid.onHand);
  expect(Number(after.damaged)).toBe(Number(mid.damaged) + 1);
});

test("Flow 5 — dispatch: scan items, wrong item & quantity warnings, pack, dispatch, complete", async ({ page }) => {
  await login(page, "admin");
  const a = await pickVariant(page, "crew socks m");
  const customers = await (await page.request.get("/api/customers?q=Kumar")).json();
  const sale = await makeSale(page, a.variantId, "2", { customerId: customers.data[0].id, requiresDispatch: true });
  const detail = await (await page.request.get(`/api/sales/${sale.id}`)).json();
  const dispatchId = detail.data.dispatch.id as string;

  await page.goto(`/dispatch/${dispatchId}`);
  await expect(page.getByText("Pending").first()).toBeVisible();
  const scan = page.getByTestId("dispatch-scan");
  await scan.fill("8900070000318"); // yarn — not in this order
  await scan.press("Enter");
  await expect(page.getByTestId("dispatch-warning")).toContainText("This item does not belong to this order.");
  await expect(page.getByTestId("mark-packed")).toBeDisabled();

  await scan.fill(a.barcode!);
  await scan.press("Enter");
  await expect(page.getByTestId(`dispatch-count-${a.sku}`)).toHaveText("1 / 2");
  await expect(page.getByTestId("mark-packed")).toBeDisabled();
  await scan.fill(a.barcode!);
  await scan.press("Enter");
  await expect(page.getByTestId(`dispatch-count-${a.sku}`)).toHaveText("2 / 2");
  await scan.fill(a.barcode!);
  await scan.press("Enter");
  await expect(page.getByTestId("dispatch-warning")).toContainText("Required: 2, Scanned: 3");

  await page.getByTestId("mark-packed").click();
  await expectToast(page, "order packed");
  await expect(page.getByText("Packed", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Courier / transporter").fill("DTDC");
  await page.getByTestId("mark-dispatched").click();
  await expectToast(page, "Order dispatched");
  await page.getByRole("button", { name: "Mark delivered / completed" }).click();
  await page.getByRole("button", { name: "Mark completed" }).click();
  await expectToast(page, "Dispatch completed");
  await expect(page.getByText("This order has been delivered.")).toBeVisible();

  // Server also rejects a mismatched pack request (cannot bypass the UI)
  const sale2 = await makeSale(page, a.variantId, "3", { customerId: customers.data[0].id, requiresDispatch: true });
  const d2 = (await (await page.request.get(`/api/sales/${sale2.id}`)).json()).data.dispatch.id;
  const d2detail = (await (await page.request.get(`/api/dispatch/${d2}`)).json()).data;
  const res = await page.request.post(`/api/dispatch/${d2}/pack`, { data: { items: [{ dispatchItemId: d2detail.items[0].id, scannedQty: "2" }] } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toContain("Required: 3, Scanned: 2");
});

test("Flow 6 — manufacturing: raw materials, BOM, availability check, production updates stock", async ({ page }) => {
  await login(page, "admin");
  const code = `RM${Date.now().toString().slice(-6)}`;
  // Raw material with 2 kg opening stock
  await apiPost(page, "/api/products", {
    name: `Test Nylon Yarn ${code}`,
    code,
    type: "RAW_MATERIAL",
    unit: "KG",
    variants: [{ sku: code, barcode: "", purchasePrice: "400", sellingPrice: "0", openingStock: "2" }],
  });
  const fg = await pickVariant(page, "woollen gloves", 0);
  const fgBefore = Number(fg.onHand);

  // BOM via UI: 0.1 kg per pair
  await page.goto(`/manufacturing/boms/new?variant=${fg.variantId}`);
  const mat = page.getByRole("combobox", { name: /Add raw material/ });
  await mat.fill(code);
  await page.getByRole("option", { name: new RegExp(code) }).click();
  await page.getByLabel(new RegExp(`Quantity of Test Nylon Yarn`)).fill("0.1");
  await page.getByRole("button", { name: "Save BOM" }).click();
  await expectToast(page, "Bill of materials saved");

  // Too much: 30 pairs needs 3 kg, only 2 kg available
  await page.goto("/manufacturing/new");
  await page.getByRole("combobox", { name: "Finished product" }).click();
  await page.getByRole("option", { name: fg.name }).click();
  await page.getByLabel("Quantity to produce").fill("30");
  await expect(page.getByText("Cannot complete production.")).toBeVisible();
  await expect(page.getByText(/required 3 kg, available 2 kg/)).toBeVisible();
  await expect(page.getByTestId("confirm-production")).toBeDisabled();

  await page.getByLabel("Quantity to produce").fill("15");
  await expect(page.getByTestId("confirm-production")).toBeEnabled();
  await page.getByTestId("confirm-production").click();
  await expectToast(page, /Production PRD-\d+ completed/);
  await page.waitForURL(/\/manufacturing\/(?!new)/);

  expect(Number((await lookup(page, code)).onHand)).toBeCloseTo(0.5, 3);
  expect(Number((await lookup(page, fg.barcode!)).onHand)).toBe(fgBefore + 15);
});

test("Ledger shows the movements with running balance", async ({ page }) => {
  await login(page, "admin");
  const v = await pickVariant(page, "ankle");
  await page.goto(`/inventory/${v.variantId}`);
  await expect(page.getByRole("cell", { name: "Sale" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Purchase" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: v.onHand.replace(/\B(?=(\d{3})+(?!\d))/g, ",") }).first()).toBeVisible();
});
