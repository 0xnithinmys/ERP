import { requirePagePermission } from "@/server/auth/session";
import { listUsers } from "@/server/services/user.service";
import { getSettings } from "@/server/services/settings.service";
import { PageHeader } from "@/components/shared/page-header";
import { UsersManager } from "@/features/admin/users-manager";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requirePagePermission("users.manage");
  const [users, settings] = await Promise.all([listUsers(actor), getSettings()]);
  return (
    <div>
      <PageHeader title="Users" description="Staff accounts and their roles. Role changes and deactivation sign the user out immediately." />
      <UsersManager
        currentUserId={actor.id}
        timezone={settings.timezone}
        users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() }))}
      />
    </div>
  );
}
