import { route } from "@/server/api/handler";
import { categorySchema } from "@/validators/masters";
import { createCategory, listCategories } from "@/server/services/product.service";

export const GET = route({ permission: "products.view" }, async () => listCategories());
export const POST = route({ permission: "products.manage" }, async ({ actor, body }) => createCategory(actor, await body(categorySchema)));
