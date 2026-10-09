import { D, type DecimalInput } from "./decimal";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: DecimalInput, currency = "INR"): string {
  let f = currencyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    currencyFormatters.set(currency, f);
  }
  // Format from the exact 2dp string to avoid float artefacts.
  return f.format(Number(D(value).toFixed(2)));
}

export function formatQty(value: DecimalInput): string {
  const d = D(value).toDecimalPlaces(3);
  const [int, frac] = d.toFixed().split(".");
  const intFmt = Number(int).toLocaleString("en-IN");
  return frac ? `${intFmt}.${frac}` : intFmt;
}

export function formatDate(value: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export function formatTime(value: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value));
}

export function variantLabel(v: { size?: string | null; color?: string | null }): string {
  return [v.size, v.color].filter(Boolean).join(" / ");
}

export function fullItemName(productName: string, v: { size?: string | null; color?: string | null }): string {
  const label = variantLabel(v);
  return label ? `${productName} — ${label}` : productName;
}

export const TXN_TYPE_LABELS: Record<string, string> = {
  OPENING: "Opening stock",
  PURCHASE: "Purchase",
  PURCHASE_CANCEL: "Purchase cancelled",
  SALE: "Sale",
  SALE_CANCEL: "Sale cancelled",
  CUSTOMER_RETURN: "Customer return",
  SUPPLIER_RETURN: "Supplier return",
  ADJUSTMENT: "Adjustment",
  PRODUCTION_CONSUME: "Production — material used",
  PRODUCTION_OUTPUT: "Production — output",
  PRODUCTION_CANCEL: "Production cancelled",
};

export const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  DAMAGE: "Damage (move to damaged stock)",
  DAMAGE_WRITE_OFF: "Write off damaged stock",
  LOST: "Lost",
  FOUND: "Found",
  CORRECTION: "Correction",
  OTHER: "Other",
};

export const DISPATCH_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  PACKED: "Packed",
  DISPATCHED: "Dispatched",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PAYMENT_MODE_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK: "Bank transfer",
  CREDIT: "Credit (pay later)",
};
