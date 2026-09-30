# AGENTS.md — CommitIt

## Project
GitHub → Telegram progress tracker. Single-stack Node.js + TypeScript. Chat-first reporting layer, not a project manager. See `plan.md` + `theme.md`.

## Commands
- Dev: run Postgres locally, `npm run dev` (:3000). No compose services beyond DB in MVP.
- Webhook local test: `ngrok http 3000`, replay fixtures in `test/fixtures/*.json` to `POST /webhook`.
- Tests: `npm test` (vitest: formatter, progress, verify, classifier, trim, scan). Required before merge.
- DB: Postgres via Prisma; migrations in `prisma/`. Never hand-edit DB; add a migration.

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
src/ai/providers/*.ts
prisma/schema.prisma test/fixtures/ .env.example
```

## PR checklist
- [ ] Fixture for new webhook type
- [ ] Duplicate-delivery test passes
- [ ] Formatter under 3800 chars on 20-commit push
- [ ] No secrets in logs/diffs
- [ ] `enqueueJob()` used (no direct BullMQ/Redis imports outside `queue.ts`)
