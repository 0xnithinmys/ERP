// Runs before migrations on Vercel builds: fails fast with a clear message when
// the database variables are missing or still point at a local database.
if (process.env.VERCEL) {
  const problems = [];
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    const value = process.env[name];
    if (!value) {
      problems.push(`${name} is not set`);
      continue;
    }
    let host = "";
    try {
      host = new URL(value).hostname;
    } catch {
      problems.push(`${name} is not a valid postgresql:// URL (remove any surrounding quotes)`);
      continue;
    }
    if (["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
      problems.push(`${name} points at a local database (${host}) — use the Supabase URL from .env.vercel`);
    }
  }
  if (problems.length) {
    console.error("\n✖ Deployment environment variables need fixing (Vercel → Settings → Environment Variables):");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("  Then redeploy.\n");
    process.exit(1);
  }
  console.log("✓ Database environment variables look correct.");
}
