import { route } from "@/server/api/handler";
import { salePaymentSchema } from "@/validators/transactions";
import { recordSalePayment } from "@/server/services/sale.service";

export const POST = route<{ id: string }>({ permission: "sales.create" }, async ({ actor, params, body }) => {
  const input = await body(salePaymentSchema);
  return recordSalePayment(actor, params.id, input.amount, input.paymentMode);
});
