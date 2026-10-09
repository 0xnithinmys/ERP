import { z } from "zod";
import { route } from "@/server/api/handler";
import { assignBarcode } from "@/server/services/product.service";

export const POST = route<{ id: string }>({ permission: "products.manage" }, async ({ actor, params, body }) => {
  const { barcode } = await body(z.object({ barcode: z.string().trim().min(3).max(64) }));
  return assignBarcode(actor, params.id, barcode);
});
