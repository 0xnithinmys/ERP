import { z } from "zod";
import { zEmail, zOptionalText, zPercent, zPhone } from "./common";

export const settingsSchema = z.object({
  businessName: z.string().trim().min(2, "Business name is required").max(120),
  address: zOptionalText(500),
  phone: zPhone,
  email: zEmail,
  gstin: zOptionalText(20),
  currency: z.enum(["INR", "USD", "EUR", "GBP", "AED"]),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone"),
  taxEnabled: z.boolean(),
  taxRate: zPercent("Tax rate"),
  taxLabel: z.string().trim().min(1).max(20),
  allowNegativeStock: z.boolean(),
  invoiceFooter: zOptionalText(300),
});
export type SettingsInput = z.output<typeof settingsSchema>;
