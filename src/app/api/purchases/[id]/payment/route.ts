import { z } from "zod";
import { route } from "@/server/api/handler";
import { zMoney } from "@/validators/common";
import { recordPurchasePayment } from "@/server/services/purchase.service";

export const POST = route<{ id: string }>({ permission: "purchases.create" }, async ({ actor, params, body }) =>
  recordPurchasePayment(actor, params.id, (await body(z.object({ amount: zMoney("Amount") }))).amount),
);
