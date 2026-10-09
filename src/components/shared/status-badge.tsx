import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  gray: "bg-muted text-muted-foreground border-border",
} as const;

const MAP: Record<string, { label: string; tone: keyof typeof TONES }> = {
  IN_STOCK: { label: "In stock", tone: "green" },
  LOW_STOCK: { label: "Low stock", tone: "amber" },
  OUT_OF_STOCK: { label: "Out of stock", tone: "red" },
  PAID: { label: "Paid", tone: "green" },
  PARTIAL: { label: "Partially paid", tone: "amber" },
  UNPAID: { label: "Unpaid", tone: "red" },
  CONFIRMED: { label: "Confirmed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
  DRAFT: { label: "Draft", tone: "amber" },
  RECEIVED: { label: "Received", tone: "green" },
  PENDING: { label: "Pending", tone: "amber" },
  PACKED: { label: "Packed", tone: "blue" },
  DISPATCHED: { label: "Dispatched", tone: "violet" },
  COMPLETED: { label: "Completed", tone: "green" },
  GOOD: { label: "Good", tone: "green" },
  DAMAGED: { label: "Damaged", tone: "red" },
  ACTIVE: { label: "Active", tone: "green" },
  INACTIVE: { label: "Inactive", tone: "gray" },
  SELLABLE: { label: "Sellable", tone: "blue" },
  FINISHED_GOOD: { label: "Finished good", tone: "blue" },
  RAW_MATERIAL: { label: "Raw material", tone: "violet" },
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const m = MAP[status] ?? { label: status, tone: "gray" as const };
  return (
    <Badge variant="outline" className={cn("font-medium", TONES[m.tone], className)}>
      {label ?? m.label}
    </Badge>
  );
}
