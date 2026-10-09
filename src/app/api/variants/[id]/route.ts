import { route } from "@/server/api/handler";
import { variantUpdateSchema } from "@/validators/masters";
import { updateVariant } from "@/server/services/product.service";

export const PATCH = route<{ id: string }>({ permission: "products.manage" }, async ({ actor, params, body }) =>
  updateVariant(actor, params.id, await body(variantUpdateSchema)),
);
