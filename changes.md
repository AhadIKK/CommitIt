# Changes

## 2026-10-17 — Telegram webhook primary (12/12 intact) + keep-warm cron fixed
- **Root cause of the intermittent bot:** the `*/10` keep-warm cron never ran every 10 min — GitHub produced 5 runs in 13h (2–4.5h gaps), so Render hibernated ~15 min after each ping and the bot was dead ~95% of the time. Every `Server listening` in the Render logs matched a cron tick on a brand-new pod (cold start), confirming the duty cycle.
- **Inbound moved to Vercel (primary):** `src/telegramWebhook.ts` + a `telegram` action on the existing `api/auth/[action].ts` dynamic function, reachable at `/api/telegram` via a `vercel.json` rewrite. **Function count unchanged at 12/12** — no new file under `api/`. Vercel never sleeps, so replies are instant 24/7.
- **Polling is the automatic fallback:** on HTTP 409 ("can't use getUpdates while webhook is active") the Render poller backs off to a 60s standby tick and logs the transition; deleting the webhook resumes it within 60s, no redeploy or env flag.
- **Body-parsing bug fixed** (would have silently dropped every update): Vercel drains the request stream to parse JSON, so the handler prefers the pre-parsed `req.body` and only reads the stream when it is absent.
- **Keep-warm rewritten as a long loop:** one job per 6h pinging every 10 min for ~5h50m. A running job is never throttled, so only the start can be delayed, and Render's 15-min idle timeout absorbs that. Free (public repo). Fails the run only after 3 consecutive misses (30 min = real outage).
- Auth on the webhook: `TELEGRAM_WEBHOOK_SECRET` (rotated), timing-safe compare, 503 when unset, 401 on mismatch, always 200 past the gate so poison updates can't retry-storm.
- Tests: webhook gate/dispatch (incl. the pre-parsed-body regression), poller standby/resume, and route reachability. 44 files / 229 green.


## 2026-10-17 — Orphaned `processing` jobs are reclaimed, not lost
- Root cause: `claimNextJob()` only selects `status = 'queued'`, so a job held when the instance died (Render free sleep/deploy/crash) stayed `processing` forever and its event was silently lost. Live DB had 5 such zombies (1 backfill ~5.6 days, 4 push up to ~24.7h), all `attempts=1`.
- `reclaimStuckJobs()` (`queue.ts`) lease-times-out `processing` rows older than `JOB_STALE_MS` (default 10 min) back to `queued`, clearing `nextRetryAt`. Worker runs it on boot (fresh process ⇒ anything still processing is orphaned) and every ~2 min, logging `jobs_reclaimed_stale`.
- Tests: lease cut-off, exact status filter, DB-down returns 0, default lease; suite 41 files / 210 green.

## 2026-10-17 — Repair no longer needs a healthy install grant
- Frozen 28 unknowns: repair only ran for API-listed repos (zero under the empty grant), so legacy rows never healed. Backfill now unions API repos + DB-known repos for the install, and per-SHA repair retries public repos without auth when the token is refused.
- Tests: empty-grant union + public-fallback suites; 40 files / 206 green.

