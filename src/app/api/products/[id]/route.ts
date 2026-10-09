import { route } from "@/server/api/handler";
import { productUpdateSchema } from "@/validators/masters";
import { getProduct, updateProduct } from "@/server/services/product.service";

export const GET = route<{ id: string }>({ permission: "products.view" }, async ({ actor, params }) => getProduct(actor, params.id));

export const PATCH = route<{ id: string }>({ permission: "products.manage" }, async ({ actor, params, body }) =>
  updateProduct(actor, params.id, await body(productUpdateSchema)),
);
