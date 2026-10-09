import { D, Decimal, money, qty, sum, type DecimalInput } from "./decimal";

// Central business calculations. Used by the POS/purchase UI for previews and
// by the server services for the authoritative values that get stored.

// ───────────── Units ─────────────

export const UNITS = ["PCS", "PAIR", "PACK", "DOZEN", "BOX", "KG", "GRAM", "METER", "ROLL"] as const;
export type UnitCode = (typeof UNITS)[number];

export const DECIMAL_UNITS: ReadonlySet<UnitCode> = new Set(["KG", "GRAM", "METER"]);

export const UNIT_LABELS: Record<UnitCode, string> = {
  PCS: "Pieces",
  PAIR: "Pairs",
  PACK: "Packs",
  DOZEN: "Dozens",
  BOX: "Boxes",
  KG: "Kilograms",
  GRAM: "Grams",
  METER: "Meters",
  ROLL: "Rolls",
};

export function unitAllowsDecimal(unit: string): boolean {
  return DECIMAL_UNITS.has(unit as UnitCode);
}

/** Returns an error message or null when the quantity is valid for the unit. */
export function validateQuantityForUnit(quantity: DecimalInput, unit: string): string | null {
  const q = D(quantity);
  if (!q.isFinite() || q.lte(0)) return "Quantity must be greater than zero";
  if (q.decimalPlaces() > 3) return "Quantity can have at most 3 decimal places";
  if (!unitAllowsDecimal(unit) && !q.isInteger()) return `Quantity must be a whole number for unit ${unit}`;
  if (q.gt(MAX_QUANTITY)) return `Quantity cannot exceed ${MAX_QUANTITY}`;
  return null;
}

export const MAX_QUANTITY = 1_000_000;
export const MAX_PRICE = 10_000_000;

// ───────────── Sales ─────────────

export interface SaleLineInput {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  discount?: DecimalInput;
}

export interface SaleLineResult {
  gross: Decimal; // qty * price
  discount: Decimal;
  lineTotal: Decimal; // gross - discount
  netAmount: Decimal; // share of final total (after bill discount and tax)
}

export interface SaleTotals {
  lines: SaleLineResult[];
  itemCount: Decimal;
  grossTotal: Decimal;
  lineDiscountTotal: Decimal;
  subtotal: Decimal; // after line discounts
  billDiscount: Decimal;
  taxable: Decimal;
  taxRate: Decimal;
  taxAmount: Decimal;
  total: Decimal;
}

export class CalculationError extends Error {}

/**
 * Allocates `total` across `weights` proportionally, rounding to 2dp, and puts the
 * rounding remainder on the largest weight so the parts always sum exactly.
 */
export function allocate(total: Decimal, weights: Decimal[]): Decimal[] {
  const weightSum = sum(weights);
  if (weights.length === 0) return [];
  if (weightSum.isZero()) return weights.map(() => new Decimal(0));
  const parts = weights.map((w) => money(total.times(w).div(weightSum)));
  const diff = total.minus(sum(parts));
  if (!diff.isZero()) {
    let maxIdx = 0;
    weights.forEach((w, i) => {
      if (w.gt(weights[maxIdx])) maxIdx = i;
    });
    parts[maxIdx] = parts[maxIdx].plus(diff);
  }
  return parts;
}

export function calculateSale(
  lines: SaleLineInput[],
  opts: { billDiscount?: DecimalInput; taxRate?: DecimalInput } = {},
): SaleTotals {
  const computed = lines.map((l) => {
    const gross = money(D(l.quantity).times(D(l.unitPrice)));
    const discount = money(l.discount);
    if (discount.lt(0)) throw new CalculationError("Discount cannot be negative");
    if (discount.gt(gross)) throw new CalculationError("Line discount cannot exceed the line amount");
    return { gross, discount, lineTotal: gross.minus(discount) };
  });

  const grossTotal = sum(computed.map((c) => c.gross));
  const lineDiscountTotal = sum(computed.map((c) => c.discount));
  const subtotal = sum(computed.map((c) => c.lineTotal));
  const billDiscount = money(opts.billDiscount);
  if (billDiscount.lt(0)) throw new CalculationError("Discount cannot be negative");
  if (billDiscount.gt(subtotal)) throw new CalculationError("Bill discount cannot exceed the subtotal");

  const taxRate = D(opts.taxRate);
  if (taxRate.lt(0) || taxRate.gt(100)) throw new CalculationError("Tax rate must be between 0 and 100");

  const taxable = subtotal.minus(billDiscount);
  const taxAmount = money(taxable.times(taxRate).div(100));
  const total = taxable.plus(taxAmount);

  const nets = allocate(total, computed.map((c) => c.lineTotal));

  return {
    lines: computed.map((c, i) => ({ ...c, netAmount: nets[i] })),
    itemCount: qty(sum(lines.map((l) => l.quantity))),
    grossTotal,
    lineDiscountTotal,
    subtotal,
    billDiscount,
    taxable,
    taxRate,
    taxAmount,
    total,
  };
}

