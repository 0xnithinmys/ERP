"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";

export function CreateDispatchButton({ saleId, defaultAddress }: { saleId: string; defaultAddress: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(defaultAddress);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const d = await api<{ id: string; number: string }>("/api/dispatch", { body: { saleId, address, notes: null } });
      toast.success(`Dispatch ${d.number} created`);
      router.push(`/dispatch/${d.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Truck /> Create dispatch
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create dispatch</DialogTitle>
          <DialogDescription>The order will appear in Dispatch for packing and scan verification.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cd-address">Delivery address</Label>
          <Textarea id="cd-address" value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create dispatch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
