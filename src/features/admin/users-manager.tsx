"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SimpleTable } from "@/components/shared/simple-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, ROLES, type RoleCode } from "@/lib/permissions";

interface U {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: RoleCode;
  isActive: boolean;
  lastLoginAt: string | null;
}

export function UsersManager({ users, currentUserId, timezone }: { users: U[]; currentUserId: string; timezone: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<U | "new" | null>(null);
  const [form, setForm] = useState({ name: "", username: "", email: "", role: "SALES" as RoleCode, password: "", isActive: true });
  const [busy, setBusy] = useState(false);

  function open(u: U | "new") {
    setEditing(u);
    setForm(u === "new" ? { name: "", username: "", email: "", role: "SALES", password: "", isActive: true } : { name: u.name, username: u.username, email: u.email ?? "", role: u.role, password: "", isActive: u.isActive });
  }

  async function save() {
    setBusy(true);
    try {
      if (editing === "new") {
        await api("/api/users", { body: { name: form.name, username: form.username, email: form.email, role: form.role, password: form.password } });
        toast.success(`User ${form.username} created`);
      } else if (editing) {
        await api(`/api/users/${editing.id}`, { method: "PATCH", body: { name: form.name, email: form.email, role: form.role, isActive: form.isActive, password: form.password } });
        toast.success("User updated");
      }
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => open("new")}>
          <Plus /> Add user
        </Button>
      </div>
      <SimpleTable
        rows={users}
        rowKey={(u) => u.id}
        columns={[
          { key: "n", header: "Name", cell: (u) => <span className="font-medium">{u.name}{u.id === currentUserId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</span> },
          { key: "u", header: "Username", cell: (u) => <span className="font-mono text-xs">{u.username}</span> },
          { key: "r", header: "Role", cell: (u) => ROLE_LABELS[u.role] },
          { key: "l", header: "Last sign-in", cell: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt, timezone) : "Never") },
          { key: "s", header: "Status", cell: (u) => <StatusBadge status={u.isActive ? "ACTIVE" : "INACTIVE"} /> },
          { key: "a", header: "", cell: (u) => <Button variant="ghost" size="icon-sm" onClick={() => open(u)} aria-label={`Edit ${u.username}`}><Pencil /></Button> },
        ]}
      />
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing === "new" ? "Add user" : "Edit user"}</SheetTitle>
            <SheetDescription>{editing === "new" ? "The user can change their password after signing in." : "Leave password empty to keep the current one."}</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4">
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Full name</Label>
              <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-username">Username</Label>
              <Input id="u-username" value={form.username} disabled={editing !== "new"} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-email">Email (optional)</Label>
              <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as RoleCode })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pass">{editing === "new" ? "Password" : "New password"}</Label>
              <Input id="u-pass" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            {editing !== "new" && (
              <div className="flex items-center gap-2">
                <Switch id="u-active" checked={form.isActive} onCheckedChange={(c) => setForm({ ...form, isActive: c })} />
                <Label htmlFor="u-active">Active</Label>
              </div>
            )}
          </div>
          <SheetFooter>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save user"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
