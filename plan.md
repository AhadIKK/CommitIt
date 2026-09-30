# CommitIt — Build Plan

Source of truth: `commitit-project-plan.md`. Revised 2026-09-30: single Node.js stack (Python dropped, see rationale).
Goal: GitHub webhooks → classify → link to Milestone/Issue → batched Telegram updates.

## Architecture (single stack — Node.js)

```
GH webhooks → Node API (HMAC verify, rate limit, idempotency) → job table (Postgres) →
Node worker (scan → trim → classify → summarize → link) → Postgres →
Node formatter/scheduler → Telegram
```

**Why one stack, not Node+Python:** every job the "Python brain" was doing — regex secret scanning, diff trimming, LLM calls, token counting, keyword match for unlinked commits — has a solid Node equivalent (`gpt-tokenizer`, any LLM SDK's Node client, plain `RegExp`). None of it needed a Python-only ML dependency. Splitting it added a network hop, timeout/fallback contract, compose service, and second test suite for zero gain — and doubled the surface for agent drift. One language, one repo, one dependency graph.

- **Ingress:** public HTTP endpoint, HMAC verification, rate limiting, `events.delivery_id` dedupe (insert-or-skip).
- **Jobs:** MVP uses Postgres-backed job table with `status (queued/processing/failed/done)`, `attempts`, `next_retry_at`, polled via `SELECT ... FOR UPDATE SKIP LOCKED`. All enqueueing goes through `enqueueJob(event)` in `src/queue.ts` so a BullMQ/Redis swap in Phase 6 is one file. No Redis until volume justifies it.
- **Worker pipeline (in-process, plain functions):** `scan()` (secret regex first, on raw diff, before anything else) → `trim()` (char-cap primary: 8KB/200 lines, skip lockfiles/binaries/vendor) → `classify()` (conventional-commit fast path, else heuristic/LLM) → `summarize()` (LLM, cached by SHA) → `linkToIssue()` (closes/#N → branch → PR inherit → heuristic suggest, never auto-assign).
- **Fallback:** LLM timeout/error → store raw message, send degraded Telegram message (no AI summary), mark job done (don't block pipeline).
- **Storage:** Postgres via Prisma for schema + migrations. No hand-edited `schema.sql`; every change is a versioned migration in `prisma/`.
- **Delivery:** formatter, digest scheduler, Telegram bot/commands, and (Phase 7) dashboard BFF — all in the same Node app.

## Phases

### 0. Setup (2–3 days) — NOT STARTED
- [ ] Init repo: `src/`, `prisma/schema.prisma`, `.env.example`, README skeleton — Postgres only, no compose service beyond DB
- [ ] Create test GitHub repo + Telegram bot via BotFather
- [ ] `POST /webhook` logs raw payload via ngrok, returns 200
- Exit: raw push logged locally.

### 1. MVP (1 week)
- `src/webhook.ts`, `verify.ts` (HMAC), `rateLimit.ts`, `prisma/` (schema + first migration), `telegram.ts`, `queue.ts` (`enqueueJob` + PG poller)
- HMAC `X-Hub-Signature-256` verify, rate limit, `X-GitHub-Delivery` dedupe, store event + commits, send Telegram on push grouped by author.
- Exit: real push → Telegram message (no AI yet).

### 2. Categorisation (1 week)
- Conventional-commit fast-path parser + `formatter.ts` (3800-char cap).
- Heuristic classifier for vague messages + `trim()` (char-cap primary, 8KB/200 lines, skip lockfiles/binaries/vendor).
- Tests: formatter + classifier against terrible-messages fixture.
- Exit: `fix`, `update` still produce sensible category.

### 3. Goal tracking (1–2 weeks) — ship usable version after this
- `github-sync.ts` (Octokit), `linker.ts` (closes/#N → branch → PR inherit), `progress.ts` (reopened, empty milestones, unestimated).
- Heuristic `suggestLink()` (keyword/title match, no embeddings, never auto-applied).
- Commands: `/progress`, `/status`
- Exit: milestone % matches hand-check.

### 4. AI layer (1 week)
- `summarize()`: LLM call behind provider interface, cache by SHA, respects `ai_enabled`, char-cap enforced before call; `gpt-tokenizer` used only as secondary estimate (provider-dependent, not source of truth).
- `scan()` runs before `summarize()` on every commit — secrets never reach LLM.
- Exit: 80% summaries judged accurate, cost capped and logged.

### 5. Noise control (1 week)
- `scheduler.ts`, `subscriptions.ts`
- Digest modes (instant/hourly/daily), quiet hours (reschedule, not drop), batching, `/mute`, `/digest`, `/who`.
- Load test: 100-push burst → one digest.
- Exit: 1 day of commits = 1 digest.

### 6. Extras (2 weeks)
- PR/CI events (`pull_requests`, `builds`), stale-branch/inactivity alerts, secret-detection alert (first-class notification), force-push/direct-to-main flags.
- Revisit BullMQ/Redis only on measured volume — swap via `queue.ts` interface.

### 7. Dashboard + polish (2 weeks)
- React dashboard (same repo, shared TS types), GitHub OAuth (repo-scoped read-only), docs, demo video, deploy single service (Render/Railway/Fly).
- Exit: 2 weeks uptime, setup <5 min.

## Data model
See project plan §8 (chats, subscriptions, repos, authors, commits, issues, milestones, pull_requests, builds, events, notifications + jobs). Managed via Prisma migrations from Phase 1 onward.

`jobs`: id, `delivery_id` UNIQUE, type, payload JSONB, `status`, `attempts`, `next_retry_at`, created_at, updated_at.

## Decisions still open
1. ~~Node vs Python~~ → DONE 2026-09-30: single Node.js, Python dropped.
2. AI provider + monthly cost cap
3. Hosting (single public Node service)
4. Personal vs multi-user

## Key invariants (unchanged)
- Progress = weighted closed issues only. Commits = activity, never progress.
- `events.delivery_id` UNIQUE (insert-or-skip).
- Secret scan before any LLM call, every commit, no exceptions.
- Telegram truncate at 3800 chars + compare link.
- Prefs on `subscriptions(chat_id, repo_id)`, not on users.
- Webhook endpoint rate-limited.
