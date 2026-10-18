# UX research & decisions

Before the second design pass we looked at how established products in this space work, then compared Finvara against them. This note records what we found, what we changed, and what we deliberately left out.

> Method: product pages and independent write-ups were read for **feature scope and interaction patterns**. Most sources are vendor or affiliate content, so none of the numbers in them are used here — only the patterns, and each one was re-implemented from scratch.

## What we looked at

| Product / source | Relevant takeaway |
| --- | --- |
| [Monarch](https://www.monarch.com/) | Net worth over time, auto-detected recurring bills & subscriptions, customizable reports, one searchable transaction list, partner sharing |
| [YNAB](https://www.ynab.com/features) | Goals with progress "at a glance", spending & net-worth reports, a loan calculator showing what extra payments save |
| [Betterment](https://www.betterment.com/legal/goal-projection) / [Wealthfront](https://www.wealthfront.com/path) (via [SmartAsset's comparison](https://smartasset.com/financial-advisor/betterment-vs-wealthfront)) | Question-led goal setup; planners with adjustable inputs that update results immediately; one dashboard for goals, net worth and investments |
| [Empower](https://www.empower.com/retirement-planner) | Compare retirement scenarios; "how much can I spend" framing |
| [Groww](https://groww.in/mutual-funds) | Curated fund collections (High return, Large cap, Tax saving…), a screener, a compare page, SIP / lump-sum / step-up calculators, import of existing holdings |
| [Phenomenon Studio — fintech UX](https://phenomenonstudio.com/article/fintech-ux-best-practices-for-complex-financial-products/) and [similar guides](https://dodopayments.com/blogs/ux-strategies-fintech) | Progressive disclosure; round figures with exact values on hover; timestamp balances; never leave users in silence; match friction to risk; ask one question per screen; show value before asking for identity; explain AI suggestions and let users opt out |

## Gap analysis → what we built

| # | Pattern | Before | Now |
| --- | --- | --- | --- |
| 1 | Net worth *over time* | One number | Daily snapshots, 3M/6M/1Y chart, change since start, asset-mix bar |
| 2 | Recurring bills & subscriptions | — | Detected from repeat payees (≥3 months, ~monthly, stable amount); next-due timeline, annual cost, subscription callout; "Upcoming bills" on the dashboard |
| 3 | Reports | Income/spend trend | Category stack by month, per-category trend vs. prior month, savings rate by month, top merchants |
| 4 | Getting data in | Manual entry | CSV import with column mapping, date-format detection, preview, duplicate skipping; CSV export (formula-injection safe); transaction search |
| 5 | Retirement outlook | One deterministic answer | 1,000-path Monte Carlo → success chance, fan chart of outcomes, "what would improve your odds?" levers tested server-side, sliders with live results; starts from the user's *actual* saving rate |
| 6 | Calculators | — | Public SIP (with step-up), lump-sum and debt-payoff calculators — usable before sign-up |
| 7 | Fund & stock discovery | Raw filters | One-click collections / ideas with a plain-English explanation of each |
| 8 | Jargon | Bare terms (Sharpe, β, P/E…) | Glossary tooltips (hover, focus *and* tap) in table headers and detail views; "capital at risk" notes |
| 9 | Onboarding | Five fields on the first screen | Two essentials → optional detail → one risk question per screen with auto-advance; visible progress and time estimate; privacy reassurance |
| 10 | Orientation after sign-up | — | "Getting started" checklist derived from what the user has really done; dismissible |
| 11 | Navigation | Sidebar + hamburger | Command palette (⌘K or `/`) for pages, actions, funds and stocks; quick-add menu; mobile bottom tab bar; skip-to-content link; per-page titles |
| 12 | Trust & clarity | — | "Updated at" / "prices as of" stamps; honest empty states (no fake 100 % savings rate before any spending is recorded); skeleton loaders instead of spinners; readable validation errors |
| 13 | Dead ends in chat | Answer, then nothing | Context-aware follow-up questions and a copy button |

## Deliberately not built

* **Live bank aggregation (Plaid-style)** — needs a commercial data contract and compliance work; CSV import covers the same job for a portfolio-scale app.
* **Partner / household sharing** — valuable (Monarch, YNAB Together) but needs a permissions model; noted as a next step.
* **Customizable dashboard widgets** — we chose a fixed, well-ordered hierarchy instead; revisit with usage data.
* **Real market data & trading** — the app is research-and-planning only; data stays simulated and clearly labelled.

## Design principles we applied

1. **Start from the user's real numbers.** Defaults come from behaviour (average amount actually saved), not constants — otherwise the first impression is a scary, wrong answer.
2. **Explain, don't just display.** Every score has reasons; every jargon term has a definition; every projection states its assumptions.
3. **Honest uncertainty.** Probabilities and ranges instead of single-point promises; "capital at risk" wherever returns appear.
4. **Calibrated friction.** Browsing is instant; destructive actions confirm; CSV import previews before writing.
5. **Keyboard and mobile first-class.** Command palette, skip link, visible focus, bottom tabs, portal-mounted dialogs that can't be re-anchored by page transforms.
