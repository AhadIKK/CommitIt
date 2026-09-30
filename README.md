# CommitIt — AI-powered project progress tracker (Telegram, not email)

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
- `npm run build` / `npm start` — compile + run
- `npm test` — vitest

## Layout (single-stack Node, per AGENTS.md)

```
src/index.ts src/webhook.ts src/verify.ts src/rateLimit.ts src/queue.ts src/worker.ts
src/brain/scan.ts src/brain/trim.ts src/brain/classify.ts src/brain/summarize.ts src/brain/suggest.ts
src/linker.ts src/progress.ts src/formatter.ts src/scheduler.ts src/subscriptions.ts src/telegram.ts src/github-sync.ts
prisma/schema.prisma test/fixtures/
```
