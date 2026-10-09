import { route } from "@/server/api/handler";
import { customerSchema } from "@/validators/masters";
import { updateCustomer } from "@/server/services/party.service";

export const PATCH = route<{ id: string }>({ permission: "customers.manage" }, async ({ actor, params, body }) =>
  updateCustomer(actor, params.id, await body(customerSchema)),
);
