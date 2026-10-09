import { z } from "zod";
import { route } from "@/server/api/handler";
import { supplierSchema } from "@/validators/masters";
import { paginationSchema } from "@/validators/common";
import { createSupplier, listSuppliers } from "@/server/services/party.service";

export const GET = route({ permission: "suppliers.view" }, async ({ actor, query }) =>
  listSuppliers(actor, query(paginationSchema.extend({ q: z.string().max(100).optional() }))),
);
export const POST = route({ permission: "suppliers.manage" }, async ({ actor, body }) => createSupplier(actor, await body(supplierSchema)));
