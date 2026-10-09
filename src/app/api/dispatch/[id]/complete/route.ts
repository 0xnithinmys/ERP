import { route } from "@/server/api/handler";
import { completeDispatch } from "@/server/services/dispatch.service";

export const POST = route<{ id: string }>({ permission: "dispatch.manage" }, async ({ actor, params }) => completeDispatch(actor, params.id));
