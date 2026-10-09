import { requirePagePermission } from "@/server/auth/session";
import { ReportTabs } from "@/features/reports/report-tabs";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("reports.view");
  return (
    <div>
      <ReportTabs />
      {children}
    </div>
  );
}
