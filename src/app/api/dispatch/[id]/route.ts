import { route } from "@/server/api/handler";
import { getDispatch } from "@/server/services/dispatch.service";

export const GET = route<{ id: string }>({ permission: "dispatch.view" }, async ({ actor, params }) => getDispatch(actor, params.id));
