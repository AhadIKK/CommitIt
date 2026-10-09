# Changes

## 2026-10-09 — Phase C: login + server-side sessions + BFF access gates (spec build)
- Added: server-side sessions (`Session` rows hold only the SHA-256 of a 32-byte id; cookie is `v1.<sid>.<hmac>`, HttpOnly/SameSite-Lax/Secure); `src/access.ts` (`canAccessRepo`: active install + owner/member, `checkRepoAccess` → 401/403); `/api/auth/login` canonical path (legacy `/api/auth/github` kept).
- Changed: callbacks create session rows + revoke-safe logout (both shells); `/api/me` resolves via DB; all 4 BFF endpoints (both shells) gate on session + access — 401 logged_out / 403 forbidden, DB outages still 200-empty; dashboard maps auth errors to sign-in prompts.
- BFF exceptions stay exactly the two allowed: POST `/api/auth/logout`, Telegram link-confirm (`link-token`/`link-code` untouched).
- Reason: per-user repo visibility; revocation (logout, `github_app_authorization`) actually invalidates.
- Verification: `test/access.test.ts` (owner/member/stranger/suspended/install-less matrix + 401/403/ok); rewritten `test/session.test.ts`; `api.test.ts` covers 401/403/200-empty. Gate green (24 files / 114 tests, `tsc --noEmit`, `npm run build`).
- Added: migration `3_install_lifecycle` (Installation, UserInstallation, Session hash-only, LinkToken hash-only, Repo.installActive/syncEtag/lastSyncAt — applied to Supabase, all tables/columns verified live); `src/installations.ts` (record/remove/suspend/revoke writes); `src/backfill.ts` (per-install paginated sync with ETag 304-skip + 429/403 RateLimitedError for worker backoff); worker `backfill` job; delivery gates (`resolveRecipients` returns nobody + `dispatchDueNotifications` fails queued notes when `installActive=false`).
- Changed: `parseInstallationEvent` (suspend/unsuspend kinds, account info, `repositories_added/_removed` shapes); install branches in `api/github-app.ts` + `src/auth.ts` route through the lifecycle module; `github-sync.ts` upserts extracted to `storeSyncedIssues()` (behavior unchanged); `attributeInstallToSender` returns userId; `claimUserRepos` writes join rows.
- Fixtures: installation_deleted/suspend/unsuspend/repositories, github_app_authorization.
- Reason: installs drive profiles + access gating; revocation kills sessions; backfill seeds history without webhooks.
- Verification: `test/installations.test.ts` + `test/backfill.test.ts` (ETag/429/pagination mocked); full gate green (23 files / 107 tests, `tsc --noEmit`, `npm run build`).
- Added: `src/githubAuth.ts` (App JWT reuse, in-memory installation-token cache with ~5-min refresh skew, PEM normalize for base64 + `\n`-escaped forms, authenticated API fetch wrapper). No Octokit: plain `fetch` per plan.md §18 (named deviation from spec, justified: zero new deps, matches `github-sync.ts`).
- Changed: `.env.example` (+`GITHUB_APP_PRIVATE_KEY` raw-PEM alternative).
- Reason: token minting/cache foundation for install lifecycle (B), login claim (C), backfill (B); tokens never persisted.
- Verification: `test/githubAuth.test.ts` (7 tests, mocked clock + stub HTTP); full gate green (21 files / 99 tests, `tsc --noEmit`, `npm run build`).

## 2026-10-01 — Phase 6 extras + Phase 7 dashboard
- Phase 6: `pull_request` / `check_run` webhooks (fixtures + Zod + `enqueueJob`), worker handlers (PR-merged truth incl. squash, CI fail/fixed instant alerts, secret first-class 🔑 alert with path only, `stale_check` jobs via `findStaleBranches()`), `directToMain` risk flag in digests. Duplicate-delivery fast-path (`deduped:true`) + test.
- Phase 7: read-only Vite+React dashboard in `dashboard/` (donut, author bars, issues table, digest timeline, theme.md dark style), shared types from `src/dashboard.ts`, BFF `GET /api/progress|activity|issues|digests`, Vercel mirrors in `api/`, build output to `public/`. Root `npm run build` now compiles backend + dashboard.
- Reason: close out all plan phases; BullMQ/Redis deferred (no measured volume — PG poller stays).

