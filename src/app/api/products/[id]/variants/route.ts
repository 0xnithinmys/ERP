import { route } from "@/server/api/handler";
import { variantCreateSchema } from "@/validators/masters";
import { addVariant } from "@/server/services/product.service";

export const POST = route<{ id: string }>({ permission: "products.manage" }, async ({ actor, params, body }) =>
  addVariant(actor, params.id, await body(variantCreateSchema)),
);
