// Helpers to read typed values from Next.js page searchParams.

export type SP = Record<string, string | string[] | undefined>;

export function str(sp: SP, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim().slice(0, 200) : undefined;
}

export function int(sp: SP, key: string, fallback: number, max = 100000): number {
  const n = Number(str(sp, key));
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}

export function oneOf<T extends string>(sp: SP, key: string, allowed: readonly T[]): T | undefined {
  const v = str(sp, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export const PAGE_SIZE = 25;
