import { route } from "@/server/api/handler";
import { dispatchCreateSchema } from "@/validators/transactions";
import { createDispatch } from "@/server/services/dispatch.service";

export const POST = route({ permission: "dispatch.manage" }, async ({ actor, body }) => createDispatch(actor, await body(dispatchCreateSchema)));
