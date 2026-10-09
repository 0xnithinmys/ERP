# ROLE

You are a senior full-stack architect, UI/UX designer, backend engineer, database engineer, QA engineer, DevOps engineer, and product engineer.

Your job is to build a **complete, production-quality, fast, reliable, simple Hosiery Shop ERP**.

This is not a prototype, mockup, static frontend, demo, or partially implemented application.

You must implement the application **end-to-end**, including frontend, backend, database, authentication, authorization, barcode scanning, inventory calculations, purchases, sales, dispatch, returns, manufacturing, reports, validation, error handling, responsive UI, seed data, testing, and deployment readiness.

**Do not stop after generating code.**

You must continuously:

1. Implement.
2. Run the application.
3. Test it.
4. Find bugs.
5. Fix bugs.
6. Re-run tests.
7. Test the affected workflows again.
8. Test edge cases.
9. Improve performance and UX.
10. Continue until the complete system actually works.

Do not declare the project complete merely because the code compiles.

The project is complete only when the major workflows work end-to-end and the application passes functional, integration, UI, API, database, security, and edge-case testing.

---

# 1. PRODUCT REQUIREMENT

Build a **simple but powerful ERP for a hosiery business**.

The business primarily needs:

* Product management
* Barcode/SKU management
* Barcode scanning
* Inventory/stock management
* Supplier management
* Customer management
* Purchasing
* Sales/billing
* Dispatch
* Customer returns
* Damaged stock handling
* Manufacturing/production
* Raw materials
* Finished goods
* Stock ledger
* Low-stock tracking
* User roles and permissions
* Dashboard
* Basic reports
* Audit history

Do NOT turn this into an unnecessarily complicated SAP-style ERP.

The product must remain **simple for non-technical employees**.

Every important operation should require as few clicks as possible.

---

# 2. TECHNOLOGY STACK

Use modern stable technologies.

## Frontend

* Next.js
* App Router
* TypeScript
* Tailwind CSS
* shadcn/ui
* Lucide icons
* React Hook Form
* Zod
* TanStack Query where appropriate
* TanStack Table where appropriate

## Backend

Use a proper backend architecture.

Preferred:

* Next.js server architecture / Route Handlers / Server Actions where appropriate
* PostgreSQL
* Prisma ORM

The architecture must keep business logic separated from UI code.

Do NOT place all business logic directly inside React components.

Create clean service/domain layers.

Example:

```text
src/
  app/
  components/
  features/
  lib/
  server/
    services/
    repositories/
    validators/
    permissions/
  db/
  hooks/
  types/
```

Adapt the structure as appropriate, but keep the system modular.

---

# 3. CORE DESIGN PRINCIPLE

The most important part of this ERP is the **inventory transaction system**.

Do NOT make stock a manually editable number that gets changed randomly from different pages.

Stock must be derived from controlled inventory transactions.

Examples:

```text
Opening Stock        +100
Purchase             +200
Sale                  -20
Customer Return        +5
Supplier Return        -10
Damage                 -2
Manufacturing Output  +50
Raw Material Usage    -30
```

Current stock must be accurately maintained from these movements.

Every stock-changing action must create an inventory transaction.

Maintain a proper stock ledger/history.

---

# 4. PRODUCT MASTER

Create a complete product master.

Each product can contain:

* Product name
* Product code
* SKU
* Barcode
* Category
* Subcategory
* Brand
* Size
* Color
* Unit
* Purchase price
* Selling price
* Minimum stock level
* Reorder level
* Active/inactive status
* Description
* Product image

Hosiery products commonly have variants.

Design the system so products can have combinations such as:

```text
Cotton Socks
  Size: M
  Color: Black
```

and

```text
Cotton Socks
  Size: L
  Color: White
```

Each variant should be independently trackable.

A barcode should identify the correct variant.

---

# 5. BARCODE SYSTEM

Barcode scanning is a major requirement.

Implement:

## Scanner options

Support:

1. USB/Bluetooth barcode scanners that behave like keyboard input.
2. Camera-based barcode scanning on supported devices.

The barcode scanner should work inside:

* Sales
* Purchase
* Stock receiving
* Dispatch
* Returns
* Inventory lookup

