// Vercel entry: the whole Express API as one serverless function.
// The database lives in /tmp (set via DATABASE_PATH), so it is created and seeded on cold start — demo data only.
import { get } from "../server/src/db.ts";
import { seedAll } from "../server/src/seed.ts";
import { initLive } from "../server/src/market.ts";
import { createApp } from "../server/src/index.ts";

if (!get("SELECT 1 FROM stocks LIMIT 1") || !get("SELECT 1 FROM users LIMIT 1")) seedAll(false);
initLive();

export default createApp();
