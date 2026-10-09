"use client";

import { useState } from "react";

export function AuditChanges({ changes }: { changes: unknown }) {
  const [open, setOpen] = useState(false);
  if (!changes || (typeof changes === "object" && Object.keys(changes as object).length === 0)) return null;
  return (
    <div>
      <button type="button" className="text-xs text-primary underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide changes" : "Show changes"}
      </button>
      {open && <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">{JSON.stringify(changes, null, 2)}</pre>}
    </div>
  );
}
