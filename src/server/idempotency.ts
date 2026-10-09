import { Prisma } from "@prisma/client";

/**
 * Makes a document-creating operation safe to retry (double-clicks, network
 * retries, refresh during submit). Each form generates one idempotency key;
 * the key is stored with a UNIQUE constraint on the document.
 *
 *  - If a document with the key already exists, it is returned (no second posting).
 *  - If two identical requests race, the loser's whole transaction rolls back —
 *    either on the unique constraint or on a business check that the winner's
 *    commit made fail (e.g. stock now insufficient) — and it returns the
 *    winner's document instead of an error.
 */
export async function idempotent<T>(
  key: string | undefined | null,
  findExisting: (key: string) => Promise<T | null>,
  run: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (key) {
    const existing = await findExisting(key);
    if (existing) return { result: existing, replayed: true };
  }
  try {
    return { result: await run(), replayed: false };
  } catch (err) {
    if (key) {
      const existing = await findExisting(key).catch(() => null);
      if (existing) return { result: existing, replayed: true };
    }
    throw err;
  }
}

export function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target ?? "").includes(field)
  );
}
