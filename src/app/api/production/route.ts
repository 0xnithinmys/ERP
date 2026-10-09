import { route } from "@/server/api/handler";
import { productionSchema } from "@/validators/transactions";
import { createProduction } from "@/server/services/production.service";

export const POST = route({ permission: "manufacturing.produce" }, async ({ actor, body }) => {
  const { result, replayed } = await createProduction(actor, await body(productionSchema));
  return { id: result.id, number: result.number, replayed };
});
