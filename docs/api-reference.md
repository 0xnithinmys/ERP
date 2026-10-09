# API reference

[← Back to index](README.md)

All endpoints live under `/api`. They take and return JSON:

```jsonc
// success
{ "data": { ... } }
// failure
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Not enough stock. …", "details": { "shortages": [ ... ] } } }
```

* **Authentication:** the `erp_session` cookie (set by `/api/auth/login`). Missing or invalid → 401.
* **Permission:** listed per endpoint. Missing → 403. Checked again inside the service.
* **Mutations** (POST/PATCH/DELETE) from a browser must come from the app's own origin.
* **Money and quantities are strings** (`"120.50"`, `"0.045"`). Empty optional money fields mean 0 (or "paid in full" for `amountReceived`, see Sales).
* **Idempotency:** endpoints that create stock documents accept `idempotencyKey` (any 8–100 char string; the UI sends a UUID). Resending the same key returns the original document (`replayed: true` where returned).
* Error codes and statuses: see [Architecture → Errors](architecture.md#errors-srcservererrorsts).

## Auth & system

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| POST | `/api/auth/login` | public | `{ username, password }` | `{ name, role }` + session cookie. 401 wrong/disabled, 429 rate limited |
| POST | `/api/auth/logout` | session (optional) | `{}` | `{ ok: true }`, cookie cleared |
| GET | `/api/auth/me` | signed in | — | `{ id, name, username, role, permissions[] }` |
| POST | `/api/auth/password` | signed in | `{ currentPassword, newPassword (≥6) }` | `{ ok: true }`; other sessions signed out |
| GET | `/api/health` | public | — | `{ status: "ok", db: "up", time }` or 503 `{ status: "error", db: "down" }` |
| GET | `/api/settings` | signed in | — | public settings (business details, currency, timezone, tax, negative-stock flag, footer) |
| PATCH | `/api/settings` | `settings.manage` | `settingsSchema`: `businessName, address, phone, email, gstin, currency, timezone, taxEnabled, taxRate, taxLabel, allowNegativeStock, invoiceFooter` | updated public settings |

## Products, variants, barcodes, categories, images

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| GET | `/api/products` | `products.view` | query `q, type, page, pageSize (5–200)` | `{ rows[], total }` (variant count, total stock, price range) |
| POST | `/api/products` | `products.manage` | `productCreateSchema`: `name, code, type, unit, categoryId?, subcategoryId?, supplierId?, brand?, description?, imageUrl?, isActive, variants[{ sku, barcode?, size?, color?, purchasePrice, sellingPrice, minStock?, reorderLevel?, openingStock?, isActive }]` (1–200) | product |
| GET | `/api/products/:id` | `products.view` | — | product with category, supplier, variants + stock + BOM flag |
| PATCH | `/api/products/:id` | `products.manage` | product fields (no variants) | product. Unit/type locked after stock movements. |
| POST | `/api/products/:id/variants` | `products.manage` | one variant (+ optional `openingStock`) | variant |
| PATCH | `/api/variants/:id` | `products.manage` | `sku, barcode?, size?, color?, purchasePrice, sellingPrice, minStock, reorderLevel, isActive` | variant (price change audited) |
| POST | `/api/variants/:id/barcode` | `products.manage` | `{ barcode }` | variant |
| GET | `/api/variants/search` | `products.view` | query `q, type?, limit (1–50, default 20), includeInactive=1?` | `VariantHit[]` |
| GET | `/api/variants/lookup` | `products.view` | query `code` | `VariantHit` or `null` (exact barcode, then SKU) |
| POST | `/api/variants/by-ids` | `products.view` | `{ ids[] (≤300) }` | `VariantHit[]` (fresh stock) |
| GET | `/api/barcodes/generate` | `products.manage` | — | `{ barcode }` (unused in-store EAN-13) |
| GET | `/api/categories` | `products.view` | — | `[{ id, name, parentId }]` |
| POST | `/api/categories` | `products.manage` | `{ name, parentId? }` | category |
| POST | `/api/uploads` | `products.manage` | multipart `file` (PNG/JPEG/WebP ≤ 2 MB) | `{ url: "/api/uploads/<id>" }` |
| GET | `/api/uploads/:id` | signed in | — | image bytes (immutable cache) |

`VariantHit`: `{ variantId, productId, name, productName, label, sku, barcode, size, color, unit, type, sellingPrice, purchasePrice, onHand, damaged, status, isActive, imageUrl }`.

## Inventory

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| POST | `/api/adjustments` | `inventory.adjust` | `{ reason (DAMAGE · DAMAGE_WRITE_OFF · LOST · FOUND · CORRECTION · OTHER), note (≥3), items[{ variantId, quantity, direction (IN/OUT, for CORRECTION/OTHER) }], idempotencyKey? }` | adjustment. 409 if stock would go negative. |

Inventory lists and ledgers are read by server pages directly from services (no API needed).

## Purchases

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| POST | `/api/purchases` | `purchases.create` (+ `purchases.receive` if `receiveNow`) | `{ supplierId, invoiceNumber?, purchaseDate (YYYY-MM-DD), items[{ variantId, quantity, rate, discount?, taxRate? }], discount?, amountPaid?, notes?, receiveNow (default true), idempotencyKey? }` | `{ id, number, status, replayed }` |
| POST | `/api/purchases/:id/receive` | `purchases.receive` | — | purchase (409 if not a draft) |
| POST | `/api/purchases/:id/cancel` | `purchases.cancel` | `{ reason (≥3) }` | purchase (409 already cancelled; 409 stock already used) |
| POST | `/api/purchases/:id/payment` | `purchases.create` | `{ amount }` | purchase |
| POST | `/api/supplier-returns` | `supplier_returns.create` | `{ purchaseId, reason, items[{ purchaseItemId, quantity, bucket (SELLABLE/DAMAGED) }], idempotencyKey? }` | supplier return |

## Sales

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| POST | `/api/sales` | `sales.create` | `{ customerId?, items[{ variantId, quantity, discount?, unitPrice? (needs sales.override_price if different) }] (1–300), billDiscount?, paymentMode (CASH/UPI/CARD/BANK/CREDIT), amountReceived? (empty = full; credit = 0), requiresDispatch, dispatchAddress?, notes?, idempotencyKey? }` | `{ id, number, total, changeGiven, replayed }` |
| GET | `/api/sales/:id` | `sales.view` | — | sale with lines, returns, dispatch |
| GET | `/api/sales/lookup` | `sales.view` | query `number` (case-insensitive) | sale (404 if unknown) |
| POST | `/api/sales/:id/payment` | `sales.create` | `{ amount, paymentMode }` | sale |
| POST | `/api/sales/:id/cancel` | `sales.cancel` | `{ reason (≥3) }` | sale (422 has returns / dispatched; 409 already cancelled) |

## Returns

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| POST | `/api/returns` | `returns.create` | `{ saleId, items[{ saleItemId, quantity, condition (GOOD/DAMAGED), reason }], refundMode, notes?, idempotencyKey? }` | `{ id, number, refundAmount, replayed }` (422 over the limit) |

## Dispatch

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| POST | `/api/dispatch` | `dispatch.manage` | `{ saleId, address?, notes? }` | dispatch (409 if one exists) |
| GET | `/api/dispatch/:id` | `dispatch.view` | — | dispatch with lines, barcodes, SKUs |
| POST | `/api/dispatch/:id/pack` | `dispatch.manage` | `{ items[{ dispatchItemId, scannedQty }] }` | dispatch (422 with `details.mismatches` if counts differ) |
| POST | `/api/dispatch/:id/ship` | `dispatch.manage` | `{ carrier?, trackingNumber? }` | dispatch (Packed → Dispatched) |
| POST | `/api/dispatch/:id/complete` | `dispatch.manage` | — | dispatch (Dispatched → Completed) |
| POST | `/api/dispatch/:id/unpack` | `dispatch.manage` | — | dispatch (Packed → Pending) |

## Manufacturing

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| GET | `/api/boms` | `manufacturing.view` | — | active BOMs with materials |
| POST | `/api/boms` | `manufacturing.manage_bom` | `{ variantId, outputQty, notes?, items[{ materialId, quantity }] (1–50), applyToAllVariants? }` | BOM |
| GET | `/api/boms/:id` | `manufacturing.view` | — | BOM |
| DELETE | `/api/boms/:id` | `manufacturing.manage_bom` | — | deactivated BOM |
| GET | `/api/production/preview` | `manufacturing.view` | query `bomId, quantity` | `{ bom, requirements[{ materialId, name, unit, perOutput, required, available, shortBy, sufficient, wholeUnitsOk }], canProduce }` |
| POST | `/api/production` | `manufacturing.produce` | `{ bomId, quantity, notes?, idempotencyKey? }` | `{ id, number, replayed }` (409 shortage, 400 fractional) |
| POST | `/api/production/:id/cancel` | `manufacturing.cancel` | `{ reason }` | production |

## Customers & suppliers

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| GET | `/api/customers` | `customers.view` | query `q` | up to 10 `{ id, name, phone, address }` (POS picker) |
| POST | `/api/customers` | `customers.manage` | `{ name, phone?, email?, address?, notes?, isActive? }` | customer (409 duplicate phone) |
| PATCH | `/api/customers/:id` | `customers.manage` | same | customer |
| GET | `/api/suppliers` | `suppliers.view` | query `q, page, pageSize` | `{ rows[], total }` with totals |
| POST | `/api/suppliers` | `suppliers.manage` | `{ name, phone?, email?, address?, gstin?, notes?, isActive? }` | supplier (409 duplicate name) |
| PATCH | `/api/suppliers/:id` | `suppliers.manage` | same | supplier |

## Users

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| GET | `/api/users` | `users.manage` | — | users (no password hashes) |
| POST | `/api/users` | `users.manage` | `{ name, username, email?, role, password }` | user |
| PATCH | `/api/users/:id` | `users.manage` | `{ name, email?, role, isActive, password? }` | user |

## Reports

| Method | Path | Permission | Input | Output |
|---|---|---|---|---|
| GET | `/api/reports/:kind/csv` | `reports.view` | `kind` = `sales` · `purchases` · `inventory` · `stock-movement` · `production`; query `range` (today/yesterday/week/month/last30/custom), `from`, `to` (YYYY-MM-DD), `status` (inventory), `type` (stock-movement) | `text/csv` download |

## Calling the API yourself

```bash
# sign in and keep the cookie
curl -c cookies.txt -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"…"}' https://your-erp.example.com/api/auth/login

# look up a barcode
curl -b cookies.txt "https://your-erp.example.com/api/variants/lookup?code=8900070000134"
```
