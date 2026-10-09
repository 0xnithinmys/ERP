import { route } from "@/server/api/handler";
import { customerReturnSchema } from "@/validators/transactions";
import { createCustomerReturn } from "@/server/services/return.service";

export const POST = route({ permission: "returns.create" }, async ({ actor, body }) => {
  const { result, replayed } = await createCustomerReturn(actor, await body(customerReturnSchema));
  return { id: result.id, number: result.number, refundAmount: result.refundAmount.toFixed(2), replayed };
});
