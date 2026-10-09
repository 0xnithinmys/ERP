import { route } from "@/server/api/handler";
import { cancelSchema } from "@/validators/transactions";
import { cancelProduction } from "@/server/services/production.service";

export const POST = route<{ id: string }>({ permission: "manufacturing.cancel" }, async ({ actor, params, body }) =>
  cancelProduction(actor, params.id, (await body(cancelSchema)).reason),
);
