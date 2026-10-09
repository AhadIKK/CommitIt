# CommitIt — AI-powered project progress tracker (Telegram, not email)

![CommitIt](assets/commitit-badge.svg)

Connect a GitHub repo → get *who did what*, *which goal it moves*, *how close to done* in Telegram, without flooding.

See `plan.md` (build phases), `AGENTS.md` (agent rules), `theme.md` (message style), `changes.md` (log).

## Setup (production: Vercel + Supabase)

1. **Database** — any Postgres (Supabase pooler URL works). Run the versioned
   migrations in `prisma/migrations/` in order (`npx prisma migrate deploy`
   where a direct connection exists; the SQL is idempotent).
2. **GitHub App** — Settings → Developer settings → GitHub Apps → New:
   - Webhook URL `https://<your-app>.vercel.app/api/github-app`
   - Permissions (read-only): Metadata, Contents, Issues, Pull requests, Checks
   - Events: push, pull_request, check_run, issues, milestone, installation,
     installation_repositories, github_app_authorization, repository
   - Note the App ID, slug, Client ID; generate a Client secret + private key.
3. **Vercel env vars** (Production): `COMMITIT_DATABASE_URL` (pooled 6543 URL —
   do NOT use the Supabase integration's managed vars, it reverts them),
   `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_BASE64` (or
   `GITHUB_APP_PRIVATE_KEY` with `\n` escapes), `GITHUB_APP_WEBHOOK_SECRET`,
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`. Redeploy after changes.
4. **Install + link** — open the dashboard, Install the App on chosen repos,
   Link GitHub account (first login creates it), Connect Telegram via the Join
   link, `/bind owner/repo` in the chat (groups: admins only).
5. **Queue note** — webhook ingestion + dashboard reads run on Vercel, but job
   processing (`enqueueJob` → worker: digests, alerts) needs a long-lived host
   (`npm start` on Render/local runs the poller). Vercel-only deploys store
   events without draining jobs.

## Local dev (ngrok fallback, unsupported in prod)

1. `npm install`
2. `cp .env.example .env` (fill values; see above for the App setup)
3. `npm run dev` → listens on `PORT` (default 3000)
4. Expose: `ngrok http 3000`
5. Manual per-repo webhook (`<ngrok>/webhook`) works for local testing only —
   production uses the GitHub App (no per-repo setup).

## Scripts

- `npm run dev` — watch mode (tsx)
- `npm run build` / `npm start` — compile backend + build dashboard into `public/`, then run
- `npm test` — vitest
- `npm run dashboard:dev` — Vite dev server (:5173, proxies `/api` → :3000)
- `npm run dashboard:build` — dashboard only, output to `public/`

## Webhooks

`POST /webhook` (local/Render) and `POST /api/webhook` (Vercel) accept `push`,
`pull_request`, `check_run`, `issues`, and `milestone` events. All go through HMAC verify →
rate-limit → `events.delivery_id` dedupe → `enqueueJob()` → worker
(push digest, PR-merged / CI fail-fixed alerts, secret + stale-branch alerts).

## Dashboard (Phase 7)

Read-only Vite + React app in `dashboard/` (donut, author bars, issues,
digests). Types shared from `src/dashboard.ts` via `@src/*.js` imports;
BFF at `GET /api/progress|activity|issues|digests?repo=owner/name`.
`npm run dashboard:dev` for local work; production build lands in `public/`.

Views: Dashboard (sections), Review (3-slide milestone review, arrow keys),
Help (reading guide with FAQ schema). Dark default + light switcher (persisted).
Exports: issues/activity as Excel-safe CSV, weekly digest as Word `.doc`,
print stylesheet for Save-as-PDF. Brand mark, favicon, and repo badge are the
approved concept-2 "chat" artwork; only the OG social image is still pending.

Conventions (skill-creator record): tokens first (`tokens.css`, no raw hex in
components), shared BFF types via `@src/*.js` (never duplicated), read-only
BFF (GET only), text-labeled buttons (no icon-only controls), redundant
encoding on every chart (number + label, never color alone).

## Layout (single-stack Node, per AGENTS.md)

```
src/index.ts src/webhook.ts src/verify.ts src/rateLimit.ts src/queue.ts src/worker.ts
src/brain/scan.ts src/brain/trim.ts src/brain/classify.ts src/brain/summarize.ts src/brain/suggest.ts
src/linker.ts src/progress.ts src/formatter.ts src/scheduler.ts src/subscriptions.ts src/telegram.ts src/github-sync.ts
prisma/schema.prisma test/fixtures/
```
