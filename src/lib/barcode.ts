// Barcode helpers shared by client and server.

/** EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error("EAN-13 needs 12 digits");
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Generates an in-store EAN-13 barcode. Prefix "20"–"29" is reserved by GS1 for
 * restricted in-store use, so these never collide with manufacturer barcodes.
 */
export function generateInStoreEan13(seed?: number): string {
  const n = seed ?? Math.floor(Math.random() * 1e10);
  const body = `21${String(n % 1e10).padStart(10, "0")}`;
  return `${body}${ean13CheckDigit(body)}`;
}

/** Normalises scanner input: trims whitespace/control chars that some scanners append. */
export function normalizeScan(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

export function buildSku(productCode: string, size?: string | null, color?: string | null): string {
  const part = (s?: string | null) =>
    (s ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 6);
  return [productCode.toUpperCase(), part(size), part(color)].filter(Boolean).join("-");
}
