import { route } from "@/server/api/handler";
import { supplierReturnSchema } from "@/validators/transactions";
import { createSupplierReturn } from "@/server/services/purchase.service";

export const POST = route({ permission: "supplier_returns.create" }, async ({ actor, body }) =>
  (await createSupplierReturn(actor, await body(supplierReturnSchema))).result,
);
