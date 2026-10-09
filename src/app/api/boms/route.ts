import { route } from "@/server/api/handler";
import { bomSchema } from "@/validators/transactions";
import { listBoms, saveBom } from "@/server/services/production.service";

export const GET = route({ permission: "manufacturing.view" }, async ({ actor }) => listBoms(actor));
export const POST = route({ permission: "manufacturing.manage_bom" }, async ({ actor, body }) => saveBom(actor, await body(bomSchema)));
