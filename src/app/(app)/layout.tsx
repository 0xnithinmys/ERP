import { requireUser } from "@/server/auth/session";
import { getPublicSettings } from "@/server/services/settings.service";
import { SessionProvider } from "@/components/providers/session-provider";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getPublicSettings();
  return (
    <SessionProvider user={{ id: user.id, name: user.name, username: user.username, role: user.role }} settings={settings}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
