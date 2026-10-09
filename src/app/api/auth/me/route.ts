import { route } from "@/server/api/handler";
import { permissionsFor } from "@/lib/permissions";

export const GET = route({}, async ({ actor }) => ({
  id: actor.id,
  name: actor.name,
  username: actor.username,
  role: actor.role,
  permissions: permissionsFor(actor.role),
}));
