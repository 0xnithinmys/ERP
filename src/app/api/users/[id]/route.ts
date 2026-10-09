import { route } from "@/server/api/handler";
import { userUpdateSchema } from "@/validators/masters";
import { updateUser } from "@/server/services/user.service";

export const PATCH = route<{ id: string }>({ permission: "users.manage" }, async ({ actor, params, body }) =>
  updateUser(actor, params.id, await body(userUpdateSchema)),
);
