import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

// Load .env from the repo root (Node 20.12+ built-in, no dotenv dependency).
for (const file of [path.join(REPO_ROOT, ".env"), path.join(SERVER_ROOT, ".env")]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const isProd = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || (isProd ? "" : "dev-only-insecure-secret");
if (!jwtSecret) throw new Error("JWT_SECRET must be set in production");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProd,
  jwtSecret,
  jwtTtl: "7d",
  dbPath: process.env.DATABASE_PATH
    ? path.resolve(REPO_ROOT, process.env.DATABASE_PATH)
    : path.join(SERVER_ROOT, "data", "finvara.db"),
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
  defaultModel: process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
  webDist: path.join(REPO_ROOT, "web", "dist"),
};