When a barcode is scanned:

```text
Barcode
   ↓
Find product variant
   ↓
Add product / identify product
   ↓
Use the correct price and stock information
```

Unknown barcode behavior:

```text
Unknown Barcode
      ↓
Show clear message
      ↓
"Product not found"
      ↓
Provide "Create Product" / "Register Barcode"
```

Do not make scanning slow.

Optimize for repeated scanning.

For billing:

```text
SCAN → PRODUCT ADDED → READY FOR NEXT SCAN
```

No unnecessary modal every time.

Support quantity changes from keyboard.

---

# 6. SALES / BILLING

Build a very fast POS-style sales screen.

The sales screen should include:

* Barcode scanner input
* Camera scanner button
* Search products
* Product grid/list
* Cart
* Quantity controls
* Price
* Discount
* Tax configuration if required
* Customer selection
* Payment amount
* Payment status
* Total
* Balance/change
* Invoice generation
* Print invoice
* Save sale
* Cancel sale
* Hold/restore cart if useful

The main workflow:

```text
Open Sales
↓
Scan barcode
↓
Item appears in cart
↓
Scan next item
↓
Adjust quantity if required
↓
Select customer if required
↓
Payment
↓
Confirm Sale
↓
Invoice generated
↓
Inventory decreases
↓
Sale stored
```

Do not deduct stock before the final transaction is successfully committed.

Use database transactions so partial failures cannot corrupt stock.

---

# 7. PURCHASE MODULE

Create purchase workflow.

Purchase fields:

* Supplier
* Invoice/reference number
* Date
* Products
* Quantities
* Purchase rate
* Discount if applicable
* Tax if applicable
* Total
* Payment status
* Notes

Workflow:

```text
Create Purchase
↓
Add products using search/barcode
↓
Enter quantities
↓
Enter rates
↓
Confirm receipt
↓
Inventory increases
```

Purchase confirmation must happen atomically.

If the database transaction fails, neither the purchase nor inventory update should partially succeed.

---

# 8. SUPPLIER MANAGEMENT

Supplier fields:

* Name
* Phone
* Email
* Address
* GST/tax identifier if needed
* Notes
* Active/inactive

Supplier page should show:

* Purchase history
* Outstanding payable amount if implemented
* Total purchases
* Recent transactions

Keep accounting simple unless explicitly required.

---

# 9. CUSTOMER MANAGEMENT

Customer fields:

* Name
* Phone
* Email
* Address
* Notes

Customer page:

* Purchase history
* Returns
* Total sales
* Recent invoices

Customer selection during billing should be fast.

Do not force employees to create a customer for every walk-in sale.

Support:

```text
Walk-in Customer
```

---

# 10. DISPATCH MODULE

Create a dispatch workflow.

Orders/sales can have states such as:

```text
Pending
Confirmed
Packed
Dispatched
Completed
Cancelled
```

The UI must clearly display status.

Dispatch should support barcode verification.

Recommended workflow:

```text
Sale
 ↓
Packing
 ↓
Scan items
 ↓
Verify quantities
 ↓
Dispatch
```

If the item scanned is not part of the order:

```text
Warning:
"This item does not belong to this order."
```

If quantity is incorrect:

```text
Warning:
"Required: 5
Scanned: 4"
```

Do not allow accidental incorrect dispatch.

---

# 11. CUSTOMER RETURN MODULE

Customer returns are critical.

Do NOT delete or overwrite the original sale.

Create a separate return transaction linked to the original invoice.

Return workflow:

```text
Find Invoice
↓
Select item
↓
Enter returned quantity
↓
Select reason
↓
Select condition
    Good
    Damaged
↓
Confirm Return
```

If Good:

```text
Inventory + quantity
```

If Damaged:

```text
Damaged Stock + quantity
```

The return should also be visible in:

* Invoice history
* Customer history
* Stock ledger
* Reports
* Audit history

Prevent returning more than the originally sold quantity minus previously returned quantity.

Example:

```text
Sold = 10
Already returned = 3
Maximum additional return = 7
```

The system must reject 8.

---

# 12. DAMAGE / STOCK ADJUSTMENT

