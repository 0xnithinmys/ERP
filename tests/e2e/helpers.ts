import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const USERS = {
  admin: { username: "admin", password: "admin123" },
  store: { username: "store", password: "store123" },
  sales: { username: "sales", password: "sales123" },
} as const;

export async function login(page: Page, who: keyof typeof USERS = "admin") {
  await page.goto("/login");
  await page.getByLabel("Username").fill(USERS[who].username);
  await page.getByLabel("Password").fill(USERS[who].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

export interface Hit {
  variantId: string;
  name: string;
  sku: string;
  barcode: string | null;
  onHand: string;
  damaged: string;
  sellingPrice: string;
}

async function data<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  const json = (await res.json()) as { data: unknown };
  if (!res.ok()) throw new Error(`API ${res.status()}: ${JSON.stringify(json)}`);
  return json.data as T;
}

/** Reads live stock for a barcode/SKU through the same API the scanner uses. */
export async function lookup(page: Page, code: string): Promise<Hit> {
  const hit = await data<Hit | null>(await page.request.get(`/api/variants/lookup?code=${encodeURIComponent(code)}`));
  if (!hit) throw new Error(`No product for ${code}`);
  return hit;
}

/** Picks an in-stock finished-good variant from search results. */
export async function pickVariant(page: Page, q: string, minStock = 10): Promise<Hit> {
  const hits = await data<(Hit & { type: string })[]>(await page.request.get(`/api/variants/search?q=${encodeURIComponent(q)}&type=FINISHED_GOOD&limit=50`));
  const h = hits.find((x) => x.barcode && Number(x.onHand) >= minStock);
  if (!h) throw new Error(`No in-stock variant for ${q}`);
  return h;
}

export async function apiPost<T>(page: Page, url: string, body: unknown): Promise<T> {
  return data<T>(await page.request.post(url, { data: body }));
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

export const uuid = () => crypto.randomUUID();
