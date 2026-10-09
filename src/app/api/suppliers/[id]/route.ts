import { route } from "@/server/api/handler";
import { supplierSchema } from "@/validators/masters";
import { updateSupplier } from "@/server/services/party.service";

export const PATCH = route<{ id: string }>({ permission: "suppliers.manage" }, async ({ actor, params, body }) =>
  updateSupplier(actor, params.id, await body(supplierSchema)),
);
