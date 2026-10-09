import { route } from "@/server/api/handler";
import { userCreateSchema } from "@/validators/masters";
import { createUser, listUsers } from "@/server/services/user.service";

export const GET = route({ permission: "users.manage" }, async ({ actor }) => listUsers(actor));
export const POST = route({ permission: "users.manage" }, async ({ actor, body }) => createUser(actor, await body(userCreateSchema)));