Create controlled inventory adjustment functionality.

Reasons:

* Damage
* Lost
* Found
* Correction
* Other

Stock adjustments must require a reason.

Do not allow arbitrary silent edits to stock.

Example:

```text
Current Stock: 100

Damage:
Quantity: 3
Reason: Product damaged

New Stock: 97
```

Record who performed the adjustment and when.

---

# 13. MANUFACTURING / PRODUCTION

Only include manufacturing because the business may manufacture hosiery.

Keep it SIMPLE.

Do not build a complex MRP system.

Support:

### Raw Materials

Examples:

* Yarn
* Elastic
* Labels
* Packaging

### Finished Goods

Examples:

* Socks
* Gloves
* Other hosiery items

Create a simple Bill of Materials.

Example:

```text
Cotton Socks — 1 pair

Yarn       0.05 kg
Elastic    1 piece
Label      1 piece
Packaging  1 piece
```

Production workflow:

```text
Create Production
↓
Select finished product
↓
Enter quantity
↓
System calculates required raw materials
↓
Check raw-material availability
↓
Confirm production
↓
Raw materials decrease
↓
Finished goods increase
```

All of this must happen in ONE database transaction.

If insufficient raw material exists:

```text
Cannot complete production.

Required:
Yarn: 10 kg

Available:
Yarn: 7 kg
```

Do not allow negative stock unless there is an explicit configuration for it.

---

# 14. INVENTORY

Create a proper inventory screen.

Show:

* Product
* SKU
* Barcode
* Variant
* Current quantity
* Reserved quantity if applicable
* Available quantity
* Minimum level
* Status

Statuses:

```text
In Stock
Low Stock
Out of Stock
```

Provide inventory search and filters.

Filters:

* Category
* Size
* Color
* Supplier
* Low stock
* Out of stock

---

# 15. STOCK LEDGER

Every product must have a detailed stock movement history.

Example:

```text
Date
Transaction Type
Reference
Quantity In
Quantity Out
Balance
User
```

Example:

```text
10 Oct
Purchase
PUR-1023
+100
100

11 Oct
Sale
SAL-2001
-10
90

12 Oct
Return
RET-3002
+2
92
```

Stock history should be auditable.

---

# 16. DASHBOARD

Create a clean business dashboard.

Show only useful information.

Cards:

```text
Today's Sales
Today's Purchases
Current Inventory Value
Low Stock Items
Out of Stock Items
Pending Dispatch
Today's Returns
```

Charts should remain lightweight.

Potential charts:

* Sales over time
* Purchase over time
* Top-selling products
* Stock movement

Do not over-design the dashboard.

The user should understand it in seconds.

---

# 17. ROLES AND PERMISSIONS

Implement role-based access control.

Minimum roles:

## ADMIN / OWNER

Full access:

* Dashboard
* Products
* Inventory
* Purchases
* Sales
* Dispatch
* Returns
* Manufacturing
* Suppliers
* Customers
* Reports
* Users
* Settings

## STORE / WAREHOUSE

Can:

* View inventory
* Receive stock
* Scan products
* Process dispatch
* Process returns
* View purchase information where appropriate

Cannot:

* Manage users
* Delete important transactions
* Change system settings

## SALES / BILLING

Can:

* Create sales
* Scan products
* Generate invoices
* Manage customers
* Process authorized returns

Cannot:

* Change inventory directly
* Manage users
* Modify system settings

Create the authorization system in a central place so permissions cannot be bypassed merely by directly calling an API.

---

# 18. AUTHENTICATION

Implement secure authentication.

Requirements:

* Login
* Logout
* Protected routes
* Password hashing
* Session management
* Role authorization
* Unauthorized page
* Proper server-side permission checks

Never rely solely on frontend role checks.

Every sensitive API/server action must verify authorization server-side.

---

# 19. DATABASE

Use PostgreSQL + Prisma.

Create proper relational models.

At minimum consider:

```text
User
Role
Permission
Product
ProductVariant
Category
Supplier
Customer
Purchase
PurchaseItem
Sale
SaleItem
Dispatch
DispatchItem
Return
ReturnItem
InventoryTransaction
StockAdjustment
RawMaterial
BillOfMaterial
BillOfMaterialItem
Production
ProductionItem
AuditLog
```