export type PaymentStatusCode = "PAID" | "PARTIAL" | "UNPAID";
export type PaymentModeCode = "CASH" | "UPI" | "CARD" | "BANK" | "CREDIT";

export interface PaymentResult {
  amountReceived: Decimal;
  amountPaid: Decimal;
  change: Decimal;
  balanceDue: Decimal;
  status: PaymentStatusCode;
}

/** Payment outcome: change is returned only for cash; anything short is a balance due. */
export function calculatePayment(
  total: DecimalInput,
  amountReceived: DecimalInput,
  mode: PaymentModeCode,
): PaymentResult {
  const t = money(total);
  const received = money(amountReceived);
  if (received.lt(0)) throw new CalculationError("Amount received cannot be negative");
  if (mode !== "CASH" && mode !== "CREDIT" && received.gt(t)) {
    throw new CalculationError("Amount received cannot exceed the total for non-cash payments");
  }
  const amountPaid = Decimal.min(received, t);
  const change = mode === "CASH" ? Decimal.max(received.minus(t), 0) : new Decimal(0);
  const balanceDue = t.minus(amountPaid);
  const status: PaymentStatusCode = balanceDue.lte(0) ? "PAID" : amountPaid.gt(0) ? "PARTIAL" : "UNPAID";
  return { amountReceived: received, amountPaid, change, balanceDue, status };
}

// ───────────── Purchases ─────────────

export interface PurchaseLineInput {
  quantity: DecimalInput;
  rate: DecimalInput;
  discount?: DecimalInput;
  taxRate?: DecimalInput;
}

export function calculatePurchase(lines: PurchaseLineInput[], opts: { discount?: DecimalInput } = {}) {
  const computed = lines.map((l) => {
    const gross = money(D(l.quantity).times(D(l.rate)));
    const discount = money(l.discount);
    if (discount.lt(0)) throw new CalculationError("Discount cannot be negative");
    if (discount.gt(gross)) throw new CalculationError("Line discount cannot exceed the line amount");
    const base = gross.minus(discount);
    const taxRate = D(l.taxRate);
    if (taxRate.lt(0) || taxRate.gt(100)) throw new CalculationError("Tax rate must be between 0 and 100");
    const taxAmount = money(base.times(taxRate).div(100));
    return { gross, discount, base, taxRate, taxAmount, lineTotal: base.plus(taxAmount) };
  });
  const subtotal = sum(computed.map((c) => c.base));
  const taxAmount = sum(computed.map((c) => c.taxAmount));
  const discount = money(opts.discount);
  if (discount.lt(0)) throw new CalculationError("Discount cannot be negative");
  if (discount.gt(subtotal.plus(taxAmount))) throw new CalculationError("Discount cannot exceed the purchase total");
  const total = subtotal.plus(taxAmount).minus(discount);
  return {
    lines: computed,
    itemCount: qty(sum(lines.map((l) => l.quantity))),
    subtotal,
    taxAmount,
    discount,
    total,
  };
}

// ───────────── Returns ─────────────

/**
 * Refund for returning `returnQty` units of a sale line. The last return of a line
 * receives the exact remainder so that total refunds never exceed what was charged.
 */
export function calculateLineRefund(args: {
  soldQty: DecimalInput;
  alreadyReturnedQty: DecimalInput;
  netAmount: DecimalInput;
  alreadyRefunded: DecimalInput;
  returnQty: DecimalInput;
}): Decimal {
  const sold = D(args.soldQty);
  const returned = D(args.alreadyReturnedQty);
  const r = D(args.returnQty);
  if (r.lte(0)) throw new CalculationError("Return quantity must be greater than zero");
  const remaining = sold.minus(returned);
  if (r.gt(remaining)) {
    throw new CalculationError(`Cannot return ${r} — only ${remaining} remaining on this line`);
  }
  if (r.eq(remaining)) return money(D(args.netAmount).minus(D(args.alreadyRefunded)));
  return money(D(args.netAmount).times(r).div(sold));
}

export function maxReturnable(soldQty: DecimalInput, alreadyReturnedQty: DecimalInput): Decimal {
  return Decimal.max(D(soldQty).minus(D(alreadyReturnedQty)), 0);
}

// ───────────── Manufacturing ─────────────

/** Raw material requirement for producing `quantity` with a BOM defined per `outputQty`. */
export function requiredMaterial(perOutput: DecimalInput, outputQty: DecimalInput, quantity: DecimalInput): Decimal {
  const out = D(outputQty);
  if (out.lte(0)) throw new CalculationError("BOM output quantity must be greater than zero");
  return qty(D(perOutput).times(D(quantity)).div(out));
}

// ───────────── Stock status ─────────────

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export function stockStatus(onHand: DecimalInput, minStock: DecimalInput, reorderLevel?: DecimalInput): StockStatus {
  const q = D(onHand);
  if (q.lte(0)) return "OUT_OF_STOCK";
  const threshold = Decimal.max(D(minStock), D(reorderLevel));
  if (threshold.gt(0) && q.lte(threshold)) return "LOW_STOCK";
  return "IN_STOCK";
}
