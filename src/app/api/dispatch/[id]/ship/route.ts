import { route } from "@/server/api/handler";
import { dispatchShipSchema } from "@/validators/transactions";
import { shipDispatch } from "@/server/services/dispatch.service";

export const POST = route<{ id: string }>({ permission: "dispatch.manage" }, async ({ actor, params, body }) =>
  shipDispatch(actor, params.id, await body(dispatchShipSchema)),
);
