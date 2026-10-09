import Link from "@/components/shared/app-link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-full bg-amber-100 p-4 text-amber-700">
        <ShieldAlert className="size-8" />
      </div>
      <h1 className="text-xl font-semibold">You don’t have access to this page</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Your role does not include permission for this area. Ask the owner/admin if you need access.</p>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
