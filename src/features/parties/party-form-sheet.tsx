"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Field } from "@/components/shared/field";
import { api, errorMessage } from "@/lib/api-client";
import { customerSchema, supplierSchema } from "@/validators/masters";

interface Values {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

/** Create/edit drawer shared by suppliers and customers. */
export function PartyFormSheet({ kind, initial, id }: { kind: "supplier" | "customer"; initial?: Values; id?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const schema = kind === "supplier" ? supplierSchema : customerSchema;
  const form = useForm<Values>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: { name: "", phone: "", email: "", address: "", gstin: "", notes: "", isActive: true, ...initial },
  });
  const e = form.formState.errors;
  const label = kind === "supplier" ? "supplier" : "customer";

  const submit = form.handleSubmit(async (v) => {
    try {
      const base = kind === "supplier" ? "/api/suppliers" : "/api/customers";
      const body = kind === "supplier" ? v : { ...v, gstin: undefined };
      if (id) await api(`${base}/${id}`, { method: "PATCH", body });
      else await api(base, { body });
      toast.success(id ? `${label[0].toUpperCase()}${label.slice(1)} updated` : `${label[0].toUpperCase()}${label.slice(1)} added`);
      setOpen(false);
      if (!id) form.reset();
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {id ? (
          <Button variant="outline">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> Add {label}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{id ? `Edit ${label}` : `Add ${label}`}</SheetTitle>
          <SheetDescription>Only the name is required.</SheetDescription>
        </SheetHeader>
        <form id={`party-form-${id ?? "new"}`} onSubmit={submit} className="space-y-3 px-4" noValidate>
          <Field label="Name" required error={e.name?.message}>
            <Input {...form.register("name")} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" error={e.phone?.message}>
              <Input inputMode="tel" {...form.register("phone")} />
            </Field>
            <Field label="Email" error={e.email?.message}>
              <Input type="email" {...form.register("email")} />
            </Field>
          </div>
          <Field label="Address" error={e.address?.message}>
            <Textarea rows={2} {...form.register("address")} />
          </Field>
          {kind === "supplier" && (
            <Field label="GSTIN" error={e.gstin?.message} hint="15-character GST number (optional)">
              <Input className="uppercase" {...form.register("gstin")} />
            </Field>
          )}
          <Field label="Notes" error={e.notes?.message}>
            <Textarea rows={2} {...form.register("notes")} />
          </Field>
          <div className="flex items-center gap-2">
            <Switch id={`party-active-${id ?? "new"}`} checked={form.watch("isActive") ?? true} onCheckedChange={(c) => form.setValue("isActive", c)} />
            <Label htmlFor={`party-active-${id ?? "new"}`}>Active</Label>
          </div>
        </form>
        <SheetFooter>
          <Button type="submit" form={`party-form-${id ?? "new"}`} disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
