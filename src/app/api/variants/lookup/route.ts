import { z } from "zod";
import { route } from "@/server/api/handler";
import { lookupCode } from "@/server/services/product.service";

// Indexed exact lookup used by barcode scanners. Returns null when unknown.
export const GET = route({ permission: "products.view" }, async ({ actor, query }) => {
  const { code } = query(z.object({ code: z.string().max(100).default("") }));
  return lookupCode(actor, code);
});
