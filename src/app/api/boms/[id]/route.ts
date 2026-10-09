import { route } from "@/server/api/handler";
import { deactivateBom, getBom } from "@/server/services/production.service";

export const GET = route<{ id: string }>({ permission: "manufacturing.view" }, async ({ actor, params }) => getBom(actor, params.id));
export const DELETE = route<{ id: string }>({ permission: "manufacturing.manage_bom" }, async ({ actor, params }) => deactivateBom(actor, params.id));
