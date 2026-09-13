# ResumeBuilderAI

Live job search + AI-powered CV tailoring — an IY Technologies "AI-powered
infrastructure" showcase, styled to match TradingAnalysis (same IYTECH brand
tokens, layout, and auth pattern).

## How it works
- **Free for everyone**: live job search, full job descriptions, CV upload with
  a keyword-match report against any job description.
- **Paid** (R49 Starter / R69 Pro / R89 Premium per month, billed in ZAR via
  PayPal, other currencies shown for convenience only): AI-powered CV
  rewriting via Gemini, with a monthly tailoring quota per plan.
- Subscriptions are activated **manually** for now (no PayPal webhook) — a
  customer pays, an admin activates them in `/admin.html`.

## Job data
No free public "Indeed" API exists for a deployed server to call (their
Publisher API was deprecated). Live jobs come from:
- **Arbeitnow** — free, no key, works out of the box. Global/remote-leaning.
- **Adzuna** — free tier, explicitly covers South Africa. Activates once
  `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` are set (free signup at
  https://developer.adzuna.com/). Preferred over Arbeitnow when configured.

## AI tailoring
Two modes, chosen automatically:
- **Gemini** (real AI rewrite) once `GEMINI_API_KEY` is set.
- **Heuristic keyword-gap report** (zero cost, no key needed) otherwise —
  still genuinely useful, just not a full rewrite. The UI always labels which
  mode produced a result.

## Environment variables
- `ADMIN_KEY` — secret for `/admin.html` and the admin API
- `PAYPAL_HANDLE` — defaults to `https://paypal.me/IYTechnologies`
- `DEMO_MODE` — defaults to `true` (no Postgres yet, per instruction); set to
  `false` once real payment activation is the only path
- `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` / `ADZUNA_COUNTRY` (default `za`)
- `GEMINI_API_KEY` / `GEMINI_MODEL` (default `gemini-2.0-flash`)
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` — for
  transactional email (welcome/activation); no-ops (console log only) until set

## Local dev
```
npm install
ADMIN_KEY=devkey npm start
```
