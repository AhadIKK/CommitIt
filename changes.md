# Changes

## 2026-10-31 — The worker moved into a cron tick; Render is gone
- Render's free plan was running out, and it was only hosting the queue worker (`npm start` = Fastify + a 5 s poller + two schedulers). The database was never on Render — it has been Supabase since 12 Oct — so nothing needed migrating.
- New `POST /api/worker/tick` (`src/workerTick.ts`, routed through `src/workspaceRoutes.ts`) runs one bounded pass: reclaim orphaned jobs → send due digests → run both schedulers (no-ops unless their day/bucket is new) → claim and run up to 10 jobs, all inside a 30 s budget. Supabase `pg_cron` calls it every minute through `pg_net` (`prisma/sql/worker-tick-cron.sql`), keyed by `WORKER_TICK_SECRET` — constant-time compare, and an unset key answers 503 rather than leaving an open drain.
- The function is capped at 45 s and the schedule fires every 60 s, so two ticks can never overlap. That matters because `dispatchDueNotifications` is not atomic, and overlapping ticks could send the same digest twice.
- Digests go out **before** the drain, so a long job cannot push them past their slot.
- Long jobs stop instead of being killed: every job gets the tick's deadline, and `backfillInstallation` stops between repos and continues as a fresh job carrying its cursor (`<deliveryId>:r<index>`, which still matches the `sync-<id>-` prefix uninstall cancellation uses).
- `reclaimStuckJobs` now abandons a job that has burned `JOB_MAX_ATTEMPTS` claims instead of requeueing it forever — work that is longer than the host's cap would otherwise churn indefinitely.
- Auto-sync no longer queues a nightly backfill for an installation with zero repos (`embedclubpace` had 16 abandoned jobs, one per day).
- Deleted `render.yaml` and `.github/workflows/keep-warm.yaml`; the workflow existed only to keep the free instance awake. `npm run dev` / `npm start` still run the in-process poller for local work.
- Tests: worker tick (7), tick route (4), auto-sync (4), backfill resume (3), backfill continuation (1), reclaim attempts cap (1).

## 2026-10-18 — Bot: `/recent`, see the latest commits without leaving Telegram
- New command: **`/recent [owner/repo]`** lists the newest commits as one line each — short SHA, category, subject, author, age:
  `<code>a1b2c3d</code> <b>feat</b> add /recent command → #7 — octocat, 2h ago`.
- **Scoped to what the chat already owns.** With no argument it reads the repos this chat is subscribed to (the same surface `/digest` lists); with `owner/repo` it reads that repo, behind the *same* access check `/bind` uses — so a chat can never page through a repo its caller has no access to. In a group, the repo-argument form is admin-gated like `/digest`; the no-argument form is the chat's own data and stays open to members.
- **Read-only and recomputed from the source of truth.** No counters are touched (rule 4): it queries `commits` newest first by `committedAt`, with legacy nulls sorted last and falling back to `createdAt`. Rule 12 holds — an unattributed row renders `unknown`, never blank.
- **Flagged commits withhold their subject** (`🔑 possible secret — subject withheld`), matching `formatPush` rather than inventing a second behaviour for the same flag. Nothing secret is ever rendered.
- The list shows the commit **subject** (metadata we already store) and never the AI summary, so `/recent` works identically whether or not `summarize()` has run.
- `formatRecent()` + `timeAgo()` are pure and live in `src/formatter.ts`; the command in `src/telegramBot.ts`; the menu entry in `src/telegramUi.ts` is what makes `/re` autofill on a phone. Registered with `npm run bot:setup` (idempotent).
- **12 new tests** (`test/formatRecent.test.ts` 13 cases, `test/recentCommand.test.ts` 12 cases): bucketing, escaping, subject capping, the `+N more` tail, secret withholding, unattributed rows, the access denials, and the 3800-char cap.
- Note: `npm test` also reports 7 red suites that predate this change — the dashboard restructure on `main` deleted `dashboard/src/{telegramHtml,export,report}.ts` while `test/{telegramHtml,export,report}.test.ts` still import them, and `vitest.config.ts` has no `exclude`, so vitest now also tries to run the new Playwright specs in `e2e/`. Unrelated to the bot; left alone rather than fixed blind mid-refactor.

