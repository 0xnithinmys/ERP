import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/** Fresh E2E database: migrate → wipe (only a *_e2e DB) → seed. */
async function main() {
  const url = process.env.E2E_DATABASE_URL ?? "postgresql://erp:erp_dev_pw@127.0.0.1:5433/hosiery_erp_e2e?schema=public";
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("E2E database name must end with _e2e");
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await prisma.$disconnect();
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
