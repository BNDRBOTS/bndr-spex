# BNDR | SPEX SaaS

Railway-ready SaaS for paid system-specification and schema generation. The app uses Supabase Auth, Supabase PostgreSQL, Stripe Checkout, Stripe Billing Portal, Stripe webhooks, and DeepSeek reasoning generation.

## What this ships

- Landing page, login page, authenticated app dashboard, generation UI, pricing UI, billing controls, saved-spec vault, detail view, rename, delete, copy, and JSON download.
- Server-side API for auth verification, entitlement checks, Stripe checkout, Stripe portal, Stripe webhooks, generation, and saved-spec CRUD.
- Supabase SQL for profiles, specs, billing events, row-level security, auth trigger, billing idempotency, one-off credit grants, and atomic credit consumption plus spec save.
- Railway deployment config and health check.
- Smoke test and static audit scripts.

## Required cloud services

1. Supabase project with Auth enabled.
2. Stripe account with one one-time Price ID and one monthly recurring Price ID.
3. DeepSeek API key.
4. Railway project running this Node app.

## Supabase setup

1. Open Supabase Dashboard.
2. Open SQL Editor.
3. Paste and run `db/supabase.sql`.
4. In Supabase Auth settings, configure the Site URL to your deployed Railway URL after deployment.
5. Copy these values for Railway environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

## Stripe setup

Create a product for the SaaS and create two prices:

- One-time price for one generation credit.
- Monthly recurring price for subscription access.

Copy the resulting Price IDs into Railway:

- `STRIPE_SINGLE_PRICE_ID`
- `STRIPE_MONTHLY_PRICE_ID`

After Railway deployment, create a Stripe webhook endpoint:

- URL: `https://YOUR_RAILWAY_DOMAIN/api/stripe/webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`

Copy the webhook signing secret into Railway as `STRIPE_WEBHOOK_SECRET`.

## Railway setup

Create a new Railway project and connect this repository/archive. Set these variables in Railway:

```bash
APP_NAME="BNDR | SPEX"
APP_BASE_URL="https://YOUR_RAILWAY_DOMAIN"
DEEPSEEK_API_KEY="YOUR_DEEPSEEK_API_KEY"
DEEPSEEK_MODEL="deepseek-v4-pro"
DEEPSEEK_THINKING="enabled"
DEEPSEEK_REASONING_EFFORT="high"
DEEPSEEK_MAX_TOKENS="7000"
SUPABASE_URL="https://pmvepccrddxslaiigjll.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtdmVwY2NyZGR4c2xhaWlnamxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5Njk5NTYsImV4cCI6MjA5NDU0NTk1Nn0.VWnkTacDRKEnSliV_wDHXxumpnd7z4CKp9UXnYRQfAI"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY"
STRIPE_SECRET_KEY="YOUR_STRIPE_SECRET_KEY"
STRIPE_WEBHOOK_SECRET="YOUR_STRIPE_WEBHOOK_SECRET"
STRIPE_SINGLE_PRICE_ID="price_1TXrLSGuY1oGAyYSPsmrDj7b"
STRIPE_MONTHLY_PRICE_ID="price_1TXrLjGuY1oGAyYSHICgL13D"
PRICE_SINGLE_DISPLAY="$7"
PRICE_MONTHLY_DISPLAY="$9/mo"
```

Deploy command: Railway uses `railway.json` and runs `node server.js`.

## Verification after deploy

Open:

- `/api/health` to confirm configuration status.
- `/login.html` to create/sign in to an account.
- `/app.html` to buy a credit or subscription, generate, save, view, rename, delete, copy, and download specs.

## Local smoke/audit commands

These commands verify syntax, required files, security-critical source checks, protected routes, static serving, path traversal blocking, and unauthenticated API behavior.

```bash
npm run check
npm run audit:project
npm run test:smoke
npm run test:flow
```

The smoke test uses local process environment values that are intentionally fake and only checks local routing/security behavior. It does not call DeepSeek, Stripe Checkout, or Supabase with real credentials.

## Production notes

- The browser receives only `SUPABASE_URL`, `SUPABASE_ANON_KEY`, display prices, and app name through `/env.js`.
- Server secrets stay server-side: `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` are never written to public assets.
- Generation does not use local storage or browser-side persistence. Specs are saved through server-side Supabase REST calls.
- Generated System SPEX output is contractually required to include failure modes, fallback/recovery logic, observability/support requirements, validation, test plan, acceptance criteria, and a reusable final schema.
- Generated Structured Schema output is contractually required to include validation flags, failure modes, fallback/recovery logic, acceptance criteria, and the `bndr_spex_merged_schema_v1` meta tag.
- One-off credits are consumed atomically with spec saving through the `save_spec_with_credit` RPC.
- Checkout credit grants are idempotent through `grant_spec_credit_once`, so webhook and return-page recovery cannot double-grant the same Checkout Session.
- Stripe webhook events are idempotent through `record_billing_event_once`; failed sync attempts release their marker so Stripe retries can repair billing state.
- Returning from Stripe with `session_id` triggers checkout confirmation in the app, which helps recover access if a webhook is delayed.
