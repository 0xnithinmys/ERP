import { z } from "zod";
import { route } from "@/server/api/handler";
import { zId, zQty } from "@/validators/common";
import { previewProduction } from "@/server/services/production.service";

export const GET = route({ permission: "manufacturing.view" }, async ({ actor, query }) => {
  const { bomId, quantity } = query(z.object({ bomId: zId, quantity: zQty("Production quantity") }));
  return previewProduction(actor, bomId, quantity);
});
