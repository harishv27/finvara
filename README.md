# Finvara

**Live demo: https://finvara.vercel.app** (demo data resets periodically)

Personal finance in one place: **budgeting, goal & retirement planning, will writing, fund and stock research, and AI advisors.**
All market data is simulated, so it's a safe sandbox to explore.

## Run it

Needs [Node.js](https://nodejs.org) 24 or newer.

```bash
git clone https://github.com/harishv27/finvara.git
cd finvara
npm install
npm start
```

Open **http://localhost:4000** and click **Explore the live demo** — no sign-up, and it comes with six months of sample data.

Demo logins: `demo@finvara.app` / `Demo1234!` · admin: `admin@finvara.app` / `Admin123!`

## What you can do

- **Budget** — track spending, import a bank CSV, spot recurring bills and subscriptions
- **Plan** — set goals; see the chance your retirement plan works across 1,000 simulated markets
- **Calculators** — SIP, lump sum and debt payoff (no sign-in needed at `/calculators`)
- **Invest** — screen and compare funds and stocks, build a portfolio, get picks matched to your risk level
- **Write a will** — guided steps, then download it
- **Ask the AI advisors** — three specialists that run real calculations on your data
- **Admin** — manage users, content and the chatbot

## AI advisors

They work offline out of the box. For live answers from Claude, copy `.env.example` to `.env`, add your `ANTHROPIC_API_KEY`, and restart.

## For developers

```bash
npm run dev    # hot reload (app on :5173)
npm test       # 71 tests
npm run seed   # reset the demo data
```

React + Vite + Tailwind · Express 5 · SQLite · Claude API. Educational use only — not financial, tax or legal advice. MIT licensed.