## 2026-10-17 — Why the site was slow: functions in US-East, database in Seoul
- **Root cause of both "slow to load" and the 8-12s after linking:** functions ran in `iad1` (Washington, D.C. — Vercel's default) while Postgres lives in `ap-northeast-2` (Seoul). Every DB round trip crossed the planet (~190ms each way), and the OAuth callback `await`s `syncUserInstalls()`, which writes one row per repo.
- **Measured, not guessed:** `/api/health` and `/api/meta` — which touch no database — sat at 410-660ms TTFB and never improved across six rapid hits. That is a floor, not warm-up. `X-Vercel-Id: bom1::iad1::…` showed the Mumbai edge handing off to a US-East function.
- **Fix 1 — `"regions": ["icn1"]`** in `vercel.json`. `icn1` *is* `ap-northeast-2`: the same AWS region as the database, so DB round trips drop from ~380ms to single-digit ms. Hobby allows exactly one function region.
- **Fix 2 — the worker wake no longer holds the request hostage.** `pingWorker()` was capped at 5s and awaited on the login path. Render wakes on the incoming *connection*, so waiting for the `/health` response only added boot time to whoever was waiting. Cap is now 1.5s.
- **Fix 3 — one less GitHub call per login.** `syncUserInstalls()` fetched each installation individually just to get `accountType`, which GitHub already returns on the app-installation listing — and which nothing in the codebase reads. `AppInstallation` now carries it and the per-install fetch is gone.
- **Fix 4 — the browser stopped revalidating static assets.** Content-hashed `/assets/*` were served `public, max-age=0, must-revalidate`; now `immutable` for a year. `favicon.svg`/`llms.txt` get a day, and the HTML gains `stale-while-revalidate=60`.
- 55 files / 336 tests green.
- **Fix 5 — one request instead of five.** The dashboard fired five API calls in two waves: `/api/me` first, then the four data calls in parallel — and a fresh visit to the bare URL paid a *second* data load, after the account answered and the repo switched. `api/data/[view].ts` replaces all five endpoints (`me`, `progress`, `activity`, `issues`, `digests`, plus the composite `all`), and `vercel.json` rewrites every old path to it, so no caller changed. `all` hands back the account *with* the data and resolves the default repo server-side (`prefer=1`, applied only as a fallback for a repo the caller can't read), so the page renders after one round trip in one wave. **Functions: 12 → 8.** A denied repo still reports the account — as a `denied` field in a 200 rather than a bare 401/403 — because the account is what tells Welcome which step to show.

**Measured:** every API call fell from ~400-450ms to ~230-260ms (Mumbai edge → Seoul function; it used to hand off to US-East), and a DB-backed read now costs only ~30-50ms more than one that touches no database — that round trip was ~190ms each way. `/assets/*` serve `max-age=31536000, immutable`.

- **Fix 6 — the chart stopped blocking first paint.** chart.js + react-chartjs-2 (138KB raw / 48KB gzipped) were statically imported by `components.tsx` and `modulepreload`ed by `index.html`, although only the two milestone rings ever use them. They now live in `dashboard/src/ring.tsx` and load on demand behind a `Suspense` placeholder that is the same size and the track colour, so nothing shifts when the rings arrive. Critical-path JS: **593KB → 456KB** raw, ~196KB → ~148KB gzipped.
- **Fix 7 — one identity call, not two.** The GitHub section and the Telegram section each called `/api/me` on their first render. `authApi.ts` now shares the *in-flight* promise — never the result — so a later call after sync/login/logout still reads fresh.
- 55 files / 336 tests green.

**Still open (next):** the only lever left is geography. Supabase sits in Seoul while the users are in India, so the ~230ms floor on every API call is distance — the client reaches the Mumbai edge quickly, and then the function is a private hop away in Seoul. Moving the Supabase project to `ap-south-1` (Mumbai) and pinning functions to `bom1` would collapse both hops, but it is a project migration (new project, data copy, `DATABASE_URL` changed in Vercel *and* Render), so it wants a decision, not a commit.

## 2026-10-17 — Dashboard: digest bodies render as content, not markup
- The Digests timeline printed `notification.body` as a plain text child, but that body is Telegram parse-mode HTML (`src/formatter.ts` emits `<b>`/`<code>`/`<a>`), so the card read `📊 <b>mohd-Affan16/Cloud-ai</b> — api-working`. Reported from a phone screenshot.
- New `dashboard/src/telegramHtml.ts` flattens that subset into styled spans: `b`/`strong` → bold, `i`/`em` → italic, `code`/`pre` → code, `a` → link. Unknown tags are dropped with their text kept; entities are decoded (`&amp;` last, so `&amp;lt;` stays a literal `&lt;`).
- Rendered as React nodes — never `dangerouslySetInnerHTML`, never `innerHTML` — so stored markup cannot inject. The `.doc` export re-escapes the decoded text and refuses non-`http(s)` hrefs. Capping applies to *rendered* length, so truncation can't split a tag or an entity.
- The same body was mishandled in its two other readers: the `Problems:` line of the weekly 3P summary sliced it raw, and **Export .doc** ran it through `escapeHtml`, so Word displayed the tags as text too. All three now share the shaper.
- `.digest-body` keeps the message's line breaks (`pre-wrap`) and sets `<code>` as a chip — most of what made the card unreadable.
- 17 new tests (`test/telegramHtml.test.ts`): the observed body, nesting, malformed markup/truncation, and the escaping guarantees.

## 2026-10-17 — Dashboard typecheck: "Sync now" status was mis-typed, not broken
- `dashboard/src/authApi.ts` declared `syncMyInstalls(): Promise<{ synced; status }>` but parsed `parse<{ synced: number }>` — a lie the compiler caught at `authApi.ts(28,3)`, which is why `tsc -p dashboard/tsconfig.json` never passed. `vite build` runs esbuild and typechecks nothing, so it shipped anyway.
- Runtime was already correct: `parse()` is a cast, and `src/installations.ts` really returns `InstallSyncResult` (`{ synced, status }`) — pinned server-side by `test/meSync.test.ts`, which asserts `status: "app_not_configured"` on the wire. Only the static type was wrong.
- Fixed by importing the server's own `InstallSyncResult` as a type instead of re-declaring a local four-value union, so the client's `status` branch in `Auth.tsx` cannot drift from `InstallSyncStatus`. The import is type-only, so the built bundle is byte-identical — no server code reaches the browser.
- `tsc -p dashboard/tsconfig.json` is now clean (that error was the last one); 51 files / 301 tests green.

## 2026-10-17 — Dashboard: "What each commit is about" section
- **New section** on the Dashboard tab (under Activity) listing the commits in the same 7-day window as Activity, newest first (default 20, max 50). Each row carries a short sha linked to the GitHub commit, author + avatar, date, branch, and category / merge / issue badges.
- **Subject vs. summary:** `commitSubject()` takes the first line, trimmed and capped at 200 chars. `meaningfulSummary()` suppresses the summary when it only restates the commit — the default `AI_PROVIDER=echo` stub stores `"AI summary: <first line>"` and the degraded path stores the whole message, so without this every row printed its subject twice. The formatter already hides those rows, but it still holds the in-memory `degraded` flag while the DB keeps only the text, so the dashboard compares instead. A real provider's summaries render as before.
- **No new Vercel function** (Hobby 12/12 is full): the rows ride the existing `/api/activity` payload as a new `commits` field via `getActivity(repo, days, limit)`, not a 13th `api/*.ts`. Both mirrors — `api/activity.ts` and the Fastify route — take the optional `limit`.
- Metadata only: sha, message, author, and the short stored summary. No diffs, no file contents (AGENTS.md rule 6). `secretFlag` commits get a `secret flagged` badge.
- 51 files / 301 tests green.

## 2026-10-17 — Bot UI: "/" autofill menu + inline buttons
- **Autofill:** `BOT_COMMANDS` (`src/telegramUi.ts`) is registered with `setMyCommands`, so Telegram clients now autofill and describe all 7 commands as you type, and show the "/" menu button. Applied with `npm run bot:setup` (`src/setBotCommands.ts`) — idempotent, re-runnable after any menu edit. Verified live with `getMyCommands`.
- **Buttons:** `/start`, `/link`, `/help` and the no-repos reply carry an "🌐 Open CommitIt" URL button (`APP_URL`, falling back to the deployed site). `/repos` gets one toggle per repo (`＋ o/r` subscribe / `✓ o/r` unsubscribe) and `/digest` gets Instant/Hourly/Daily/Weekly buttons.
- **Taps reuse the text handlers.** `callback_query` → `handleCallback` → the same `cmdBind`/`cmdUnlink`/`cmdDigest`, so every rule (linked account required, group changes are admin-only, per-command rate limits) applies to a tap exactly as to typed text. A successful toggle rewrites its own message via `editMessageText`, so ✓ marks and labels stay truthful; every tap is answered with `answerCallbackQuery` or the client spins the button forever.
- **One dispatcher:** `dispatchUpdate` now serves both the Vercel webhook and the Render poller, so commands and taps behave identically on either host (previously the message-dispatch logic was inlined in the webhook).
- **Telegram limits enforced in one place:** ≤32 commands with valid names/descriptions, `callback_data` ≤64 bytes (a repo too long to fit keeps the typed `/bind` path instead of a button that Telegram would reject), toast text ≤190 chars.
- `/help` is now listed in the help text (the autofill guard asserts the menu and help agree).
- 50 files / 288 tests green; Vercel function count unchanged at 12/12.

## 2026-10-17 — Bot "not working": missing outbound token on Vercel
- **Root cause:** `TELEGRAM_BOT_TOKEN` was never set on Vercel production. The webhook received updates correctly (Telegram: `pending_update_count: 0`, no delivery errors; Vercel logged the calls), the command handler ran, and `sendMessage()` hit its no-token branch — returning `{ok:true, placeholder:true}` and logging nothing. Every reply was silently discarded, and the fake `ok:true` hid it from every caller.
- **Verified inbound end-to-end** without messaging a human: issued a link token via `/api/link?op=issue`, posted a `/start <token>` update from a fake chat id, and watched the token flip to claimed in the DB — only reachable if Vercel parsed the body, dispatched `handleMessage`, and wrote to Postgres.
- **Fixed:** token added to Vercel production; `sendMessage` now returns `ok:false` and warns when the token is missing, logs Telegram's rejection reason on 4xx, and never throws on network errors (token never logged). 6 new tests.
- **Keep-warm revision:** the previous `0 */6 * * *` cron fires at the top of the hour — GitHub's documented worst case — and its 12:00Z tick was dropped entirely; the original `*/10` was always on minute 0 for the same reason. Now `7 */2 * * *` (off the hour) with a 2h30m ping loop and a `concurrency: keep-warm` group: the job outlives its own cadence, so a trigger always lands mid-run and the queued run starts the instant the current one ends — a gap would need 2h30m of dropped triggers. `push: [main]` is a second trigger source, so the loop re-arms on every deploy with no manual dispatch needed. One job runs at a time, so cost is ~24 runner-hours/day.
- Note: with inbound on Vercel, the keep-warm only affects digest/backfill punctuality — `dueAt <= now` delivery and delivery-id-idempotent schedulers mean a gap delays work rather than losing it.


## 2026-10-17 — History re-syncs itself; install backfill wakes the worker
- Two gaps made "automatic" untrue: (1) a fresh install enqueued its backfill but never woke the sleeping Render worker (only **Sync now** did), so a new tester's history could sit queued indefinitely; (2) the backfill ran once at install, so a long-lived repo only ever showed pushes made after install.
- `registerInstallFromSetup` now pings the worker after queuing (mirrors `syncUserInstalls`), logging `install_backfill_wake`. New testers' history starts on its own.
- New `startAutoSyncScheduler()` (`scheduler.ts`, wired in `index.ts`): every `SYNC_INTERVAL_HOURS` (default 24, 0 disables) it enqueues one `backfill` per non-suspended installation, re-running issues + merged PRs + commit history. Delivery id `sync-<id>-auto-<bucket>` is idempotent and matches the `sync-<id>-` prefix `cancelQueuedBackfills()` uses on uninstall. Runs in the worker process, so the same poller picks it up — no wake ping.
- Env: `SYNC_INTERVAL_HOURS` in `.env.example` + `render.yaml`.
- Tests: interval parsing + per-installation enqueue/idempotency/disable; suite 48 files / 260 green, `tsc --noEmit` clean.

## 2026-10-17 — Activity reads real commit dates; commit history backfilled
- Root cause of "commits exist but Activity is empty": the `push` webhook only records commits pushed *after* install, and there was no commit backfill — a freshly installed repo had zero `Commit` rows, so the 7d window read 0 while the header showed GitHub's live "164 commits on main". Verified against the live DB: installed repos had 0 commit rows.
- New `backfillRepoCommits()` (`backfill.ts`) pages `GET /repos/{full}/commits` (default branch, 10-page cap, 429 → `RateLimitedError`), storing `sha`, message, `branch`, `authorId`, and the real `committedAt`. Idempotent on `(repoId, sha)`; updates heal missing `committedAt`/`branch`/`author`. Rides `backfillInstallation` alongside issues/PRs → next **Sync now** heals every repo.
- `getActivity` now filters the window on `committedAt` (falling back to `createdAt` for legacy null rows), not on row-insert time — otherwise a history backfill would dump all past commits into "last 7 days".
- Worker `processPush` now persists `committedAt` + `branch` (it stored neither), matching the serverless ingest path.
- Tests: commit-backfill store/error/429 + activity-window `where` assertions; suite 45 files / 233 green, `tsc --noEmit` clean.

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
