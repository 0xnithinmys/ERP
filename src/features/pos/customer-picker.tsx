"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";
import { useDebounced } from "@/hooks/use-debounced";
import { useSession } from "@/components/providers/session-provider";
import { cn } from "@/lib/utils";

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

export function CustomerPicker({ value, onChange }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void }) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 200);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const { data = [], isFetching } = useQuery({
    queryKey: ["customers", debounced],
    queryFn: ({ signal }) => api<PickedCustomer[]>(`/api/customers?q=${encodeURIComponent(debounced)}`, { signal }),
    enabled: open,
    placeholderData: (p) => p,
  });

  async function create() {
    setSaving(true);
    try {
      const c = await api<PickedCustomer>("/api/customers", { body: { name: form.name, phone: form.phone } });
      onChange(c);
      toast.success(`Customer ${c.name} added`);
      setCreating(false);
      setForm({ name: "", phone: "" });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="h-9 flex-1 justify-between font-normal" data-testid="customer-picker">
            <span className="flex min-w-0 items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" />
              <span className="truncate">{value ? `${value.name}${value.phone ? ` · ${value.phone}` : ""}` : "Walk-in Customer"}</span>
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search name or phone…" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>{isFetching ? "Searching…" : "No customers found."}</CommandEmpty>
              <CommandGroup>
                <CommandItem value="__walkin" onSelect={() => { onChange(null); setOpen(false); }}>
                  <Check className={cn("size-4", value ? "opacity-0" : "opacity-100")} /> Walk-in Customer
                </CommandItem>
                {data.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => { onChange(c); setOpen(false); }}>
                    <Check className={cn("size-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{c.name}</span>
                    {c.phone && <span className="ml-auto text-xs text-muted-foreground">{c.phone}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
              {can("customers.manage") && (
                <CommandGroup>
                  <CommandItem
                    value="__new"
                    onSelect={() => {
                      setOpen(false);
                      setForm({ name: /\d{5,}/.test(q) ? "" : q, phone: /\d{5,}/.test(q) ? q : "" });
                      setCreating(true);
                    }}
                  >
                    <UserPlus className="size-4" /> Add new customer
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Use walk-in customer">
          Clear
        </Button>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>Only name is required. Phone helps find them next time.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nc-name">Name</Label>
              <Input id="nc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-phone">Phone</Label>
              <Input id="nc-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving || form.name.trim().length < 2}>
                {saving ? "Saving…" : "Add customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
