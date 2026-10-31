# AGENTS.md — CommitIt

## Project
GitHub → Telegram progress tracker. Single-stack Node.js + TypeScript. Chat-first reporting layer, not a project manager. See `plan.md` + `theme.md`.

## Commands
- Dev: run Postgres locally, `npm run dev` (:3000). No compose services beyond DB in MVP.
- Webhook local test: `ngrok http 3000`, replay fixtures in `test/fixtures/*.json` to `POST /webhook`.
- Tests: `npm test` (vitest: formatter, progress, verify, classifier, trim, scan). Required before merge.
- DB: Postgres via Prisma; migrations in `prisma/`. Never hand-edit DB; add a migration. See `prisma/BASELINE.md` — history table was never created, so `migrate deploy` is unsupported; schema changes ship as reviewed `migration.sql` applied via API.

## Hard rules (from gap fixes — do not regress)
1. **Verify HMAC** `X-Hub-Signature-256` on every webhook. Reject on mismatch. Rate-limit endpoint (`src/rateLimit.ts`).
2. **Idempotency:** `events.delivery_id` UNIQUE from `X-GitHub-Delivery`. Insert-or-skip before processing. Same for `jobs.delivery_id`.
3. **Queue:** all enqueueing via `enqueueJob()` in `src/queue.ts`. MVP poller uses `SELECT ... FOR UPDATE SKIP LOCKED` on `jobs(status, attempts, next_retry_at)`. Retry with backoff, don't silently drop on Telegram/GitHub 429.
4. **Progress ≠ activity:** progress reads `issues`/`milestones` only. Never increment counters; recompute from source of truth on `closed`/`reopened`/`merged`.
5. **Empty milestone:** return `no issues yet`, never divide by zero.
6. **Secrets:** `scan()` BEFORE `summarize()` on every commit. On match: alert with file path only, skip file in LLM payload, store `secret_flag=true`. Never log/store secret values or full source.
7. **LLM payload:** char-cap primary (8KB/200 lines max), skip lockfiles/binaries/generated/vendor. `gpt-tokenizer` is estimate only. Cache by SHA. Respect `repos.ai_enabled=false`. Degraded fallback (raw msg) on timeout/error.
8. **Telegram limits:** truncate at 3800 chars, cap ~15 commits, append `+N more + compare link`. Push >10 commits always collapsed.
9. **Merges/force-push:** `is_merge` → link via PR, no AI summary. `forced:true` → risk alert, exclude from activity. Squash → PR merged event is truth.
10. **Prefs scope:** per-`subscriptions` row (chat × repo). Never put digest/quiet-hours on `users`.
11. **Linking:** strong (`closes #N`) > weak (`#N`/branch) > PR inherit > heuristic suggest as `Unlinked work`. Never auto-assign suggestion.
12. **Author attribution:** every commit store sets `authorId` (username, else display name via `commitAuthorLogin`). Both ingest paths (serverless + worker) — unattributed rows render the whole dashboard as "unknown".

## Code conventions
- Single language (TS). No second service. Brain logic lives in `src/brain/` as pure in-process functions, not HTTP calls.
- Adapters behind interfaces: `src/channels/telegram.ts`, `src/ai/providers/*`. New provider = new file, no core edits.
- Pure functions where possible: `scan()`, `trim()`, `classify()`, `summarize()`, `linkCommit()`, `milestoneProgress()`.
- Never store source code; metadata + short summaries only.
- Telegram HTML parse mode; escape user content. Validate webhooks with Zod.

## File layout (single-stack)
```
src/webhook.ts verify.ts rateLimit.ts queue.ts worker.ts
src/brain/scan.ts trim.ts classify.ts summarize.ts suggest.ts
src/linker.ts progress.ts formatter.ts scheduler.ts subscriptions.ts telegram.ts github-sync.ts
src/auth.ts session.ts githubApp.ts
src/ai/providers/*.ts
prisma/schema.prisma test/fixtures/ .env.example
```

## PR checklist
- [ ] Fixture for new webhook type
- [ ] Duplicate-delivery test passes
- [ ] Formatter under 3800 chars on 20-commit push
- [ ] No secrets in logs/diffs
- [ ] `enqueueJob()` used (no direct BullMQ/Redis imports outside `queue.ts`)

## Multi-agent collaboration (Antigravity & OpenCode)
- **Coordination files:** `AGENT_SYNC.md` is the shared board (message board + handoff log). The **lock itself is the `.agent-lock/` directory**, because `mkdir` is atomic and a table cell is not — two agents that read "IDLE" and then write "LOCKED" both believe they won.
- **Scoped, so parallel work is possible:** holders declare the paths they touch. Disjoint scopes (backend `src/**`, frontend `dashboard/**`) run at the same time; overlapping scopes are refused. State lives in `.agent-lock/state.json` and every write goes through a directory mutex, so two agents cannot corrupt it.
- **Before modifying files:** run `node scripts/agent-lock.mjs status`. If someone holds a path you need, do not interrupt, overwrite, or edit it — pick disjoint paths or tell the user and stop.
- **When starting work:** `node scripts/agent-lock.mjs acquire --agent <name> --task "<objective>" --files "<paths>"`. Declare generously; an undeclared path is one the other agent believes is free. Long tasks: `heartbeat` so the lock isn't dropped as stale.
- **When finishing work:** run `npm test`, commit, then `node scripts/agent-lock.mjs release`, and add a handoff entry to `AGENT_SYNC.md`.
- **Message Board:** `node scripts/agent-lock.mjs note --agent <name> --text "<context>"` — appends, never rewrites, so it cannot clobber the other agent's work.
- **Stale locks:** 20 minutes without a heartbeat is dropped automatically. Never leave a lock held.
- **Mutating is wider than editing:** `npm test` writes to the shared Supabase database, and `git push` / `vercel deploy` change what the other agent sees. If your scopes both need one of those, coordinate first.
