import bcrypt from "bcryptjs";

const ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: string | null = null;

/** Compares against a throwaway hash so unknown usernames take as long as wrong passwords. */
export async function burnPasswordCheck(plain: string): Promise<false> {
  dummyHash ??= await bcrypt.hash("not-a-real-password", ROUNDS);
  await bcrypt.compare(plain, dummyHash);
  return false;
}
