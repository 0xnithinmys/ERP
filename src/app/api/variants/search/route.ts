import { z } from "zod";
import { route } from "@/server/api/handler";
import { searchVariants } from "@/server/services/product.service";

const q = z.object({
  q: z.string().max(120).default(""),
  type: z.enum(["FINISHED_GOOD", "RAW_MATERIAL"]).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(50).catch(20),
  includeInactive: z.enum(["1", "0"]).optional(),
});

export const GET = route({ permission: "products.view" }, async ({ actor, query }) => {
  const p = query(q);
  return searchVariants(actor, p.q, { type: p.type, limit: p.limit, includeInactive: p.includeInactive === "1" });
});