## 2026-09-30 — Render live (API-driven setup)
- Postgres `commitit-db` (dpg-..., free, v16, singapore) + web service `commitit` (srv-..., free, Node 22, singapore) at `https://commitit-brqq.onrender.com`.
- `DATABASE_URL` (internal string) set via API; `GITHUB_WEBHOOK_SECRET=change-me-in-dashboard` placeholder. Deploy `dep-dauda0...` live, `/health` → `{ok:true}`.
- Note: free Postgres expires 2026-10-30 (Render policy); free web sleeps when idle (~30s cold start).
- API key used via env var only, never committed (verified clean).

## 2026-09-30 — Revert hybrid, single-stack Node (per Downloads/plan.md)
- Dropped: Python service, `PYTHON_URL`, private HTTP contract, dual test suites, compose `python` service.
- Now: `src/brain/` in-process TS functions, PG job table with `status/attempts/next_retry_at` polled via `SKIP LOCKED`, all enqueueing via `enqueueJob()` for future BullMQ swap.
- Fixed: Prisma picked (no Drizzle alternative), char-cap primary + `gpt-tokenizer` estimate-only, rate-limit rule kept, secret alert first-class.
- Synced: `plan.md` overwritten from `Downloads/plan.md` + fixes; `agents.md` rewritten single-stack, duplicate layout removed.

## 2026-09-30 — Hybrid: Node edge + Python brain (REVERTED)
- Changed: Node (Fastify + BullMQ + Octokit + Telegram + scheduler/progress) handles all I/O; Python (FastAPI, private-only) handles `/scan`, `/trim`, `/classify`, `/summarize`, `/suggest-link`.
- Reason: use Node for burst webhooks/scheduling/delivery, Python for text/AI libs (tiktoken, unidiff, evals).
- Contract: Node → Python private HTTP 8s timeout with degraded fallback (raw msg). Python stateless, no Telegram/queue writes. Shared Postgres + Redis via compose.
- Reason: single BullMQ queue (no dual-queue complexity), Python never public.

## 2026-09-30 — Gap fixes to `commitit-project-plan.md` (9 items)

1. **Data model (chats/subscriptions):** `users.telegram_chat_id` → `users` + `chats` + `subscriptions(chat_id, repo_id, digest_mode, quiet_hours, filters)`. UNIQUE(chat_id, repo_id). Prefs per-subscription. Fixes group-chat + multi-repo.
2. **Missing tables:** added `pull_requests` + `builds`. Required by V1 PR/CI features.
3. **Progress edge cases (§9):** reopened → recompute from API; empty milestone → `no issues yet` (no div/0); unlabelled → weight 1 + `* includes N unestimated` footnote.
4. **Telegram limits (§10):** formatter rules — 3800-char truncate, ~15-commit cap, `+N more + compare link`; >10-commit push always collapsed; merge/force-push display strings.
5. **Secret contradiction (§4.10):** local scan before LLM; alert with path only; skip file in LLM payload; store `secret_flag`, never secret value.
6. **Merge/squash/force-push (§4.11):** `is_merge` via PR, squash via PR merged event, `forced:true` → alert + exclude from activity, direct-to-main → risk flag. Added `is_merge`, `is_force_push_context` to `commits`.
7. **Goal linking (V1):** 4-level order closes > #N/branch > PR inherit > AI suggest as Unlinked (manual `/link` confirm). Added `/link` command.
8. **Queue (§7):** `enqueue(event)` interface; BullMQ (Node) / Dramatiq-arq (Python); DB poll allowed for MVP only.
9. **Dashboard auth (V2):** GitHub OAuth, repo-scoped read-only.
10. **Flow (§6):** updated to secret-scan-first + idempotency + truncation.

## Template (new entries on top)
```
## YYYY-MM-DD — <title>
- Changed: ...
- Reason: ...
```
