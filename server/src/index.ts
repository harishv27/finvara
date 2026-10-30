import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.ts";
import { get, getSetting } from "./db.ts";
import { errorHandler, notFound } from "./lib/http.ts";
import { seedAll } from "./seed.ts";
import { startTicker } from "./market.ts";
import { isLive } from "./ai/engine.ts";
import { auth } from "./routes/auth.ts";
import { profile } from "./routes/profile.ts";
import { budget } from "./routes/budget.ts";
import { planner } from "./routes/planner.ts";
import { will } from "./routes/will.ts";
import { market } from "./routes/market.ts";
import { dashboard } from "./routes/dashboard.ts";
import { chat } from "./routes/chat.ts";
import { admin } from "./routes/admin.ts";
import { notifications } from "./routes/notifications.ts";
import { calc } from "./routes/calc.ts";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  // Default Helmet CSP, minus `upgrade-insecure-requests` so plain-HTTP deployments (and localhost) still load assets.
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { "upgrade-insecure-requests": null } } }));
  app.use(cors({ origin: config.isProd ? false : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, ai: isLive() ? "live" : "demo" }));
  /** Public bits the login screen needs (announcement banner, whether sign-up is open). */
  app.get("/api/public", (_req, res) => res.json({ announcement: getSetting("announcement"), registrationOpen: getSetting("registration_open") }));

  app.use("/api/auth", auth);
  app.use("/api/profile", profile);
  app.use("/api/budget", budget);
  app.use("/api/planner", planner);
  app.use("/api/will", will);
  app.use("/api/dashboard", dashboard);
  app.use("/api/chat", chat);
  app.use("/api/admin", admin);
  app.use("/api/notifications", notifications);
  app.use("/api/calc", calc); // public — must sit before the authenticated /api router below
  app.use("/api", market); // funds, stocks, watchlist, portfolio, recommendations
  app.use("/api", notFound);

  // Serve the built SPA in production (and whenever web/dist exists).
  if (fs.existsSync(path.join(config.webDist, "index.html"))) {
    app.use(express.static(config.webDist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
  }
  app.use(errorHandler);
  return app;
}

function main() {
  if (!get("SELECT 1 FROM stocks LIMIT 1") || !get("SELECT 1 FROM users LIMIT 1")) {
    seedAll(false);
    console.log("Seeded empty database (demo@finvara.app / Demo1234!, admin@finvara.app / Admin123!)");
  }
  startTicker();
  const app = createApp();
  app.listen(config.port, () => {
    const hasApp = fs.existsSync(path.join(config.webDist, "index.html"));
    console.log(`\n  Finvara is running → http://localhost:${hasApp ? config.port : 5173}${hasApp ? "" : "  (API on :" + config.port + ")"}`);
    console.log(`  AI advisors: ${isLive() ? "live (Claude)" : "offline demo mode — add ANTHROPIC_API_KEY to .env for live answers"}\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
