# CommitIt — AI-powered project progress tracker (Telegram, not email)

![CommitIt](assets/commitit-badge.svg)

Connect a GitHub repo → get *who did what*, *which goal it moves*, *how close to done* in Telegram, without flooding.

See `plan.md` (build phases), `AGENTS.md` (agent rules), `theme.md` (message style), `changes.md` (log).

## Phase 0 — run locally

1. `npm install`
2. `cp .env.example .env` (fill `DATABASE_URL` when DB is up; not needed for raw-log demo)
3. `npm run dev` → listens on `PORT` (default 3000)
4. Expose: `ngrok http 3000`
5. GitHub repo → Settings → Webhooks → Add → Payload URL `<ngrok>/webhook`, content type `application/json`, secret set, events: push (Phase 0), `POST /webhook` logs headers + payload, returns 200.

## Scripts

- `npm run dev` — watch mode (tsx)
- `npm run build` / `npm start` — compile backend + build dashboard into `public/`, then run
- `npm test` — vitest
- `npm run dashboard:dev` — Vite dev server (:5173, proxies `/api` → :3000)
- `npm run dashboard:build` — dashboard only, output to `public/`

## Webhooks

`POST /webhook` (local/Render) and `POST /api/webhook` (Vercel) accept `push`,
`pull_request`, and `check_run` events. All go through HMAC verify →
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
