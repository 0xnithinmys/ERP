"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";

export function DailyBarChart({ data, height = 224 }: { data: { day: string; total: number; count: number }[]; height?: number }) {
  const rows = data.map((d) => ({ ...d, label: new Date(`${d.day}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            formatter={(v) => [formatMoney(Number(v)), "Total"]}
            labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.count ?? 0} bill(s)`}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
          />
          <Bar dataKey="total" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
