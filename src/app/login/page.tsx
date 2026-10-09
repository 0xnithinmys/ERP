import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { getSettings } from "@/server/services/settings.service";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNext(next));
  const settings = await getSettings();
  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <LoginForm businessName={settings.businessName} next={safeNext(next)} />
    </div>
  );
}

function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
