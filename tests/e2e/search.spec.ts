import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Regression: list searches must apply (with and without results) and never crash.
const PAGES: [string, string, string][] = [
  ["/products", "Name, code, SKU, barcode…", "cotton"],
  ["/inventory", "Product, SKU, barcode, size, colour…", "ankle"],
  ["/customers", "Name, phone or email…", "ravi"],
  ["/suppliers", "Name, phone or GSTIN…", "mill"],
  ["/sales", "Invoice no, customer or phone…", "INV"],
  ["/returns", "Return no, invoice no, customer…", "RET"],
];

test("list searches filter results and show an empty state for no matches", async ({ page }) => {
  await login(page, "admin");
  for (const [path, placeholder, term] of PAGES) {
    for (const q of [term, "zzzz-nothing"]) {
      await page.goto(path);
      await page.getByPlaceholder(placeholder).fill(q);
      await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(q)}`));
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      if (q === "zzzz-nothing") await expect(page.locator("main tbody")).toContainText(/No .*(found|match)|No matches for/i);
      else await expect(page.locator("main tbody tr").first()).toBeVisible();
    }
  }
});

test("row links and pagination navigate", async ({ page }) => {
  await login(page, "admin");
  for (let i = 0; i < 3; i++) {
    await page.goto("/customers");
    await page.locator("main tbody a").first().click();
    await expect(page).toHaveURL(/\/customers\/c/);
  }
  await page.goto("/inventory");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
});

test("quick-action palette search does not crash", async ({ page }) => {
  await login(page, "admin");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("socks");
  await expect(page.getByRole("option").filter({ hasText: "Socks" }).first()).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
});