Modify the schema intelligently based on the final architecture.

Use:

* Foreign keys
* Unique constraints
* Indexes
* Transactions
* Cascading rules where appropriate
* Soft deletion where appropriate
* Created/updated timestamps

Add indexes for common queries:

* SKU
* Barcode
* Product name
* Invoice number
* Supplier
* Customer
* Transaction dates

---

# 20. INVENTORY CONSISTENCY

This is extremely important.

Prevent:

* Double stock deduction
* Duplicate return
* Duplicate purchase posting
* Duplicate production posting
* Duplicate dispatch
* Race-condition stock corruption

Use database transactions.

Design APIs to be idempotent where appropriate.

For critical workflows, use:

```text
Validate
↓
Lock/check relevant records where needed
↓
Create business transaction
↓
Create inventory transactions
↓
Commit
```

If any step fails:

```text
ROLLBACK EVERYTHING
```

No partial inventory updates.

---

# 21. SPEED / PERFORMANCE

The ERP must feel fast even on normal office computers.

Requirements:

* Fast initial load
* Server-side data fetching where appropriate
* Pagination for large tables
* Debounced search
* Efficient database queries
* Proper indexes
* Avoid unnecessary client rendering
* Lazy-load heavy functionality
* Cache suitable read-heavy queries
* Avoid fetching entire inventory tables unnecessarily
* Barcode scanning should feel instant
* POS screen should remain responsive during rapid scanning

Do not sacrifice correctness for speed.

---

# 22. UI/UX REQUIREMENTS

Use **Tailwind CSS + shadcn/ui**.

The interface should look like a modern premium business application.

Design principles:

* Clean
* Minimal
* Professional
* Fast
* Responsive
* Accessible
* Consistent
* Easy for non-technical employees

Desktop-first because the ERP will primarily be used in a shop/office, but it must remain usable on tablets and mobile devices.

Use:

* Sidebar navigation
* Top header
* Breadcrumbs where useful
* Cards
* Tables
* Tabs
* Dialogs
* Drawers
* Dropdown menus
* Toast notifications
* Confirmation dialogs
* Empty states
* Loading skeletons
* Error states
* Tooltips
* Keyboard shortcuts where useful

Do NOT turn every action into a modal.

Use drawers/pages for workflows that contain several fields.

---

# 23. POS UI

The sales screen is one of the most important screens.

Optimize it heavily.

Suggested layout:

```text
┌─────────────────────────────────────────────────────────┐
│ Search / Scan Barcode                                  │
├───────────────────────────────┬─────────────────────────┤
│ Products                      │ Current Cart            │
│                               │                         │
│ Product cards/list             │ Item 1       ₹120      │
│                               │ Item 2       ₹450      │
│                               │ Item 3       ₹240      │
│                               │                         │
│                               │ ----------------------  │
│                               │ TOTAL       ₹810        │
│                               │                         │
│                               │ [PAY & COMPLETE]        │
└───────────────────────────────┴─────────────────────────┘
```

Make keyboard workflows extremely fast.

Suggested shortcuts:

```text
Ctrl/Cmd + K → Product search
F2 → Focus barcode
F4 → Payment
Esc → Close active dialog
```

Use appropriate shortcuts without breaking browser conventions.

---

# 24. SEARCH

Build excellent global/product searching.

Search by:

* Product name
* SKU
* Barcode
* Product code
* Variant
* Size
* Color

Search should return quickly.

For the POS, support fuzzy-ish useful search but do not make it unpredictable.

---

# 25. PRINTING

Implement printable invoice/document layouts.

Invoice should contain:

* Business name
* Invoice number
* Date
* Customer
* Products
* Quantity
* Unit price
* Discount if any
* Total
* Payment status

Make it printer-friendly.

Also support PDF/print through a clean browser-compatible print layout where practical.

---

# 26. REPORTS

Keep reports useful and simple.

Implement at minimum:

### Sales Report

Filters:

* Today
* Yesterday
* This week
* This month
* Custom range

