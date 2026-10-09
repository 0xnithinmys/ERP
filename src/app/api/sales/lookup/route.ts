import { z } from "zod";
import { route } from "@/server/api/handler";
import { findSaleByNumber } from "@/server/services/sale.service";
import { notFound } from "@/server/errors";

export const GET = route({ permission: "sales.view" }, async ({ actor, query }) => {
  const { number } = query(z.object({ number: z.string().trim().min(1, "Enter an invoice number").max(40) }));
  const sale = await findSaleByNumber(actor, number);
  if (!sale) throw notFound(`Invoice ${number}`);
  return sale;
});
