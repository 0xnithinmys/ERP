import { z } from "zod";
import { route } from "@/server/api/handler";
import { productCreateSchema } from "@/validators/masters";
import { createProduct, listProducts } from "@/server/services/product.service";
import { paginationSchema } from "@/validators/common";

const listQuery = paginationSchema.extend({
  q: z.string().optional(),
  type: z.enum(["FINISHED_GOOD", "RAW_MATERIAL"]).optional().catch(undefined),
});

export const GET = route({ permission: "products.view" }, async ({ actor, query }) => listProducts(actor, query(listQuery)));

export const POST = route({ permission: "products.manage" }, async ({ actor, body }) => createProduct(actor, await body(productCreateSchema)));
