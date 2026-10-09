import { route } from "@/server/api/handler";
import { adjustmentSchema } from "@/validators/transactions";
import { createAdjustment } from "@/server/services/adjustment.service";

export const POST = route({ permission: "inventory.adjust" }, async ({ actor, body }) => (await createAdjustment(actor, await body(adjustmentSchema))).result);
