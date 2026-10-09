import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Applies pending migrations to the dedicated test database (non-destructive). */
export default function setup() {
  const env = config({ path: ".env.test", override: true }).parsed ?? {};
  if (!/_test(\?|$)/.test(env.DATABASE_URL ?? "")) throw new Error("Refusing to run tests: DATABASE_URL in .env.test must point to a *_test database");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, ...env } });
}