Show:

* Number of sales
* Sales value
* Items sold
* Returns

### Purchase Report

Show:

* Purchase count
* Purchase value
* Items purchased

### Inventory Report

Show:

* Current stock
* Low stock
* Out of stock

### Stock Movement Report

Show:

* Purchases
* Sales
* Returns
* Adjustments
* Production

### Production Report

Show:

* Production quantity
* Raw material consumption
* Finished goods produced

Export useful tables to CSV where appropriate.

---

# 27. AUDIT LOG

Important actions should be auditable.

Record:

* User
* Action
* Entity
* Entity ID
* Timestamp
* Important changes

Examples:

```text
Admin created product
Employee created sale
Warehouse received purchase
Admin adjusted stock
Employee processed return
Admin changed selling price
```

Never silently modify critical historical records.

---

# 28. DATA VALIDATION

Every form must have strong validation.

Use Zod.

Validate:

* Required fields
* Positive quantities
* Valid prices
* Valid barcode
* Duplicate SKU
* Duplicate barcode
* Return limits
* Stock availability
* Production requirements
* Required supplier/customer data

Show clear user-friendly errors.

Never expose raw database exceptions to users.

---

# 29. ERROR HANDLING

Implement proper error handling everywhere.

Handle:

* Network failures
* Database failures
* Invalid input
* Unauthorized requests
* Missing products
* Missing invoices
* Duplicate barcode
* Insufficient stock
* Invalid returns
* Failed transactions

Create reusable error handling.

Do not leave console errors unresolved.

---

# 30. EMPTY / LOADING / ERROR STATES

Every major page must have:

### Loading

Use skeletons.

### Empty

Example:

```text
No purchases yet.

Create your first purchase to start tracking inventory.
```

### Error

Example:

```text
Something went wrong while loading inventory.

[Try Again]
```

Do not leave blank pages.

---

# 31. RESPONSIVENESS

The application must work on:

* Desktop
* Laptop
* Tablet
* Mobile where practical

POS and warehouse workflows should remain usable on smaller screens.

---

# 32. ACCESSIBILITY

Use shadcn primitives correctly.

Ensure:

* Keyboard navigation
* Focus states
* ARIA labels where needed
* Form labels
* Accessible dialogs
* Good contrast
* Screen-reader-friendly controls

---

# 33. SEED DATA

Create realistic seed data.

Include:

* Admin user
* Store user
* Sales user
* Product categories
* Products
* Product variants
* Suppliers
* Customers
* Example purchases
* Example sales
* Example returns
* Raw materials
* BOM
* Production records

Clearly document test credentials in development documentation.

---

# 34. TESTING

Testing is mandatory.

Implement unit tests for business logic.

Test:

### Inventory

* Purchase increases stock
* Sale decreases stock
* Return increases stock
* Damaged return goes to damaged stock
* Stock adjustment works
* Manufacturing consumes raw material
* Manufacturing produces finished goods

### Returns

* Cannot return more than sold
* Multiple partial returns work correctly
* Duplicate return is prevented

### Sales

* Cart calculations
* Quantity calculations
* Discounts
* Final total
* Inventory deduction

### Purchases

* Purchase totals
* Inventory increase

### Manufacturing

* Insufficient material rejection
* Successful production
* Correct raw-material reduction
* Correct finished-goods increase

### Authorization

* Admin access
* Store permissions
* Sales permissions
* Unauthorized request rejection

---

# 35. END-TO-END TESTING

Create end-to-end tests for critical flows.

At minimum:

## Flow 1 — Purchase

```text
Login
→ Create Purchase
→ Add Product
→ Receive Quantity
→ Confirm
→ Open Inventory
→ Verify Stock Increased
```

## Flow 2 — Sale

```text
Login
→ Open POS
→ Scan Product
→ Add Quantity
→ Complete Payment
→ Verify Invoice
→ Verify Stock Decreased
```

## Flow 3 — Return

```text
Create Sale
→ Open Return
→ Select Invoice
→ Return Item
→ Confirm
→ Verify Inventory Increased
```

## Flow 4 — Damaged Return

