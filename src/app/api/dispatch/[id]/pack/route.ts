import { route } from "@/server/api/handler";
import { dispatchPackSchema } from "@/validators/transactions";
import { packDispatch } from "@/server/services/dispatch.service";

export const POST = route<{ id: string }>({ permission: "dispatch.manage" }, async ({ actor, params, body }) =>
  packDispatch(actor, params.id, (await body(dispatchPackSchema)).items),
);
