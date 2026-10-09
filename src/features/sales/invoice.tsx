import type { Setting } from "@prisma/client";
import type { SaleDetail } from "@/server/services/sale.service";
import { D } from "@/lib/decimal";
import { formatDateTime, formatMoney, formatQty, PAYMENT_MODE_LABELS } from "@/lib/format";

/** Printer-friendly invoice (A4/A5). Rendered on the server. */
export function Invoice({ sale, settings }: { sale: SaleDetail; settings: Setting }) {
  const gross = sale.items.reduce((a, i) => a.plus(D(i.quantity).times(D(i.unitPrice))), D(0));
  const lineDisc = sale.items.reduce((a, i) => a.plus(D(i.discount)), D(0));
  const due = D(sale.total).minus(D(sale.amountPaid));
  const cur = settings.currency;
  return (
    <article className="print-area mx-auto w-full max-w-3xl rounded-xl border bg-white p-6 text-sm shadow-sm sm:p-8" aria-label={`Invoice ${sale.number}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-xl font-bold">{settings.businessName}</h2>
          {settings.address && <p className="max-w-xs text-xs text-gray-600">{settings.address}</p>}
          <p className="text-xs text-gray-600">
            {[settings.phone, settings.email].filter(Boolean).join(" · ")}
          </p>
          {settings.gstin && <p className="text-xs text-gray-600">GSTIN: {settings.gstin}</p>}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold uppercase tracking-wide">{sale.status === "CANCELLED" ? "Cancelled invoice" : settings.taxEnabled ? "Tax invoice" : "Invoice"}</div>
          <div className="font-mono">{sale.number}</div>
          <div className="text-xs text-gray-600">{formatDateTime(sale.createdAt, settings.timezone)}</div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 py-4 text-xs">
        <div>
          <div className="font-medium uppercase text-gray-500">Bill to</div>
          <div className="text-sm font-medium">{sale.customerName}</div>
          {sale.customer?.phone && <div>{sale.customer.phone}</div>}
          {sale.customer?.address && <div className="text-gray-600">{sale.customer.address}</div>}
        </div>
        <div className="text-right">
          <div className="font-medium uppercase text-gray-500">Payment</div>
          <div className="text-sm font-medium">{sale.paymentStatus === "PAID" ? "Paid" : sale.paymentStatus === "PARTIAL" ? "Partially paid" : "Unpaid"}</div>
          <div>{PAYMENT_MODE_LABELS[sale.paymentMode]}</div>
        </div>
      </section>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-y bg-gray-50 text-left">
            <th className="py-2 pr-2 pl-1 font-medium">#</th>
            <th className="py-2 pr-2 font-medium">Item</th>
            <th className="py-2 pr-2 text-right font-medium">Qty</th>
            <th className="py-2 pr-2 text-right font-medium">Rate</th>
            <th className="py-2 pr-2 text-right font-medium">Disc.</th>
            <th className="py-2 pr-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i, idx) => (
            <tr key={i.id} className="border-b align-top">
              <td className="py-1.5 pr-2 pl-1 text-gray-500">{idx + 1}</td>
              <td className="py-1.5 pr-2">
                <div className="font-medium">{i.productName}</div>
                <div className="text-[11px] text-gray-500">
                  {[i.variantLabel, i.variant.sku].filter(Boolean).join(" · ")}
                  {D(i.returnedQty).gt(0) && <span className="ml-1 text-red-600">(returned {formatQty(i.returnedQty)})</span>}
                </div>
              </td>
              <td className="py-1.5 pr-2 text-right tabular">
                {formatQty(i.quantity)} <span className="text-gray-500">{i.variant.product.unit.toLowerCase()}</span>
              </td>
              <td className="py-1.5 pr-2 text-right tabular">{formatMoney(i.unitPrice, cur)}</td>
              <td className="py-1.5 pr-2 text-right tabular">{D(i.discount).gt(0) ? formatMoney(i.discount, cur) : "—"}</td>
              <td className="py-1.5 pr-1 text-right font-medium tabular">{formatMoney(i.lineTotal, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="ml-auto mt-4 w-full max-w-xs space-y-1 text-xs">
        <Line label="Gross amount" value={formatMoney(gross, cur)} />
        {lineDisc.gt(0) && <Line label="Item discounts" value={`− ${formatMoney(lineDisc, cur)}`} />}
        {D(sale.billDiscount).gt(0) && <Line label="Bill discount" value={`− ${formatMoney(sale.billDiscount, cur)}`} />}
        {D(sale.taxAmount).gt(0) && <Line label={`${settings.taxLabel} @ ${D(sale.taxRate).toString()}%`} value={formatMoney(sale.taxAmount, cur)} />}
        <div className="flex justify-between border-t pt-1.5 text-base font-bold">
          <span>Total</span>
          <span className="tabular">{formatMoney(sale.total, cur)}</span>
        </div>
        <Line label="Paid" value={formatMoney(sale.amountPaid, cur)} />
        {D(sale.changeGiven).gt(0) && <Line label="Change returned" value={formatMoney(sale.changeGiven, cur)} />}
        {due.gt(0) && <Line label="Balance due" value={formatMoney(due, cur)} strong />}
        {D(sale.refundedAmount).gt(0) && <Line label="Refunded (returns)" value={`− ${formatMoney(sale.refundedAmount, cur)}`} />}
      </section>

      {sale.notes && <p className="mt-4 text-xs text-gray-600">Note: {sale.notes}</p>}
      <footer className="mt-8 border-t pt-3 text-center text-xs text-gray-500">{settings.invoiceFooter}</footer>
    </article>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-red-700" : ""}`}>
      <span className="text-gray-600">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
