import Link from "@/components/shared/app-link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warning" | "danger" | "success";
  href?: string;
}) {
  const body = (
    <Card className={cn("h-full gap-0 py-0 transition-shadow", href && "hover:shadow-md")}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="truncate text-xl font-semibold tabular sm:text-2xl">{value}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
        {Icon && (
          <div
            className={cn(
              "rounded-lg p-2",
              tone === "default" && "bg-primary/10 text-primary",
              tone === "warning" && "bg-amber-100 text-amber-700",
              tone === "danger" && "bg-red-100 text-red-700",
              tone === "success" && "bg-emerald-100 text-emerald-700",
            )}
          >
            <Icon className="size-4" />
          </div>
        )}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