## 2026-10-16 — Keep-warm cron for the sleeping worker
- Render free sleeps after ~15 min idle, freezing Telegram inbound, backfill, and digests until traffic wakes it (this week's every mystery). `.github/workflows/keep-warm.yaml` pings `/health` every 10 min. Revisit with paid hosting or Telegram webhook mode once testers become users.

## PARKED 2026-10-16 — install 171066945 grants zero repos via API
- Backfill runs fine (8× `backfill_done`) but GitHub reports 0 repos on the live install; old install 170384988 404s. UI grant page shows AhadIKK/CommitIt selected. Next step when resumed: Sync now → read fresh `backfill_done` totals → repos:1 means healed, zeros means trace that exact install ID.
- Do NOT touch: PR count 0 is GitHub's truth (0 open/closed ever); live GitHub main count + auto-refresh shipped.

## 2026-10-14 — Backfill outcome logging ends the blind debugging
- `backfill_done` (with totals: repos/issues/milestones/prs/authorsRepaired) and `backfill_failed` now log on the worker; sync logs `install_sync_wake` (woke true/false) on Vercel. Next Sync click leaves a complete trail across both hosts.
- Test: worker backfill job asserts the done log + totals; 40 files / 204 green.

## 2026-10-14 — Sync wakes the sleeping worker so backfills actually run
- Root cause of stuck unknowns/0 PRs: backfill jobs queue in Supabase but the free Render worker sleeps — its poller only lives while awake, and nothing wakes it. Zero Render POSTs in 24h + 22s cold start proved it.
- `syncUserInstalls` now pings `WORKER_URL/health` (new `src/workerWake.ts`, 5s cap, never throws, skipped when unset) after enqueueing backfills. Set `WORKER_URL` on Vercel Production. Render wakes on the incoming connection even if we stop waiting.
- Tests: `workerWake` suite (skip/ok/down); 39 files / 203 green.

## 2026-10-14 — Authors attributed + PR history backfilled
- "unknown" authors: the live worker path (`processPush`) never set `authorId` — only the serverless path did. Now both attribute via `commitAuthorLogin()` (username, else display name). Avatars were always identicons by design; they differentiate correctly once names resolve.
- 0 merged PRs: backfill explicitly skipped PRs and only live `pull_request` events recorded — pre-install history read 0 forever. New `backfillRepoPRs` (closed → merged only, no body fetch) rides `backfillInstallation`, so the next Sync now heals PR counts. `repairCommitAuthors` heals up to 50 unattributed SHAs per sync the same way.
- Tests: PR backfill, author repair, login helper; suite 38 files / 200 green.

## 2026-10-14 — Topbar brand settled into two-line lockup
- Tagline floated mid-height beside the name (ragged row). Brand is now logo + stacked name/tagline, left-aligned; input/Load/theme row untouched. Dashboard rebuilt.

## 2026-10-14 — Auto-refresh always on, checkbox removed
- Dropped the oversized checkbox: dashboard is live by default (quiet 30s poll + refocus reload). Only Refresh + Export CSV buttons remain in the Activity head.

## 2026-10-14 — Activity totals match GitHub live + auto-refresh
- Why 61 vs 53: our rows span every pushed branch plus force-push orphans; GitHub counts the default branch only. 0 merged PRs is real (direct-push workflow — PR events are handled).
- New `src/githubCounts.ts`: default-branch commit count straight from GitHub (Link-header page count, installation token when available, 90s cache, null on any failure). `getActivity` carries it as `githubMainCommits`; header shows "N commits on main", falling back to "N commits tracked" offline.
- Dashboard Activity head: Refresh button + Auto-refresh toggle (quiet 30s poll + reload on tab refocus, persisted per browser). Quiet ticks never flash banners or clobber data.
- Tests: new `githubCounts` suite (Link parse, branch resolve, single-page, 404, cache); suite 37 files / 193 green. Dashboard rebuilt.

## 2026-10-14 — GitHub section remapped into clean rows
- `Auth.tsx`: account row (avatar + name + right-aligned Unlink), projects line, install-status row (with inline Install button when missing), sync row + message on its own line. Logged-out state keeps single login row. Avatar no longer orphans onto its own line.
- `.connect-row` wraps on mobile; new `.row-end` helper. Dashboard rebuilt; suite green (186).

## 2026-10-14 — Soft landing Welcome card replaces forbidden/auth error wall
- New `dashboard/src/Welcome.tsx`: first-run states (logged out / repo not accessible, no data) get a 3-step card (link account → install App → connect Telegram) with smooth-scroll buttons to the Telegram/GitHub sections, instead of the red `Error: Your account can't access this repo…`.
- `App.tsx` tracks error kind; empty Milestones/Activity/Issues/Digests sections hide while Welcome shows; genuine errors still render red. Dashboard rebuilt.

## 2026-10-14 — Sync falls back to DB repos on GitHub 404 + surfaces list status
- Prod showed `repos_list_404`: GitHub lists install 170384988 but won't serve its repo list. `listInstallRepos` now throws `repos_list_<status>` instead of a bare null.
- `syncUserInstalls` falls back to repo rows our webhooks already recorded for that install (attribution + membership + backfill still complete); new `install_sync_db_fallback` log. Only skips when GitHub and DB both have nothing.
- Test: 404 + local row → `{ synced: 1, status: "synced" }`.

## 2026-10-14 — Sync now reports honest statuses (not silent zero)
- `syncUserInstalls()` returns `{ synced, status }`: `synced` / `no_installs` / `app_not_configured` / `github_error`, with server-side `install_sync_failed` warns. Unknown login maps to `no_installs`; down store / GitHub failure maps to `github_error`.
- Both shells (`api/me.ts`, `src/auth.ts`) pass the status through; dashboard shows "not configured — check env" / "couldn't reach GitHub" instead of blaming the user.
- `fetchAppInstallations` / `mintInstallationToken` now use `appKeys()` (raw PEM or base64) — previously base64-only, so Render-style raw-PEM deploys always reported `app_not_configured`.
- Tests: updated sync contract, added `app_not_configured` + `github_error` cases; fixed stale `authApi` 405 test (pre-existing red on clean HEAD — POST without op is 404, PUT is 405). Suite: 36 files / 185 tests green. Dashboard rebuilt.

## 2026-10-13 — Persistent website link state + explicit unlink
- Fixed: `Connect` forgot the link on refresh (local-only state). It now persists the link proof per repo in localStorage, re-verifies against the server on mount, and drops stale proofs.
- Added: website Unlink — `unlinkByProof()` (`linkTokens.ts`) deletes a chat's subscription on proof of a completed link (deep-link token hash or legacy code, claimed-only), mirrored as `op=unlink-sub` on both backends; `op=link-status` answers whether a stored proof is still live. Unlink only ever happens on explicit user action (button or bot /unlink).
- Reason: refresh must never look like an unlink; unlink must never happen without the user asking.
- Verification: new `unlink` tests (8: helper, both backends, validation, degraded paths); full gate green (35 files / 178 tests, both typechecks, dashboard build).

## 2026-10-13 — Real AI provider + stale-check scheduling
- Added: `src/ai/providers/openaiCompatible.ts` (`AI_PROVIDER=openai`, `AI_MODEL`, `AI_BASE_URL`, key, per-1M prices, `AI_MONTHLY_CAP_USD`); usage + spend logged as JSON per call, cap enforced by degrading to raw-message fallback. Spend ledger is in-memory (resets on restart; logs are the durable record).
- Added: `startStaleScheduler()` (`scheduler.ts`, wired in `index.ts`) — hourly tick enqueues one dated `stale_check` job per `STALE_CHECK_REPOS` entry (idempotent via delivery id); no-op when unconfigured. `STALE_DAYS` is the default threshold.
- Env parity: new AI/STALE keys in `.env.example` + `render.yaml` (all `sync: false`).
- Reason: close the two remaining build-list items (5: real AI + cap, 6: stale scheduling).
- Verification: new `aiProvider` (6) + `staleScheduler` (3) tests; gate green below.

## 2026-10-12 — Telegram sender joined to GitHub account on /start
- Added: migration `4_link_token_owner` (`LinkToken.githubLogin`, applied live); deep-link tokens issued for the logged-in website user; `/start` claim joins the Telegram sender id to that account (first-wins, never steals).
- Reason: `/repos` and `/bind` identify the sender via `User.telegramUserId`, but no flow ever set it — every sender looked unlinked.
- Verification: binding/first-wins/anonymous tests. Gate green (30 files / 147 tests, `tsc --noEmit`, `npm run build`).
- Added: `api/link.ts` (issue/poll/claim via `?op=`, one function — still 11/12 slots); dashboard `linkApi` points at it.
- Changed: Fastify linking routes merged to the same `POST|GET /api/link?op=` contract (single contract everywhere; old paths retired).
- Reason: the Connect button called `POST /api/link-token`, which existed only on the local server — production 404d.
- Verification: `test/linkApi.test.ts` (issue/poll/claim/validation) + updated `linking.test.ts`. Gate green (30 files / 145 tests, `tsc --noEmit`, `npm run build`).
- Changed: `ActivitySnapshot` gains `totalCommitsAllTime` / `totalMergedPRsAllTime` (two extra counts in `getActivity`); dashboard Activity heading shows them next to the 7d view.
- Reason: the 7d window silently slid past the first backfill batch (19 shown vs 33+ total); all-time figures stop the confusion.
- Verification: shape expectations updated. Gate green (29 files / 141 tests, `tsc --noEmit`, `npm run build`).

## 2026-10-12 — Render worker blueprint fixed
- Changed: `render.yaml` — dropped hardcoded `PORT` (Render injects its own; hardcoding fails health checks), dropped `prisma migrate deploy` from build (this DB has no migration history and `DIRECT_URL` points at the pooler, where deploy locks fail — migrations stay manually applied, idempotent SQL), declared all runtime env vars (Telegram bot + name, GitHub App set, session secret).
- Reason: make the Blueprint deployable as the worker host (API + poller + bot polling via `npm start`).
- Verification: YAML-only change; no code touched (no test/build impact).
- Changed: `/api/auth/callback` (both shells) accepts GitHub's combined landing (`?code=&installation_id=`, no state): when the code owner's login matches the installation account, login completes immediately with the install claimed; otherwise it stashes the id and bounces through a state-bound login. Secret check moved after state resolution; `syncUserInstalls()` (rows + owner + member + backfill) replaces `claimUserRepos` everywhere.
- Reason: with OAuth-during-install checked, GitHub never runs our login starter, so no state cookie exists — the old code 400d a perfectly valid landing.
- Verification: bounce/invalid-id tests (no network); full gate green (29 files / 141 tests, `tsc --noEmit`, `npm run build`).
- Changed: `/api/auth/callback` (both shells) accepts install landings (`?installation_id=`, no code): stashes the id in a short-lived cookie and bounces through login, then claims the install post-session and redirects with `?setup_claimed=1` (dashboard shows a notice). Combined code+install landings claim in one pass.
- Reason: with "Request user authorization during installation" checked, GitHub disables the Setup URL and redirects installs to the OAuth callback URL instead.
- Verification: bounce + invalid-id tests (no network). Gate green (29 files / 141 tests, `tsc --noEmit`, `npm run build`).
- Added: `registerInstallFromSetup()` in `src/installations.ts` — registers an install from GitHub's Setup-URL redirect (`?installation_id=`) by reading the installation + repos as the App (JWT), recording rows, attributing the owner, and queueing a backfill. Surfaced as `GET /api/repo?installation_id=` (both shells, session-required, rate-limited) + dashboard auto-claim with notice on landing.
- Reason: some App setups don't offer the `installation` / `installation_repositories` / `github_app_authorization` webhook events; installs must still register. No new serverless function (repo endpoint reused — still 11/12).
- Verification: setup-claim unit tests (stubbed App API + mocked DB, incl. no-config degrade) + route 401/400 tests. Gate green (29 files / 139 tests, `tsc --noEmit`, `npm run build`).
- Changed: `POST /api/webhook` now stores push commits directly (repo/author/commit upserts, raw metadata only — no AI/linking on serverless; idempotent on `(repoId, sha)`; DB failure still acks 200). Previously it only logged, so pushes changed nothing on Vercel-only deploys.
- Reason: make "push something and see the dashboard update" actually work without a long-lived worker host.
- Verification: `test/webhookIngest.test.ts` (direct store counts, signed-delivery 200 + stored, DB-down 200). Gate green (29 files / 136 tests, `tsc --noEmit`, `npm run build`).
- Changed: repo-access gates enforce only when GitHub OAuth is configured (`GITHUB_CLIENT_ID` set). Without it there is no way to log in, so the read API stays public (`isAuthEnforced()` in `src/access.ts`, honored in all 4 BFF endpoints × both shells).
- Reason: Phase C locked out webhooks-only setups (dashboard 401 with no login available). GitHub repo data is public anyway; the gate protects attribution, and snaps on the moment OAuth is configured.
- Verification: gate tests set `GITHUB_CLIENT_ID` explicitly; public-mode covered by the degrade tests. Gate green (28 files / 133 tests, `tsc --noEmit`, `npm run build`).
- Added: `repository` events end-to-end (deleted → deactivate + drop cached install token, data retained; renamed → row moved); install-token cache purge on delete/suspend; fixtures repository_deleted/renamed.
- Changed: README setup rewritten (GitHub App creation, Vercel env table, install→link→bind flow, queue-needs-a-host note, manual webhooks marked dev-only fallback).
- Verified hardening matrix: revoked authorization kills sessions (B, tested); deleted/suspended installs flip `installActive` + stop delivery instantly incl. already-queued notes (B, tested); expired sessions rejected + near-expiry install tokens re-minted (A/C, tested); deleted repos deactivate; renamed repos keep routing.
- Reason: close the access-loss gaps; docs match the App model.
- Verification: installations/authApi route + unit tests extended. Gate green (28 files / 133 tests, `tsc --noEmit`, `npm run build`).
- Added: `src/reconcile.ts` (pure `diffIssues` + `reconcileRepo` with ETag-style guarded pruning + targeted `pruneMilestone`); worker `milestone` case (prune-on-deleted, then recompute) and `progress_sync` case (operator-enqueued, like `stale_check` — no scheduler exists yet); `MilestoneSchema` routing in all four webhook shells.
- Changed: `fetchIssues` returns `truncated` (page-cap guard so reconcile never prunes from partial listings).
- Fixtures: milestone_closed/deleted.
- Reason: milestone open/close/delete moves progress the same event-driven way issues do; reconcile fixes drift (missed deliveries) without ever counting commits.
- Verification: `test/reconcile.test.ts` (diff matrix incl. truncated-no-prune, live reconcile + prune with mocked DB/stub HTTP) + `test/milestone.test.ts` (schema + end-to-end route). Gate green (28 files / 131 tests, `tsc --noEmit`, `npm run build`).
- Added: `src/linkTokens.ts` (32-byte deep-link tokens, SHA-256-only storage, constant-time re-compare, expiry + single-use); `src/chatAccess.ts` (DM: GitHub-linked + repo access; groups: + admin via getChatMember); bot `/repos` picker (accessible + bound marks), `/bind owner/repo`, `/unlink [owner/repo]` (groups: admin-gated both ways); per-command rate limits; auth start/callback rate-limited in both shells.
- Changed: website `link-token` issues/polls via LinkToken (Connect UI unchanged); bot `/start` claims hash-first with legacy raw fallback until expiry; sender id + chat type plumbed through polling.
- Deferred + documented: legacy `/link` 6-letter codes stay raw on TelegramLink (rate-limited, 10-min, single-use — hash adds little at ~30 bits entropy).
- Reason: no-token-in-DB linking; groups can't be bound/unbound by non-admins or unlinked strangers.
- Verification: `test/linkTokens.test.ts` (mint/claim/reuse/tamper/expiry) + `test/botCommands.test.ts` (start/bind/admin-denial/repos/unlink/rate-limit, stubbed Bot API). Gate green (26 files / 122 tests, `tsc --noEmit`, `npm run build`).
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
