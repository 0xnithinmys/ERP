import { route } from "@/server/api/handler";
import { receivePurchase } from "@/server/services/purchase.service";

export const POST = route<{ id: string }>({ permission: "purchases.receive" }, async ({ actor, params }) => receivePurchase(actor, params.id));
