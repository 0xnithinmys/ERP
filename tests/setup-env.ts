import { config } from "dotenv";
config({ path: ".env.test", override: true });
(process.env as Record<string, string>).NODE_ENV = "test";
