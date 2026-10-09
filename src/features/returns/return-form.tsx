"use client";

import Link from "@/components/shared/app-link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StatusBadge } from "@/components/shared/status-badge";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { calculateLineRefund, maxReturnable, unitAllowsDecimal } from "@/lib/calculations";
import { D } from "@/lib/decimal";
import { formatDateTime, formatMoney, formatQty, PAYMENT_MODE_LABELS } from "@/lib/format";
import { RETURN_REASONS } from "@/validators/transactions";
import { useSession } from "@/components/providers/session-provider";

interface SaleItem {
  id: string;
  productName: string;
  variantLabel: string | null;
  quantity: string;
  returnedQty: string;
  unitPrice: string;
  netAmount: string;
  refundedAmount: string;
  variant: { sku: string; barcode: string | null; product: { unit: string } };
}
interface SaleData {
  id: string;
  number: string;
  customerName: string;
  createdAt: string;
  status: string;
  total: string;
  paymentMode: string;
  items: SaleItem[];
  dispatch: { status: string } | null;
}
interface Pick {
  quantity: string;
  condition: "GOOD" | "DAMAGED";
  reason: string;
}

export function ReturnForm({ initialInvoice }: { initialInvoice: string }) {
  const router = useRouter();
  const { settings } = useSession();
  const [invoice, setInvoice] = useState(initialInvoice);
  const [sale, setSale] = useState<SaleData | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [refundMode, setRefundMode] = useState("CASH");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey());

  async function find(num = invoice) {
    if (!num.trim()) return;
    setFinding(true);
    setFindError(null);
    setSale(null);
    setPicks({});
    try {
      const s = await api<SaleData>(`/api/sales/lookup?number=${encodeURIComponent(num.trim())}`);
      setSale(s);
      setRefundMode(s.paymentMode === "CREDIT" ? "CREDIT" : s.paymentMode);
    } catch (err) {
      setFindError(errorMessage(err));
    } finally {
      setFinding(false);
    }
  }
  useEffect(() => {
    if (initialInvoice) void find(initialInvoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = sale
    ? sale.items
        .filter((i) => picks[i.id] && picks[i.id].quantity)
        .map((i) => {
          const p = picks[i.id];
          const max = maxReturnable(i.quantity, i.returnedQty);
          let error: string | null = null;
          let refund = D(0);
          if (!/^\d+(\.\d{1,3})?$/.test(p.quantity) || D(p.quantity).lte(0)) error = "Enter a quantity";
          else if (!unitAllowsDecimal(i.variant.product.unit) && !D(p.quantity).isInteger()) error = "Whole numbers only";
          else if (D(p.quantity).gt(max)) error = `Maximum additional return is ${formatQty(max)}`;
          else if (!p.reason) error = "Select a reason";
          else refund = calculateLineRefund({ soldQty: i.quantity, alreadyReturnedQty: i.returnedQty, netAmount: i.netAmount, alreadyRefunded: i.refundedAmount, returnQty: p.quantity });
          return { item: i, pick: p, error, refund };
        })
    : [];
  const refundTotal = lines.reduce((a, l) => a.plus(l.refund), D(0));
  const blocked = sale?.status === "CANCELLED" ? "This invoice is cancelled." : sale?.dispatch && ["PENDING", "PACKED"].includes(sale.dispatch.status) ? "This order has not been dispatched yet — cancel the sale instead." : null;

  async function submit() {
    if (!sale) return;
    setBusy(true);
    try {
      const res = await api<{ id: string; number: string; refundAmount: string }>("/api/returns", {
        body: {
          saleId: sale.id,
          refundMode,
          notes: notes || null,
          idempotencyKey: key,
          items: lines.map((l) => ({ saleItemId: l.item.id, quantity: l.pick.quantity, condition: l.pick.condition, reason: l.pick.reason })),
        },
      });
      toast.success(`Return processed successfully — refund ${formatMoney(res.refundAmount)}`);
      setKey(newIdempotencyKey());
      router.push(`/returns/${res.id}`);
    } catch (err) {
      toast.error(errorMessage(err), { duration: 9000 });
      setBusy(false);
      void find(sale.number); // refresh remaining quantities
    }
  }

  const setPick = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...(p[id] ?? { quantity: "", condition: "GOOD" as const, reason: "" }), ...patch } }));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void find();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="r-invoice">Invoice number</Label>
              <Input id="r-invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. INV-00042" className="h-10 font-mono" autoFocus={!initialInvoice} />
            </div>
            <Button type="submit" className="h-10" disabled={finding}>
              {finding ? <Loader2 className="animate-spin" /> : <Search />} Find invoice
            </Button>
          </form>
          {findError && <p className="mt-2 text-sm text-destructive" role="alert">{findError}</p>}
        </CardContent>
      </Card>

      {sale && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Link href={`/sales/${sale.id}`} className="font-mono hover:underline">{sale.number}</Link> · {sale.customerName}
              <span className="text-sm font-normal text-muted-foreground">{formatDateTime(sale.createdAt, settings.timezone)} · {formatMoney(sale.total)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {blocked && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{blocked}</p>}
            <div className="space-y-2">
              {sale.items.map((i) => {
                const max = maxReturnable(i.quantity, i.returnedQty);
                const p = picks[i.id];
                const line = lines.find((l) => l.item.id === i.id);
                return (
                  <div key={i.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{i.productName}{i.variantLabel ? ` — ${i.variantLabel}` : ""}</div>
                        <div className="text-xs text-muted-foreground">
                          Sold {formatQty(i.quantity)} · already returned {formatQty(i.returnedQty)} · <span className="font-medium text-foreground">can return {formatQty(max)}</span> · {formatMoney(i.unitPrice)} each
                        </div>
                      </div>
                      {line && !line.error && <div className="text-sm font-medium tabular">Refund {formatMoney(line.refund)}</div>}
                    </div>
                    {max.gt(0) && !blocked && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr_220px]">
                        <div className="space-y-1">
                          <Label className="text-xs" htmlFor={`rq-${i.id}`}>Return qty</Label>
                          <Input id={`rq-${i.id}`} value={p?.quantity ?? ""} onChange={(e) => setPick(i.id, { quantity: e.target.value.trim() })} placeholder="0" inputMode="decimal" className="h-9" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Condition</Label>
                          <RadioGroup value={p?.condition ?? "GOOD"} onValueChange={(v) => setPick(i.id, { condition: v as "GOOD" | "DAMAGED" })} className="flex h-9 items-center gap-4">
                            <label className="flex items-center gap-2 text-sm">
                              <RadioGroupItem value="GOOD" aria-label="Good" /> Good — back to stock
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <RadioGroupItem value="DAMAGED" aria-label="Damaged" /> Damaged
                            </label>
                          </RadioGroup>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Reason</Label>
                          <Select value={p?.reason ?? ""} onValueChange={(v) => setPick(i.id, { reason: v })}>
                            <SelectTrigger className="h-9 w-full" aria-label={`Reason for ${i.productName}`}>
                              <SelectValue placeholder="Select reason" />
                            </SelectTrigger>
                            <SelectContent>
                              {RETURN_REASONS.map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    {line?.error && <p className="mt-2 text-xs text-destructive" role="alert">{line.error}</p>}
                    {line && !line.error && <div className="mt-2"><StatusBadge status={line.pick.condition} label={line.pick.condition === "GOOD" ? "Will go back to sellable stock" : "Will go to damaged stock"} /></div>}
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
              <div className="space-y-1.5">
                <Label>Refund mode</Label>
                <Select value={refundMode} onValueChange={setRefundMode}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_MODE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{k === "CREDIT" ? "Adjust against balance / credit note" : v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-notes">Notes</Label>
                <Textarea id="r-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3">
              <div className="text-sm">
                Refund total <span className="text-lg font-semibold tabular">{formatMoney(refundTotal)}</span>
              </div>
              <Button onClick={submit} disabled={busy || !!blocked || lines.length === 0 || lines.some((l) => l.error)} data-testid="confirm-return">
                {busy ? "Processing…" : "Confirm return"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
