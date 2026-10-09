"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Recharts is loaded lazily so it never blocks the first paint.
export const SalesChart = dynamic(() => import("@/components/charts/bar-chart").then((m) => m.DailyBarChart), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});
