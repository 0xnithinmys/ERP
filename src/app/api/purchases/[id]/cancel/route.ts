import { route } from "@/server/api/handler";
import { cancelSchema } from "@/validators/transactions";
import { cancelPurchase } from "@/server/services/purchase.service";

export const POST = route<{ id: string }>({ permission: "purchases.cancel" }, async ({ actor, params, body }) =>
  cancelPurchase(actor, params.id, (await body(cancelSchema)).reason),
);
