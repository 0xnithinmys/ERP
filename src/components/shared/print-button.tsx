"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print", variant = "outline" }: { label?: string; variant?: "outline" | "default" }) {
  return (
    <Button variant={variant} onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  );
}
