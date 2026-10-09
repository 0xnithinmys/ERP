import { expect, test } from "@playwright/test";
import { apiPost, expectToast, login, lookup, uuid } from "./helpers";

test.describe.configure({ mode: "serial" });

const CODE = `TS${Date.now().toString().slice(-5)}`;

test("admin creates a product with generated variants and barcodes, then a supplier and customer", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/products/new");
  await page.getByLabel("Product name").fill("Thermal Socks");
  await page.getByLabel("Product code").fill(CODE);
  await page.getByLabel("Sizes (comma separated)").fill("M, L");
  await page.getByLabel("Colours (comma separated)").fill("Black, Grey");
  await page.getByLabel("Cost price").fill("60");
  await page.getByLabel("Selling price").fill("149.50");
  await page.getByLabel("Min stock").fill("5");
  await page.getByLabel("Opening stock").fill("12");
  await page.getByRole("button", { name: "Generate variants" }).click();
  await expect(page.getByLabel("sku for row 4")).toHaveValue(`${CODE}-L-GREY`);
  await page.getByRole("button", { name: "Auto-fill missing barcodes" }).click();
  await expect(page.getByLabel("barcode for row 4")).not.toHaveValue("");
  await page.getByRole("button", { name: "Add product" }).click();
  await expectToast(page, "Product Thermal Socks created");
  await page.waitForURL(/\/products\/(?!new)/);
  await expect(page.getByText(`${CODE}-M-BLACK`)).toBeVisible();
  const v = await lookup(page, `${CODE}-M-BLACK`);
  expect(v.onHand).toBe("12");
  expect(v.sellingPrice).toBe("149.50");

  // Duplicate SKU is rejected with a clear message
  await page.goto("/products/new");
  await page.getByLabel("Product name").fill("Duplicate");
  await page.getByLabel("Product code").fill(`${CODE}X`);
  await page.getByLabel("sku for row 1").fill(`${CODE}-M-BLACK`);
  await page.getByLabel("purchasePrice for row 1").fill("1");
  await page.getByLabel("sellingPrice for row 1").fill("2");
  await page.getByRole("button", { name: "Add product" }).click();
  await expectToast(page, `SKU ${CODE}-M-BLACK is already used by "Thermal Socks"`);

  await page.goto("/suppliers");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(`Salem Hosiery Mills ${CODE}`);
  await page.getByRole("dialog").getByLabel("Phone").fill("9876012345");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Supplier added");
  await expect(page.getByRole("link", { name: `Salem Hosiery Mills ${CODE}` })).toBeVisible();

  await page.goto("/customers");
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(`Deepa Stores ${CODE}`);
  await page.getByRole("dialog").getByLabel("Phone").fill("abc");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter a valid phone number")).toBeVisible();
  await page.getByRole("dialog").getByLabel("Phone").fill(`98${CODE.slice(-5)}111`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Customer added");
});

test("store records damage through the adjustment screen; ledger and audit show it", async ({ page }) => {
  await login(page, "store");
  const before = await lookup(page, `${CODE}-L-BLACK`);
  await page.goto("/inventory/adjust");
  await page.getByLabel("Details *").fill("Torn during unpacking");
  const search = page.getByRole("combobox", { name: /Scan or search the product to adjust/ });
  await search.fill(`${CODE}-L-BLACK`);
  await search.press("Enter");
  await page.getByLabel(/Quantity for Thermal Socks/).fill("13");
  await expect(page.getByText("cannot make stock negative")).toBeVisible();
  await page.getByLabel(/Quantity for Thermal Socks/).fill("2");
  await page.getByRole("button", { name: "Save adjustment" }).click();
  await expectToast(page, "Stock updated successfully");
  const after = await lookup(page, `${CODE}-L-BLACK`);
  expect(Number(after.onHand)).toBe(Number(before.onHand) - 2);
  expect(Number(after.damaged)).toBe(Number(before.damaged) + 2);
});

test("admin cancels a sale from the invoice page (stock restored) and prints an invoice", async ({ page }) => {
  await login(page, "admin");
  const v = await lookup(page, `${CODE}-M-GREY`);
  const sale = await apiPost<{ id: string; number: string }>(page, "/api/sales", {
    items: [{ variantId: v.variantId, quantity: "3" }],
    paymentMode: "UPI",
    amountReceived: "",
    idempotencyKey: uuid(),
  });
  expect(Number((await lookup(page, `${CODE}-M-GREY`)).onHand)).toBe(Number(v.onHand) - 3);

  await page.goto(`/sales/${sale.id}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print invoice" })).toBeHidden(); // chrome hidden on paper
  await expect(page.getByLabel(`Invoice ${sale.number}`)).toBeVisible();
  await expect(page.getByLabel(`Invoice ${sale.number}`)).toContainText("Thermal Socks");
  await expect(page.getByLabel(`Invoice ${sale.number}`)).toContainText("₹470.93"); // 3 × 149.50 + 5% GST
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "Cancel sale" }).click();
  await page.getByLabel("Reason").fill("Customer changed mind at counter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel sale" }).click();
  await expectToast(page, "Sale cancelled and stock restored");
  await expect(page.getByText(/Cancelled .* Customer changed mind/)).toBeVisible();
  expect((await lookup(page, `${CODE}-M-GREY`)).onHand).toBe(v.onHand);

  await page.goto(`/audit?q=${encodeURIComponent(sale.number)}`);
  await expect(page.getByText(`Cancelled sale ${sale.number}`)).toBeVisible();
  await expect(page.getByText(new RegExp(`Created sale ${sale.number}`))).toBeVisible();
});

test("reports load and export CSV", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/reports/sales?range=month");
  await expect(page.getByText("Number of sales")).toBeVisible();
  const csv = await page.request.get("/api/reports/sales/csv?range=month");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Invoice,Date,Customer");
  for (const r of ["purchases", "inventory", "stock-movement", "production"]) {
    await page.goto(`/reports/${r}`);
    await expect(page.locator("h1")).toBeVisible();
    expect((await page.request.get(`/api/reports/${r}/csv?range=month`)).status()).toBe(200);
  }
});

test("mobile: POS and dispatch remain usable at 390px", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, "sales");
  await page.goto("/sales/new");
  const scan = page.getByTestId("pos-scan");
  await scan.fill(`${CODE}-M-BLACK`);
  await scan.press("Enter");
  await expect(page.getByText("1 line(s)")).toBeVisible();
  await page.getByRole("button", { name: "View cart & pay" }).click();
  await expect(page.getByRole("dialog").getByTestId("complete-sale")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

test("product image upload is stored in the database and served back", async ({ page }) => {
  await login(page, "admin");
  // 1×1 transparent PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const res = await page.request.post("/api/uploads", { multipart: { file: { name: "dot.png", mimeType: "image/png", buffer: png } } });
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: { url: string } };
  expect(data.url).toMatch(/^\/api\/uploads\/[a-z0-9]+$/);
  const img = await page.request.get(data.url);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/png");
  expect(Buffer.from(await img.body()).equals(png)).toBe(true);
  const fake = await page.request.post("/api/uploads", { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") } } });
  expect(fake.status()).toBe(400);
});
