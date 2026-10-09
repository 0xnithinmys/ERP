"use client";

import { createContext, useContext } from "react";
import { hasPermission, type Permission, type RoleCode } from "@/lib/permissions";
import type { PublicSettings } from "@/server/services/settings.service";

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: RoleCode;
}

interface SessionValue {
  user: SessionUser;
  settings: PublicSettings;
  can: (p: Permission) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ user, settings, children }: { user: SessionUser; settings: PublicSettings; children: React.ReactNode }) {
  return (
    <SessionContext.Provider value={{ user, settings, can: (p) => hasPermission(user.role, p) }}>{children}</SessionContext.Provider>
  );
}

/** UI-only permission hints. The server re-checks every action. */
export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
