import { route } from "@/server/api/handler";
import { cancelSchema } from "@/validators/transactions";
import { cancelSale } from "@/server/services/sale.service";

export const POST = route<{ id: string }>({ permission: "sales.cancel" }, async ({ actor, params, body }) =>
  cancelSale(actor, params.id, (await body(cancelSchema)).reason),
);
