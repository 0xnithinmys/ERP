"use client";

import Link from "@/components/shared/app-link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Factory, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { formatQty } from "@/lib/format";
import { useDebounced } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";
import type { MaterialRequirement } from "@/server/services/production.service";

interface Preview {
  bom: { id: string; name: string; outputQty: string; unit: string };
  requirements: MaterialRequirement[];
  canProduce: boolean;
}

export function ProductionForm({ boms, initialBomId }: { boms: { id: string; label: string; unit: string; per: string }[]; initialBomId?: string }) {
  const router = useRouter();
  const [bomId, setBomId] = useState(initialBomId ?? "");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newIdempotencyKey());
  const q = useDebounced(quantity.trim(), 250);
  const validQty = /^\d+(\.\d{1,3})?$/.test(q) && Number(q) > 0;

  const { data: preview, isFetching, error } = useQuery({
    queryKey: ["production-preview", bomId, q],
    queryFn: ({ signal }) => api<Preview>(`/api/production/preview?bomId=${bomId}&quantity=${q}`, { signal }),
    enabled: !!bomId && validQty,
  });

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ id: string; number: string }>("/api/production", { body: { bomId, quantity: q, notes: notes || null, idempotencyKey: key } });
      toast.success(`Production ${res.number} completed — stock updated`);
      router.push(`/manufacturing/${res.id}`);
    } catch (err) {
      toast.error(errorMessage(err), { duration: 10000 });
      setBusy(false);
    }
  }

  if (boms.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No bills of materials yet. <Link href="/manufacturing/boms/new" className="text-primary underline">Create a BOM</Link> first.
        </CardContent>
      </Card>
    );
  }

  const selected = boms.find((b) => b.id === bomId);
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <Label>Finished product</Label>
            <Select value={bomId} onValueChange={setBomId}>
              <SelectTrigger className="w-full" aria-label="Finished product">
                <SelectValue placeholder="Select what to produce" />
              </SelectTrigger>
              <SelectContent>
                {boms.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-qty">Quantity to produce</Label>
            <Input id="pr-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" placeholder={selected ? selected.unit.toLowerCase() : ""} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pr-notes">Notes</Label>
            <Textarea id="pr-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Machine 3, night shift" />
          </div>
        </CardContent>
      </Card>

      {bomId && validQty && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Raw material check {isFetching && <Loader2 className="size-4 animate-spin" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
            {preview && (
              <>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b text-left">
                      <th className="p-2 font-medium">Material</th>
                      <th className="p-2 text-right font-medium">Required</th>
                      <th className="p-2 text-right font-medium">Available</th>
                      <th className="p-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.requirements.map((r) => (
                      <tr key={r.materialId} className={cn("border-b last:border-0", !r.sufficient && "bg-red-50")}>
                        <td className="p-2 font-medium">{r.name}</td>
                        <td className="p-2 text-right tabular">{formatQty(r.required)} {r.unit.toLowerCase()}</td>
                        <td className="p-2 text-right tabular">{formatQty(r.available)} {r.unit.toLowerCase()}</td>
                        <td className="p-2 text-right">
                          {!r.wholeUnitsOk ? (
                            <span className="text-xs text-amber-700">Needs whole {r.unit.toLowerCase()}</span>
                          ) : r.sufficient ? (
                            <CheckCircle2 className="ml-auto size-4 text-emerald-600" aria-label="Sufficient" />
                          ) : (
                            <span className="text-xs font-medium text-red-700">Short by {formatQty(r.shortBy)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!preview.canProduce && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <div className="font-medium">Cannot complete production.</div>
                      {preview.requirements.filter((r) => !r.sufficient).map((r) => (
                        <div key={r.materialId}>
                          {r.name}: required {formatQty(r.required)} {r.unit.toLowerCase()}, available {formatQty(r.available)} {r.unit.toLowerCase()}
                        </div>
                      ))}
                      {preview.requirements.some((r) => !r.wholeUnitsOk) && <div>Change the quantity so whole units of each material are used.</div>}
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button onClick={submit} disabled={busy || !preview.canProduce || isFetching} data-testid="confirm-production">
                    <Factory /> {busy ? "Producing…" : `Confirm production of ${formatQty(q)}`}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