```text
Sale
→ Return Item
→ Mark Damaged
→ Confirm
→ Verify Sellable Stock unchanged
→ Verify Damaged Stock increased
```

## Flow 5 — Dispatch

```text
Create Sale
→ Open Dispatch
→ Scan Items
→ Verify
→ Dispatch
→ Verify Status
```

## Flow 6 — Manufacturing

```text
Create Raw Materials
→ Create BOM
→ Create Production
→ Verify Material Availability
→ Confirm
→ Verify Raw Material Decrease
→ Verify Finished Goods Increase
```

---

# 36. EDGE CASE TESTING

Do not only test happy paths.

Test:

* Zero quantity
* Negative quantity
* Duplicate barcode
* Duplicate SKU
* Empty cart
* Returning too many items
* Selling unavailable stock
* Manufacturing without materials
* Double clicking Confirm
* Refreshing during transaction
* Network error
* Database error
* Unauthorized API call
* Two users modifying the same stock
* Very large quantities
* Decimal quantities where applicable
* Product deactivation
* Deleted supplier/product references
* Duplicate invoice submission

Fix every discovered issue.

---

# 37. SECURITY

Implement proper security.

Do not:

* Trust role information from client requests
* Trust hidden form fields
* Store plain-text passwords
* Expose database credentials
* Expose secret keys to frontend
* Accept arbitrary SQL
* Allow unauthorized stock modification
* Allow users to bypass frontend restrictions through APIs

Use:

* Secure environment variables
* Password hashing
* Server-side permission checks
* Input validation
* Parameterized database access
* Safe error messages
* Proper session handling

---

# 38. DATABASE MIGRATIONS

Use proper migrations.

Do not repeatedly destroy the database to make the application work.

The final project must support:

```text
Fresh database
→ migrate
→ seed
→ application works
```

Document setup commands clearly.

---

# 39. ENVIRONMENT CONFIGURATION

Create:

```text
.env.example
```

with required variables.

Never commit secrets.

Document:

* Database URL
* Authentication configuration
* App URL
* Any scanner/library configuration
* Optional storage configuration

---

# 40. LOGGING

Create useful server-side logs for important failures.

Do not flood production logs with unnecessary noise.

Use consistent error messages.

---

# 41. ARCHITECTURE QUALITY

Do not produce one giant file.

Separate:

* UI
* Components
* Forms
* API
* Database
* Business logic
* Validation
* Authorization
* Utilities
* Types

Create reusable components.

Do not duplicate logic.

If a calculation is used in multiple places, centralize it.

---

# 42. BUSINESS RULES

These are mandatory.

### Sale

```text
Stock must be available.
Sale confirmation decreases stock.
```

### Purchase

```text
Purchase receipt increases stock.
```

### Customer Return

```text
Good return increases sellable stock.
Damaged return increases damaged stock.
```

### Supplier Return

```text
Supplier return decreases stock.
```

### Damage

```text
Damage decreases sellable stock.
```

### Production

```text
Raw materials decrease.
Finished goods increase.
```

### Cancellation

A confirmed inventory-changing transaction must not simply be deleted.

Use reversal/appropriate cancellation logic so the stock ledger remains correct.

---

# 43. DATA INTEGRITY

Never allow the following situation:

```text
Sale says 10 items sold
but inventory says only 5 items removed
```

or:

```text
Return exists
but stock was never restored
```

or:

```text
Purchase exists
but inventory didn't increase
```

Every inventory-changing document must be linked to its inventory transaction(s).

---

# 44. UI DETAILS

Use polished components.

Buttons should communicate actions:

```text
Add Product
Create Purchase
Receive Stock
Create Sale
Complete Payment
Process Return
Dispatch
Start Production
```

Use confirmation dialogs for destructive/irreversible actions.

Use toast messages:

```text
Sale completed successfully
Stock updated successfully
Return processed successfully
Purchase received successfully
```

---

# 45. MOBILE BARCODE SCANNING

Where browser/device support permits, provide camera scanning.

When scanner is opened:

```text
┌─────────────────────────┐
│     Scan Barcode        │
│                         │
│     [ Camera View ]     │
│                         │
│ Align barcode here      │
│                         │
│ [Close]                 │
└─────────────────────────┘
```

