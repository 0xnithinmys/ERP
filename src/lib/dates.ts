import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { addDays, startOfMonth, startOfWeek } from "date-fns";

// All timestamps are stored in UTC. Day boundaries ("today", "this week") are
// computed in the configured business timezone, on the server.

/** "YYYY-MM-DD" for `date` as seen in `tz`. */
export function toDateKey(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}

/** UTC instant of 00:00 on the given calendar day in `tz`. */
export function startOfDayInTz(dateKey: string, tz: string): Date {
  return fromZonedTime(`${dateKey}T00:00:00`, tz);
}

export type RangePreset = "today" | "yesterday" | "week" | "month" | "last30" | "custom";

export interface DateRange {
  from: Date; // inclusive
  to: Date; // exclusive
  fromKey: string;
  toKey: string; // inclusive day key for display
  preset: RangePreset;
}

export function resolveRange(
  preset: string | undefined,
  tz: string,
  custom?: { from?: string; to?: string },
  now = new Date(),
): DateRange {
  const todayKey = toDateKey(now, tz);
  const zonedNow = toZonedTime(now, tz);
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plusDays = (key: string, n: number) => keyOf(addDays(new Date(`${key}T12:00:00`), n));
  const valid = (k?: string) => !!k && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(new Date(`${k}T12:00:00`).getTime());

  let fromKey = todayKey;
  let toKey = todayKey;
  let p: RangePreset = "today";
  switch (preset) {
    case "yesterday":
      fromKey = toKey = plusDays(todayKey, -1);
      p = "yesterday";
      break;
    case "week":
      fromKey = keyOf(startOfWeek(zonedNow, { weekStartsOn: 1 }));
      p = "week";
      break;
    case "month":
      fromKey = keyOf(startOfMonth(zonedNow));
      p = "month";
      break;
    case "last30":
      fromKey = plusDays(todayKey, -29);
      p = "last30";
      break;
    case "custom":
      if (valid(custom?.from) && valid(custom?.to)) {
        fromKey = custom!.from!;
        toKey = custom!.to!;
        if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
        p = "custom";
      }
      break;
  }
  return {
    from: startOfDayInTz(fromKey, tz),
    to: startOfDayInTz(plusDays(toKey, 1), tz),
    fromKey,
    toKey,
    preset: p,
  };
}

/** Day keys from `fromKey` to `toKey` inclusive (for chart buckets). */
export function dayKeys(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let d = new Date(`${fromKey}T12:00:00`);
  const end = new Date(`${toKey}T12:00:00`);
  while (d <= end && out.length < 400) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d = addDays(d, 1);
  }
  return out;
}
