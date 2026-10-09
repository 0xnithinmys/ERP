import { route } from "@/server/api/handler";
import { purchaseCreateSchema } from "@/validators/transactions";
import { createPurchase } from "@/server/services/purchase.service";

export const POST = route({ permission: "purchases.create" }, async ({ actor, body }) => {
  const { result, replayed } = await createPurchase(actor, await body(purchaseCreateSchema));
  return { id: result.id, number: result.number, status: result.status, replayed };
});
