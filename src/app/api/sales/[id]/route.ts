import { route } from "@/server/api/handler";
import { getSale } from "@/server/services/sale.service";

export const GET = route<{ id: string }>({ permission: "sales.view" }, async ({ actor, params }) => getSale(actor, params.id));
