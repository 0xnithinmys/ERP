import { z } from "zod";
import { route } from "@/server/api/handler";
import { getVariantHits } from "@/server/services/product.service";

export const POST = route({ permission: "products.view" }, async ({ actor, body }) => {
  const { ids } = await body(z.object({ ids: z.array(z.string().max(64)).max(300) }));
  return getVariantHits(actor, ids);
});
