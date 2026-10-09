import { route } from "@/server/api/handler";
import { saleCreateSchema } from "@/validators/transactions";
import { createSale } from "@/server/services/sale.service";

export const POST = route({ permission: "sales.create" }, async ({ actor, body }) => {
  const { result, replayed } = await createSale(actor, await body(saleCreateSchema));
  return { id: result.id, number: result.number, total: result.total.toFixed(2), changeGiven: result.changeGiven.toFixed(2), replayed };
});
