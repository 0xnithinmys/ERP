import { describe, expect, it } from "vitest";
import {
  allocate,
  calculateLineRefund,
  calculatePayment,
  calculatePurchase,
  calculateSale,
  maxReturnable,
  requiredMaterial,
  stockStatus,
  validateQuantityForUnit,
} from "@/lib/calculations";
import { D } from "@/lib/decimal";
import { ean13CheckDigit, generateInStoreEan13, isValidEan13, normalizeScan, buildSku } from "@/lib/barcode";
import { resolveRange } from "@/lib/dates";

describe("money precision", () => {
  it("adds 100.10 + 200.20 exactly", () => {
    const t = calculateSale([
      { quantity: "1", unitPrice: "100.10" },
      { quantity: "1", unitPrice: "200.20" },
    ]);
    expect(t.total.toFixed(2)).toBe("300.30");
    expect(t.total.toString()).toBe("300.3");
  });
});

describe("calculateSale", () => {
  it("computes quantities, line discounts, bill discount and tax", () => {
    const t = calculateSale(
      [
        { quantity: "3", unitPrice: "120", discount: "10" }, // 350
        { quantity: "2", unitPrice: "225" }, // 450
      ],
      { billDiscount: "50", taxRate: "5" },
    );
    expect(t.grossTotal.toFixed(2)).toBe("810.00");
    expect(t.subtotal.toFixed(2)).toBe("800.00");
    expect(t.taxable.toFixed(2)).toBe("750.00");
    expect(t.taxAmount.toFixed(2)).toBe("37.50");
    expect(t.total.toFixed(2)).toBe("787.50");
    expect(t.itemCount.toString()).toBe("5");
    // allocated nets always sum to the total exactly
    expect(t.lines.reduce((a, l) => a.plus(l.netAmount), D(0)).toFixed(2)).toBe("787.50");
  });

  it("rejects discounts larger than the amount", () => {
    expect(() => calculateSale([{ quantity: "1", unitPrice: "10", discount: "11" }])).toThrow(/exceed/);
    expect(() => calculateSale([{ quantity: "1", unitPrice: "10" }], { billDiscount: "10.01" })).toThrow(/exceed/);
  });

  it("handles an all-zero cart without dividing by zero", () => {
    const t = calculateSale([{ quantity: "1", unitPrice: "0" }]);
    expect(t.total.toFixed(2)).toBe("0.00");
    expect(t.lines[0].netAmount.toFixed(2)).toBe("0.00");
  });
});

