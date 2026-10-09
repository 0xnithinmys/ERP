import { requirePagePermission } from "@/server/auth/session";
import { getPublicSettings } from "@/server/services/settings.service";
import { PageHeader } from "@/components/shared/page-header";
import { SettingsForm } from "@/features/admin/settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePagePermission("settings.manage");
  const settings = await getPublicSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Business details printed on invoices, tax and stock rules." />
      <SettingsForm initial={settings} />
    </div>
  );
}
