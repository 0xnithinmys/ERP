# Users, settings & audit log

[← Back to index](README.md)

All three are admin-only.

## Users (`/users`, `users.manage`)

Files: `src/server/services/user.service.ts`, `src/features/admin/users-manager.tsx`.

* The table shows name, username, role, last sign-in and status.
* **Add user** (drawer): full name, username, optional email, role, password (≥ 6 chars) → `POST /api/users`.
* **Edit** (drawer): name, email, role, active, optional new password → `PATCH /api/users/:id`. The username can't be changed.

Safety rules, session handling and auditing are described in [Authentication → User management](security-auth.md#user-management-admin). In short: you can't lock yourself out, the last admin is protected, and any role/status/password change signs that user out everywhere.

## Settings (`/settings`, `settings.manage`)

Files: `src/server/services/settings.service.ts`, `src/features/admin/settings-form.tsx`, `src/validators/settings.ts`. `PATCH /api/settings` saves; `GET /api/settings` returns the public settings to any signed-in user.

| Setting | Used by | Effect |
|---|---|---|
| Business name | sidebar, login page, invoices, return notes | required |
| Address, phone, email, GSTIN | invoice header | optional |
| Timezone | dashboard, reports, every date shown | must be a valid IANA zone (e.g. `Asia/Kolkata`) |
| Currency | money formatting | INR, USD, EUR, GBP or AED |
| Invoice footer | bottom of invoices | e.g. exchange policy |
| Charge tax on sales + tax label + rate | POS totals and invoices | label default "GST"; rate 0–100 %, 2 decimals. Each sale stores the rate it used, so changing it never alters old invoices. |
| Allow negative stock | sales only | off by default. When on, sales may take sellable stock below 0. Adjustments, supplier returns and production never go negative. |

The settings row (`id = 1`) is created automatically with defaults the first time anything reads it, using an atomic `INSERT … ON CONFLICT DO NOTHING`, so concurrent first requests can't clash. Saving writes an audit entry `settings.update` with the changed fields.

## Audit log (`/audit`, `audit.view`)

Files: `src/server/services/audit.service.ts`, `src/features/admin/audit-changes.tsx`.

### How entries are written

```ts
await audit(tx, actor, {
  action: "sale.create",
  entity: "Sale",
  entityId: sale.id,
  summary: "Created sale INV-00048 for Ravi Textiles — ₹787.50 (paid)",
  changes: { items: [...] },
});
```

* Called **inside the same transaction** as the business change, so an entry exists if and only if the change committed.
* Stores user, action, entity, entity ID, a human-readable summary, optional JSON `changes` and the user's IP.
* `diff(before, after)` produces `{ field: { from, to } }` for edits.
* The app never edits or deletes audit entries.

### What gets audited

| Area | Actions |
|---|---|
| Sign-in | `auth.login` |
| Products | `product.create`, `product.update`, `product.deactivate`, `variant.create`, `variant.update`, `variant.price_change`, `variant.barcode`, `category.create` |
| Parties | `supplier.create`, `supplier.update`, `customer.create`, `customer.update` |
| Purchases | `purchase.create` (draft), `purchase.receive`, `purchase.cancel`, `purchase.payment`, `supplier_return.create` |
| Sales | `sale.create`, `sale.cancel`, `sale.payment` |
| Returns | `return.create` |
| Dispatch | `dispatch.create`, `dispatch.pack`, `dispatch.dispatched`, `dispatch.completed`, `dispatch.pending` (re-opened) |
| Stock | `stock.adjust` |
| Manufacturing | `bom.save`, `bom.deactivate`, `production.create`, `production.cancel` |
| Admin | `user.create`, `user.update`, `user.password`, `settings.update` |

Example summaries:

* `Created product Thermal Socks (TS123) with 4 variant(s)`
* `Received purchase PUR-00009 from Erode Knit Works — 6 item(s), ₹12,474.00`
* `Adjusted stock (Damage (move to damaged stock)) ADJ-00002: Cotton Vest (85 / White) −2 — Water damage in storeroom`
* `Changed selling price of Cotton Crew Socks — M / Black from 120.00 to 130.00`
* `Updated user priya: role SALES → STORE, password reset`

### The page

Newest first, 50 per page. Search the summary text; filter by record type (Sale, Purchase, Product…) and by user. Each row shows when, who, the action code and the summary; *Show changes* expands the JSON details.
