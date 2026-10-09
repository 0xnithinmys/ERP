import { route } from "@/server/api/handler";
import { settingsSchema } from "@/validators/settings";
import { getPublicSettings, updateSettings } from "@/server/services/settings.service";

export const GET = route({}, async () => getPublicSettings());
export const PATCH = route({ permission: "settings.manage" }, async ({ actor, body }) => {
  await updateSettings(actor, await body(settingsSchema));
  return getPublicSettings();
});