After successful scan:

```text
Beep/visual feedback
Product identified
Scanner remains ready for next scan
```

Prevent duplicate accidental scans.

---

# 46. PERFORMANCE RULE

Do NOT implement features in a way that makes barcode scanning or POS slow.

For example:

Bad:

```text
Every scan
→ full page refresh
→ refetch entire inventory
→ reload everything
```

Good:

```text
Scan
→ identify product
→ update local cart immediately
→ only submit final transaction when confirmed
```

Use optimistic UI carefully where safe.

---

# 47. TRANSACTION SAFETY

For operations like:

* Sale
* Purchase
* Return
* Production
* Stock adjustment

Use database transactions.

The principle must always be:

```text
Either the complete operation succeeds
OR
nothing changes.
```

No partial operations.

---

# 48. DELETE POLICY

Never allow users to casually delete historical sales, purchases, returns, or inventory transactions.

Historical documents should be preserved.

Use cancellation/reversal logic.

Products that are no longer sold can be marked:

```text
Inactive
```

rather than physically deleting important historical references.

---

# 49. FRONTEND ROUTES

Create a sensible application structure such as:

```text
/login

/dashboard

/products
/products/[id]

/inventory
/inventory/[productId]

/purchases
/purchases/new
/purchases/[id]

/sales
/sales/new
/sales/[id]

/dispatch
/dispatch/[id]

/returns
/returns/new

/manufacturing
/manufacturing/new

/suppliers
/customers

/reports/sales
/reports/purchases
/reports/inventory
/reports/stock-movement
/reports/production

/users

/settings
```

Adjust based on architecture, but keep navigation intuitive.

---

# 50. SIDEBAR

Use a clean sidebar:

```text
Dashboard

Sales
Purchases
Dispatch
Returns

Inventory
Products

Manufacturing

Suppliers
Customers

Reports

Users
Settings
```

Group logically.

Do not overload the sidebar.

---

# 51. COMMAND / QUICK ACTIONS

Implement a quick action mechanism where useful.

Examples:

```text
New Sale
New Purchase
Scan Product
Add Product
Process Return
View Inventory
```

This improves employee speed.

---

# 52. DATABASE SEARCH PERFORMANCE

Do not load all products every time the user types.

Use server-side search/pagination where appropriate.

For barcode lookup:

```text
barcode → indexed exact lookup
```

This should be extremely fast.

---

# 53. NUMERIC PRECISION

Do not use unsafe floating-point arithmetic for financial calculations.

Use appropriate decimal/numeric database types and consistent monetary calculations.

Prevent:

```text
₹100.10 + ₹200.20 = ₹300.30000000004
```

Financial calculations must be exact.

---

# 54. TIME AND DATES

Use consistent server-side date handling.

Store timestamps consistently.

Display them according to configured business timezone.

Avoid inconsistent date calculations between frontend and backend.

---

# 55. FINAL QUALITY BAR

Before saying the application is complete, perform a full audit.

Check:

### Frontend

* Every page loads
* No broken routes
* No console errors
* Forms work
* Buttons work
* Loading states work
* Error states work
* Responsive UI works
* Barcode scanner works
* POS works

### Backend

* All APIs/server actions work
* Authorization works
* Validation works
* Transactions work
* Errors are handled
* No accidental data corruption

### Database

* Migrations work
* Seed works
* Relations work
* Constraints work
* Indexes exist

### Business logic

* Purchase → stock +
* Sale → stock -
* Return → stock +
* Damage → stock -
* Production → raw material - / finished goods +
* Dispatch status works

### Security

* Unauthorized access rejected
* Passwords protected
* Secrets protected
* Server-side permissions enforced

### Performance

* Search fast
* Barcode lookup fast
* POS responsive
* Large tables paginated
* No unnecessary requests

---

# 56. DEVELOPMENT LOOP — VERY IMPORTANT

You must behave like an autonomous senior engineer.

For every feature:

```text
Implement
↓
Run
↓
Test
↓
Observe failure
↓
Fix
↓
Retest
↓
Check related functionality
↓
Continue
```

Do NOT say:

> "This should work."

