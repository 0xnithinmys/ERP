# Customer returns

[← Back to index](README.md)

Files: `src/server/services/return.service.ts`, `src/features/returns/return-form.tsx`, `src/lib/calculations.ts` (`calculateLineRefund`, `maxReturnable`), pages `src/app/(app)/returns/*`.

A return is **a separate document linked to the original invoice**. The sale is never deleted or rewritten; only its "returned" and "refunded" counters go up.

## End to end

```mermaid
flowchart TD
    A["Process return (/returns/new)<br/>or 'Process return' on an invoice (?invoice=INV-…)"] --> B["Enter invoice number → Find invoice<br/>GET /api/sales/lookup?number= (case-insensitive)"]
    B -- not found --> NF["'Invoice INV-… not found'"]
    B --> C["Each line shows: sold, already returned,<br/>CAN RETURN, price each"]
    C --> D["For each item coming back:<br/>return qty · condition Good/Damaged · reason"]
    D --> E["Live refund preview per line and total"]
    E --> F["Refund mode (defaults to the sale's payment mode)<br/>+ notes"]
    F --> G["Confirm return → POST /api/returns"]
    G --> H{"server checks"}
    H -- fail --> X["toast with reason; the form reloads the invoice<br/>to show current limits"]
    H -- ok --> I["RET-xxxxx created → /returns/:id (printable return note)"]
```

## Where the stock goes

```mermaid
flowchart LR
    R["Returned item"] --> C{"condition"}
    C -- "Good" --> S["Sellable stock +qty<br/>(CUSTOMER_RETURN, bucket SELLABLE)<br/>can be sold again"]
    C -- "Damaged" --> D["Damaged stock +qty<br/>(CUSTOMER_RETURN, bucket DAMAGED)<br/>sellable stock unchanged"]
    D --> W["later: return to supplier from damaged stock<br/>or 'Write off damaged stock' adjustment"]
```

## The return limit

You can never return more than **sold − already returned** per invoice line:

```text
Sold = 10, already returned = 3  →  maximum additional return = 7
A request for 8 is rejected; 7 is accepted; after that the maximum is 0.
```

It's enforced in three places:

1. **Form:** shows "Maximum additional return is N" and disables *Confirm* when exceeded.
2. **Service:** an atomic conditional update per line:

   ```sql
   UPDATE "SaleItem" SET "returnedQty" = "returnedQty" + $q
   WHERE "id" = $line AND "returnedQty" + $q <= "quantity"
   RETURNING "quantity", "returnedQty", "netAmount", "refundedAmount";
   ```

   No row returned means the limit would be exceeded. The return fails with *"Cotton Socks (M / Black): sold 10, already returned 3 — maximum additional return is 7"*, and the whole return rolls back. Because the check and the increment are one statement under a row lock, **two returns submitted at the same time can't both pass**. The test "concurrent over-limit" proves only one succeeds.
3. **Database:** CHECK `0 ≤ returnedQty ≤ quantity`.

**Duplicate returns** (double-click, refresh) are prevented by the idempotency key. See [Inventory engine](inventory-engine.md#idempotency-no-double-posting).

## Other rules

| Rule | Message |
|---|---|
| Invoice must exist | "Invoice not found" |
| Cancelled invoices can't be returned | "Invoice INV-… is cancelled and cannot be returned" |
| Undispatched delivery orders (dispatch Pending/Packed) | "This order has not been dispatched yet. Cancel the sale instead of returning it." |
| The line must belong to the invoice | "Item does not belong to this invoice" |
| Whole-number units | "Quantity must be a whole number for unit PAIR" |
| Reason required | (form) "Select a reason" |

Reasons offered: *Size issue, Color mismatch, Defective / torn, Wrong item, Customer changed mind, Other*.

## Refund calculation

Each sale line stores `netAmount`: its share of the **final** invoice total, after line discount, bill discount and tax (see [Sales → totals](sales-pos.md#how-totals-are-calculated)). Refunds are based on what the customer actually paid for that line:

```text
calculateLineRefund(sold, alreadyReturned, netAmount, alreadyRefunded, returnQty):
  remaining = sold − alreadyReturned
  if returnQty = remaining:  refund = netAmount − alreadyRefunded     ← exact remainder
  else:                      refund = round2(netAmount × returnQty ÷ sold)
```

The last return of a line gets the exact remainder, so **partial returns always add up to the amount charged**, never a paisa more. Example: a line of 3 pairs for ₹100.00 refunds 33.33 + 33.33 + 33.34. A CHECK constraint keeps `refundedAmount ≤ netAmount`.

The refund total is stored on the return and added to `Sale.refundedAmount`. **Refund mode** records how the money went back (Cash, UPI, Card, Bank, or Credit = adjusted against balance / credit note). The ERP records the refund; it doesn't move money.

## What the server does: `createCustomerReturn()`

```mermaid
sequenceDiagram
    autonumber
    participant F as ReturnForm
    participant S as createCustomerReturn()
    participant DB
    F->>S: saleId, items[{saleItemId, quantity, condition, reason}], refundMode, notes, idempotencyKey
    S->>DB: key already used? → return that return
    S->>DB: BEGIN · load sale + lines + dispatch
    S->>S: sale exists, not cancelled, not awaiting dispatch
    S->>DB: nextNumber("RET")
    loop each line
        S->>DB: atomic returnedQty increment (limit check)
        S->>S: refund = calculateLineRefund(...)
        S->>DB: SaleItem.refundedAmount += refund
    end
    S->>DB: INSERT CustomerReturn + items
    S->>DB: Sale.refundedAmount += total refund
    S->>DB: CUSTOMER_RETURN movements (+qty, SELLABLE or DAMAGED)
    S->>DB: AuditLog return.create ("… 1 good / 1 damaged line(s), refund ₹…")
    S->>DB: COMMIT
```

## Where returns show up

| Place | What you see |
|---|---|
| Return note `/returns/[id]` | Items, quantity, condition, reason, refund each, total, refund mode. Printable. |
| Invoice `/sales/[id]` | "(returned N)" next to the line; returns card with links; refunded total |
| Customer page | Returns list and total refunds |
| Stock ledger | `Customer return` rows (Damaged rows marked) |
| Sales report | Returns count, quantity, value, and net sales |
| Audit log | `return.create` entries |
| Returns list `/returns` | Search by return number, invoice number or customer; good/damaged quantity badges, user, refund mode, amount |
