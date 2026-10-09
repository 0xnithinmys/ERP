"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { D } from "@/lib/decimal";
import { formatQty } from "@/lib/format";

export function SupplierReturnButton({ purchaseId, items }: { purchaseId: string; items: { id: string; name: string; remaining: string; unit: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [bucket, setBucket] = useState<Record<string, "SELLABLE" | "DAMAGED">>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey());

  const chosen = items.filter((i) => qty[i.id] && D(qty[i.id] || 0).gt(0));
  async function submit() {
    setBusy(true);
    try {
      await api("/api/supplier-returns", {
        body: { purchaseId, reason, idempotencyKey: key, items: chosen.map((i) => ({ purchaseItemId: i.id, quantity: qty[i.id], bucket: bucket[i.id] ?? "SELLABLE" })) },
      });
      toast.success("Returned to supplier — stock updated");
      setOpen(false);
      setQty({});
      setReason("");
      setKey(newIdempotencyKey());
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Undo2 /> Return to supplier
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Return to supplier</SheetTitle>
          <SheetDescription>Returned quantities are removed from stock (sellable or damaged).</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4">
          {items.map((i) => (
            <div key={i.id} className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="font-medium">{i.name}</div>
              <div className="text-xs text-muted-foreground">Up to {formatQty(i.remaining)} {i.unit.toLowerCase()} can be returned</div>
              <div className="flex gap-2">
                <Input value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value.trim() })} placeholder="Qty" inputMode="decimal" className="h-8 w-24" aria-label={`Return quantity for ${i.name}`} disabled={D(i.remaining).lte(0)} />
                <Select value={bucket[i.id] ?? "SELLABLE"} onValueChange={(v) => setBucket({ ...bucket, [i.id]: v as "SELLABLE" | "DAMAGED" })}>
                  <SelectTrigger className="h-8 w-44" aria-label="Take from">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SELLABLE">From sellable stock</SelectItem>
                    <SelectItem value="DAMAGED">From damaged stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="sr-reason">Reason *</Label>
            <Textarea id="sr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Defective stitching in lot" />
          </div>
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={busy || chosen.length === 0 || reason.trim().length < 3}>
            {busy ? "Saving…" : "Confirm return"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
