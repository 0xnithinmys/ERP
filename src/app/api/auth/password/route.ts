import { route } from "@/server/api/handler";
import { changePasswordSchema } from "@/validators/masters";
import { changeOwnPassword } from "@/server/services/user.service";
import { getSessionToken } from "@/server/auth/session";
import { hashToken } from "@/server/services/auth.service";

export const POST = route({}, async ({ actor, body }) => {
  const input = await body(changePasswordSchema);
  const token = await getSessionToken();
  await changeOwnPassword(actor, input.currentPassword, input.newPassword, token ? hashToken(token) : undefined);
  return { ok: true };
});
