"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/shared/field";
import { api, errorMessage } from "@/lib/api-client";
import { settingsSchema } from "@/validators/settings";
import type { PublicSettings } from "@/server/services/settings.service";

type V = z.input<typeof settingsSchema>;

export function SettingsForm({ initial }: { initial: PublicSettings }) {
  const router = useRouter();
  const form = useForm<V>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      ...initial,
      address: initial.address ?? "",
      phone: initial.phone ?? "",
      email: initial.email ?? "",
      gstin: initial.gstin ?? "",
      invoiceFooter: initial.invoiceFooter ?? "",
      currency: initial.currency as V["currency"],
    },
  });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api("/api/settings", { method: "PATCH", body: v });
      toast.success("Settings saved");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Card>
        <CardHeader><CardTitle className="text-base">Business</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" required error={e.businessName?.message} className="sm:col-span-2"><Input {...form.register("businessName")} /></Field>
          <Field label="Address" error={e.address?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register("address")} /></Field>
          <Field label="Phone" error={e.phone?.message}><Input {...form.register("phone")} /></Field>
          <Field label="Email" error={e.email?.message}><Input {...form.register("email")} /></Field>
          <Field label="GSTIN" error={e.gstin?.message}><Input className="uppercase" {...form.register("gstin")} /></Field>
          <Field label="Timezone" error={e.timezone?.message} hint="Used for day boundaries in reports"><Input {...form.register("timezone")} /></Field>
          <Field label="Currency" error={e.currency?.message}>
            <Controller control={form.control} name="currency" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{["INR", "USD", "EUR", "GBP", "AED"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Invoice footer" error={e.invoiceFooter?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register("invoiceFooter")} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Tax</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <Controller control={form.control} name="taxEnabled" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
            Charge tax on sales
          </label>
          <Field label="Tax label" error={e.taxLabel?.message}><Input {...form.register("taxLabel")} /></Field>
          <Field label="Tax rate (%)" error={e.taxRate?.message}><Input inputMode="decimal" {...form.register("taxRate")} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Stock rules</CardTitle></CardHeader>
        <CardContent>
          <label className="flex items-start gap-3 text-sm">
            <Controller control={form.control} name="allowNegativeStock" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />} />
            <span>
              Allow selling more than available stock (negative stock)
              <span className="block text-xs text-muted-foreground">Recommended OFF. Adjustments, supplier returns and production never go negative regardless.</span>
            </span>
          </label>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Saving…" : "Save settings"}</Button>
      </div>
    </form>
  );
}