Actually verify it.

Do NOT say:

> "Testing can be done later."

Testing must happen during implementation.

Do NOT leave:

```text
TODO
FIXME
Coming soon
Mock data
Placeholder
Fake API
Dummy button
Unimplemented handler
```

in the final implementation.

Every important button and feature must actually work.

---

# 57. WHEN A BUG IS FOUND

Do not stop.

Immediately:

1. Reproduce it.
2. Identify the root cause.
3. Fix the root cause.
4. Add or update a test.
5. Re-run the affected test.
6. Re-run related tests.
7. Continue.

Do not patch symptoms while leaving the underlying architecture broken.

---

# 58. WHEN REQUIREMENTS ARE AMBIGUOUS

Do not unnecessarily stop the implementation.

Choose the simplest sensible business behavior consistent with the requirements.

Document the assumption.

Prefer simple workflows because the client specifically does not want a confusing ERP.

---

# 59. FINAL ACCEPTANCE TEST

Before finishing, simulate a real day in the hosiery shop.

Perform:

```text
1. Login as Admin
2. Create products
3. Create variants
4. Add barcodes
5. Create supplier
6. Create customer
7. Receive purchase
8. Verify inventory increased
9. Sell products using barcode scanning
10. Verify inventory decreased
11. Create dispatch
12. Scan/verify dispatch items
13. Complete dispatch
14. Process customer return
15. Mark one return Good
16. Mark another return Damaged
17. Verify stock correctly changed
18. Create raw materials
19. Create BOM
20. Produce finished goods
21. Verify raw material decreased
22. Verify finished goods increased
23. Check stock ledger
24. Check sales report
25. Check purchase report
26. Check inventory report
27. Check audit log
28. Test user permissions
29. Test invalid operations
30. Test duplicate operations
31. Test refreshing during workflows
32. Test error recovery
33. Test mobile/tablet layout
34. Test barcode scanner repeatedly
35. Test printing invoice
```

Every step must work.

---

# 60. DEFINITION OF DONE

The project is NOT DONE when:

* The UI looks good.
* The code compiles.
* The pages exist.
* The APIs exist.
* The database exists.

The project is DONE only when:

```text
FULL STACK IMPLEMENTED
+
DATABASE WORKING
+
AUTHENTICATION WORKING
+
AUTHORIZATION WORKING
+
BARCODE SCANNING WORKING
+
PURCHASE WORKING
+
SALES WORKING
+
STOCK UPDATES CORRECTLY
+
DISPATCH WORKING
+
RETURNS WORKING
+
DAMAGED STOCK WORKING
+
MANUFACTURING WORKING
+
RAW MATERIALS WORKING
+
FINISHED GOODS WORKING
+
STOCK LEDGER WORKING
+
REPORTS WORKING
+
AUDIT LOG WORKING
+
VALIDATION WORKING
+
ERROR HANDLING WORKING
+
RESPONSIVE UI
+
PERFORMANCE OPTIMIZED
+
TESTS PASSING
+
EDGE CASES HANDLED
+
NO CRITICAL BUGS
```

---

# 61. FINAL INSTRUCTION TO THE AGENT

**Do not stop at partial implementation.**

Continue working autonomously until the entire application is implemented, integrated, tested, debugged, and verified.

Whenever you discover a failure, fix it and continue.

Whenever a feature exposes another required dependency, implement the dependency.

Whenever a test reveals a business-logic problem, correct the architecture rather than hiding the problem.

Do not replace real functionality with mock functionality just to make tests pass.

Do not mark tasks as complete simply because files were created.

Actually run the application and verify behavior.

At the end, provide:

1. What was implemented.
2. Final architecture.
3. Database schema overview.
4. Main routes/pages.
5. User roles.
6. Test results.
7. Any assumptions made.
8. Exact commands to run the project locally.
9. Exact commands to migrate and seed the database.
10. Production deployment instructions.
11. Any remaining non-critical limitations.

But **do not stop implementation merely to report progress**.

Your primary objective is:

> **Build the complete working Hosiery ERP, test every critical workflow, fix every discovered issue, and only finish when the system is genuinely usable end-to-end.**
