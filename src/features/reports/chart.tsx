"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export const ReportChart = dynamic(() => import("@/components/charts/bar-chart").then((m) => m.DailyBarChart), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});
