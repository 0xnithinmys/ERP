import Decimal from "decimal.js";

// Exact decimal arithmetic for money and quantities.
// Shared by the browser (cart preview) and the server (authoritative totals).
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal.Value | { toString(): string } | null | undefined;

export function D(value: DecimalInput): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === "number" || typeof value === "string") return new Decimal(value);
  return new Decimal(value.toString());
}

/** Round to 2 decimal places (money). */
export function money(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round to 3 decimal places (quantities). */
export function qty(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/** Serialize money for JSON/DB: "123.40". */
export function moneyStr(value: DecimalInput): string {
  return money(value).toFixed(2);
}

/** Serialize a quantity without trailing zeros: "1.5", "10". */
export function qtyStr(value: DecimalInput): string {
  return qty(value).toString();
}

export function toNumber(value: DecimalInput): number {
  return D(value).toNumber();
}

export { Decimal };
