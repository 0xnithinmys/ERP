"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";

/**
 * Button → confirmation dialog → POST to `url`. Optionally collects a reason.
 * Used for irreversible actions (cancel sale, receive purchase, etc.).
 */
export function ConfirmAction({
  url,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  successMessage,
  requireReason,
  variant = "default",
  size = "default",
  icon,
  body,
  onDone,
}: {
  url: string;
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  successMessage: string;
  requireReason?: boolean;
  variant?: "default" | "destructive" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  icon?: React.ReactNode;
  body?: Record<string, unknown>;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function run() {
    if (requireReason && reason.trim().length < 3) {
      toast.error("Please enter a reason (at least 3 characters)");
      return;
    }
    setBusy(true);
    try {
      await api(url, { method: "POST", body: { ...(body ?? {}), ...(requireReason ? { reason: reason.trim() } : {}) } });
      toast.success(successMessage);
      setOpen(false);
      setReason("");
      onDone?.();
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {requireReason && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">Reason</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being done?" rows={3} autoFocus />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
          <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={run} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
