import { route } from "@/server/api/handler";
import { unpackDispatch } from "@/server/services/dispatch.service";

export const POST = route<{ id: string }>({ permission: "dispatch.manage" }, async ({ actor, params }) => unpackDispatch(actor, params.id));
