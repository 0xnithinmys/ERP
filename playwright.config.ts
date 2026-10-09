import { defineConfig, devices } from "@playwright/test";

// E2E runs against the production build on port 3100 with an isolated *_e2e database.
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://erp:erp_dev_pw@127.0.0.1:5433/hosiery_erp_e2e?schema=public";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx tsx tests/e2e/prepare-db.ts && node node_modules/next/dist/bin/next start -p 3100",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
    timeout: 240_000,
    env: { DATABASE_URL: E2E_DB, DIRECT_URL: E2E_DB, APP_URL: "http://localhost:3100", UPLOAD_DIR: "./storage/e2e-uploads", NODE_ENV: "production" },
  },
});