describe("allocate", () => {
  it("distributes rounding remainder so parts sum exactly", () => {
    const parts = allocate(D("100"), [D("1"), D("1"), D("1")]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
  });
});

describe("calculatePayment", () => {
  it("gives change for cash overpayment", () => {
    const p = calculatePayment("787.50", "1000", "CASH");
    expect(p.change.toFixed(2)).toBe("212.50");
    expect(p.amountPaid.toFixed(2)).toBe("787.50");
    expect(p.status).toBe("PAID");
  });
  it("marks partial and unpaid", () => {
    expect(calculatePayment("100", "40", "CASH").status).toBe("PARTIAL");
    expect(calculatePayment("100", "0", "CREDIT").status).toBe("UNPAID");
    expect(calculatePayment("100", "40", "CASH").balanceDue.toFixed(2)).toBe("60.00");
  });
  it("rejects overpayment on card/UPI", () => {
    expect(() => calculatePayment("100", "150", "UPI")).toThrow();
  });
});

describe("calculatePurchase", () => {
  it("totals lines with discount and tax", () => {
    const t = calculatePurchase(
      [
        { quantity: "100", rate: "45.50", discount: "50", taxRate: "5" }, // base 4500, tax 225
        { quantity: "10", rate: "12" }, // 120
      ],
      { discount: "45" },
    );
    expect(t.subtotal.toFixed(2)).toBe("4620.00");
    expect(t.taxAmount.toFixed(2)).toBe("225.00");
    expect(t.total.toFixed(2)).toBe("4800.00");
    expect(t.itemCount.toString()).toBe("110");
  });
});

describe("returns math", () => {
  it("max returnable = sold - already returned", () => {
    expect(maxReturnable("10", "3").toString()).toBe("7");
  });
  it("rejects returning more than remaining", () => {
    expect(() =>
      calculateLineRefund({ soldQty: "10", alreadyReturnedQty: "3", netAmount: "1000", alreadyRefunded: "300", returnQty: "8" }),
    ).toThrow(/only 7 remaining/);
  });
  it("partial refunds sum exactly to the line amount", () => {
    const net = "100.00"; // 3 units at 33.333...
    const r1 = calculateLineRefund({ soldQty: "3", alreadyReturnedQty: "0", netAmount: net, alreadyRefunded: "0", returnQty: "1" });
    const r2 = calculateLineRefund({ soldQty: "3", alreadyReturnedQty: "1", netAmount: net, alreadyRefunded: r1, returnQty: "1" });
    const r3 = calculateLineRefund({
      soldQty: "3",
      alreadyReturnedQty: "2",
      netAmount: net,
      alreadyRefunded: r1.plus(r2),
      returnQty: "1",
    });
    expect(r1.plus(r2).plus(r3).toFixed(2)).toBe("100.00");
  });
});

describe("units and quantities", () => {
  it("validates quantities per unit", () => {
    expect(validateQuantityForUnit("0", "PCS")).toMatch(/greater than zero/);
    expect(validateQuantityForUnit("-1", "PCS")).toMatch(/greater than zero/);
    expect(validateQuantityForUnit("1.5", "PAIR")).toMatch(/whole number/);
    expect(validateQuantityForUnit("1.5", "KG")).toBeNull();
    expect(validateQuantityForUnit("0.0001", "KG")).toMatch(/3 decimal/);
    expect(validateQuantityForUnit("99999999", "PCS")).toMatch(/cannot exceed/);
  });
  it("computes BOM requirements", () => {
    expect(requiredMaterial("0.05", "1", "200").toString()).toBe("10");
    expect(requiredMaterial("1", "12", "24").toString()).toBe("2");
    expect(() => requiredMaterial("1", "0", "1")).toThrow();
  });
  it("derives stock status", () => {
    expect(stockStatus("0", "5")).toBe("OUT_OF_STOCK");
    expect(stockStatus("-2", "5")).toBe("OUT_OF_STOCK");
    expect(stockStatus("5", "5")).toBe("LOW_STOCK");
    expect(stockStatus("6", "5")).toBe("IN_STOCK");
    expect(stockStatus("3", "0", "4")).toBe("LOW_STOCK");
    expect(stockStatus("3", "0")).toBe("IN_STOCK");
  });
});

describe("barcodes", () => {
  it("computes EAN-13 check digits", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
  });
  it("generates valid in-store EAN-13", () => {
    for (let i = 0; i < 50; i++) expect(isValidEan13(generateInStoreEan13())).toBe(true);
  });
  it("normalizes scanner input", () => {
    expect(normalizeScan("  8901234567890\r\n")).toBe("8901234567890");
  });
  it("builds SKUs", () => {
    expect(buildSku("cs01", "M", "Navy Blue")).toBe("CS01-M-NAVYBL");
  });
});

describe("date ranges (business timezone)", () => {
  const now = new Date("2026-10-09T20:00:00Z"); // 01:30 on 10 Oct in Asia/Kolkata
  it("today is computed in the business timezone", () => {
    const r = resolveRange("today", "Asia/Kolkata", undefined, now);
    expect(r.fromKey).toBe("2026-10-10");
    expect(r.from.toISOString()).toBe("2026-10-09T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-10T18:30:00.000Z");
  });
  it("yesterday / custom", () => {
    expect(resolveRange("yesterday", "Asia/Kolkata", undefined, now).fromKey).toBe("2026-10-09");
    const c = resolveRange("custom", "Asia/Kolkata", { from: "2026-10-05", to: "2026-10-01" }, now);
    expect([c.fromKey, c.toKey]).toEqual(["2026-10-01", "2026-10-05"]);
  });
});
