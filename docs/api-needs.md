# CommitIt — what the frontend needs from the API

Branch `front-end-redesign`. **Implemented.** This document is the contract the redesign was built
against, and the backend now serves it: the product screens read live data from Postgres.

| Where | What |
|---|---|
| `src/contract.ts` | The payload types, once. `dashboard/src/api/types.ts` re-exports them, so the two sides cannot drift. |
| `src/workspace.ts` | Every read and write below, plus the pure shaping (`commitDto`, `issueDto`, `milestoneDto`, `buildAlerts`, …). |
| `src/workspaceRoutes.ts` | One router: auth/rate-limit gate, zod bodies, `handleWorkspace(path, method, …)`. |
| `api/product/[a]/…` | Vercel adapters that call the same router — one function per path depth, not twenty endpoints. |
| `src/index.ts` | Fastify registration for local dev, so both hosts run identical code. |

Every screen talks to exactly one interface — `CommitItApi` in `dashboard/src/api/client.ts` — and
never to `fetch` directly. `dashboard/src/api/http.ts` encodes the HTTP call for each method. The
mock adapter (`dashboard/src/api/mock.ts`) still satisfies the same interface and is what
`?state=…` (design review) and `VITE_API_MODE=mock` (Playwright) select:

```ts
// dashboard/src/api/index.ts
export const api = wantsMock() ? createMockApi() : createHttpApi();
```

Because the mock and the HTTP adapter implement the same interface, **every endpoint below has been
exercised by the UI in both adapters**: the shapes are known-good, not sketched.

Two implementation notes worth knowing before reading the table:

- **Live updates are polled, not streamed.** A serverless function cannot hold an SSE connection
  open, so `subscribe()` polls `/events?since=` every 30 s and reports `polling`; it only reports
  `live` after a successful poll. The UI's contract (`ActivityEvent` frames + a status callback) is
  unchanged.
- **The `/app/*` ledger screens read the same data.** They are tables, not a second product: one
  request, `GET /api/ops`, returns every repository, task, message, alert, delivery and job, and the
  eight screens read it through `dashboard/src/app/data.tsx`. Where the database does not store a
  value (a digest's point count, a chat's member count, a finding's file path) the payload says
  `null` and the table prints "not recorded" - it never estimates a number to fill a column. The
  seed file is now only the mock adapter's fixture (`dashboard/src/api/mockOps.ts`).

---

## 1. Endpoint map

`repoId` is CommitIt's own repository id (not `owner/name`); `:id` in a path is that id, URL-encoded.

| # | `CommitItApi` method | Endpoint | Verb | Returns | Shipped |
|---|---|---|---|---|---|
| 1 | `me()` | `/api/me` | GET | `Me` | `repos[]` + `telegramLinked` included; `POST /api/me?op=sync` stays in `src/auth.ts`. |
| 2 | `repos()` | `/api/repos` | GET | `Repo[]` | Lists every repo the session may read; falls back to all repos while auth is unenforced (local dev). |
| 3 | `today(repoId)` | `/api/repos/:id/today` | GET | `TodaySnapshot` | Folds progress + activity + issues + alerts into one first-paint request. |
| 4 | `goals(repoId)` | `/api/repos/:id/goals` | GET | `Milestone[]` | Reuses the weighted progress computation. |
| 5 | `goal(repoId, goalId)` | `/api/repos/:id/goals/:goalId` | GET | `GoalDetail` | 404 `goal_not_found` for a milestone of another repo. |
| 6 | `people(repoId)` | `/api/repos/:id/people` | GET | `PersonSummary[]` | Week-windowed; `closedTasks` from commits linked to closed issues. |
| 7 | `alerts(repoId)` | `/api/repos/:id/alerts` | GET | `Alert[]` | Derived from webhook health, secret flags, failed jobs and stale repos. |
| 8 | `linkCommit(repoId, sha, issueNumber)` | `/api/repos/:id/commits/:sha` | POST `{issueNumber}` | `{ok, sha, issueNumber}` | **The only write the dashboard performs.** Idempotent; refuses closed issues, foreign issues and secret-flagged commits. |
| 9 | `digests(repoId, mode?)` | `/api/repos/:id/digest?mode=` | GET | `DigestSettings` | Preview is rendered by `renderDigestBodies()` — the same function the sender uses. |
| 10 | `saveDigest(repoId, patch)` | `/api/repos/:id/digest` | PUT | `DigestSettings` | Writes the per-subscription row (rule 10), never `users`. |
| 11 | `sendTestDigest(repoId)` | `/api/repos/:id/digest/test` | POST | `TestDigestResult` | Uses the existing Telegram sender. |
| 12 | `settings(repoId)` | `/api/repos/:id/settings` | GET | `RepoSettings` | Includes `aiAvailable` so the toggle can explain itself. |
| 13 | `setAiEnabled(repoId, enabled)` | `/api/repos/:id/settings/ai` | PUT `{enabled}` | `RepoSettings` | Writes `repos.ai_enabled` (AGENTS.md rule 7). |
| 14 | `disconnect(repoId)` | `/api/repos/:id/connection` | DELETE | `204` | Removes subscriptions; history is kept. |
| 15 | `startGitHub()` | `/api/auth/github/start` | GET | `{url}` | App install URL, else OAuth login, else 503 `github_not_configured`. |
| 16 | `chooseRepo(fullName)` | `/api/auth/github/repo` | POST `{fullName}` | `Me` | Persists the repo chosen in onboarding. |
| 17 | `ops()` | `/api/ops` | GET | `OpsPayload` | The operator ledger behind `/app`: repos, tasks, digests, alerts, chats, findings, deliveries and jobs in one read. Scoped to the session's repos when auth is enforced. |
| 17 | `startTelegramLink()` | `/api/link/telegram` | POST | `TelegramLink` | Returns `{code, deepLink, pollToken}`. |
| 18 | `pollTelegramLink(pollToken)` | `/api/link/telegram/:pollToken` | GET | `{linked, chatTitle?}` | Poll, not push. |
| 19 | `saveOnboardingMode(mode)` | `/api/onboarding/mode` | POST `{mode}` | `{saved, mode}` | Repo-scoped when a `repo` is passed. |
| 20 | `subscribe(repoId, …)` | `/api/repos/:id/events` | GET `?since=` (polled) | `ActivityEvent[]` | Polled every 30 s; see the note above on why there is no SSE. |

Path style is a proposal, not a requirement: nothing in the UI depends on it. What matters is that each
method maps to one request and returns the listed shape.

---

## 2. Model fields the backend must supply

The redesign added these fields to the model. They are the only changes to the data contract, and each
one exists because a screen cannot be correct without it.

| Field | Why the UI needs it |
|---|---|
| `Issue.closedAt` | When the task actually closed. The ledger sorts finished work by it and the Goal Track fills in that order; before the column existed every read borrowed `updatedAt`, which any edit moves. |
| `Issue.reopenedAt` | The Goal Track draws a reopened task as **open again**, which moves the filled line back. GitHub exposes a reopen only as an event, so the `issues` webhook and the API sync stamp it. `null` means the task has not been reopened since it closed. |
| `Chat.title` | The name Telegram gives the chat, captured from the update the bot already receives (or `getChat`). Without it every direct message reads "Direct message" in the ledger and in the digest history. |
| `Event.repoId` | Webhook health compared a cuid to `owner/name`, so every repository claimed it had never received a delivery. Ingest now writes the resolved repo id, and `prisma/migrations/7_backfill_event_repo_id` rebuilt the link for deliveries already stored. |
| `TodaySnapshot.focusIssues` | The tasks of the focus goal, in closing order — the Goal Track on the first screen. Returning them with `today` keeps first paint at **one** request. (Alternative rejected: a second call from Today to `goal()`.) |
| `DigestSettings.subscription: Subscription \| null` | A repository with no chat connected must return `null`, not a 404 or a zero-filled object, so the Digests screen can show its "no chat connected" invitation instead of an error. |
| `CommitItApi.linkCommit(...)` | Accepting a suggested task must be an explicit, single write. See §4. |

Already present in the model and simply reused by the redesign: `Milestone.weightedClosed` /
`weightedTotal` (server-authoritative — the client never recomputes progress from commits),
`TodaySnapshot.openPoints`, `Repo.webhook` (`ok`, `lastDeliveryAt`, `lastDeliveryStatus`,
`expectedUrl`), `Repo.unreadable`, `Alert.file` (a **path only**), `Commit.secretFlag`,
`Commit.suggestedIssueNumber`, `PersonSummary.weightedPointsClosed` / `mergedPRs`, and
`authorId` on every commit (AGENTS.md rule 12).

**Trimmed from the model.** `Build`, `Notification`/`NotificationKind`, `Freshness` and
`OnboardingState` were declared while exploring the domain and were never rendered by any screen:
build failures arrive as `Alert` rows, digest freshness arrives as the live channel's `status`, and the
onboarding step is derived from the URL. They were deleted along with their fixtures so the contract
describes only what the nine screens consume. If the backend already returns build runs or a
notification inbox, that is fine — the dashboard just does not ask for them.

---

## 3. Response and state contract

The screens implement the brief's state matrix (loading / empty / error / partial / stale / offline)
from exactly two signals: the promise outcome, and the shape of the payload. So:

| UI state | What the backend must do |
|---|---|
| loading | Nothing special — the client shows skeletons while the promise is pending. Keeping `today` to one request is what makes this fast. |
| empty | Return `200` with an empty collection (`[]`, `groups: []`, `focus: null`). **Never** 404 for "nothing in this window". The screen then shows its own invitation. |
| error | Any non-2xx → the client throws `Request failed (status)` (or the response body text, which is used as the message). The screen shows a banner with a retry. |
| partial | **Return `200` with the region that loaded and the region that did not left empty.** Today treats `goals.length > 0 && groups.length === 0 && alerts.length === 0` as "activity could not be loaded"; Goal treats `issues.length > 0 && commits.length === 0 && unlinked.length > 0` the same way. Failing the whole response for one broken sub-read would throw away good data. |
| stale | The `subscribe` `onStatus` callback reports `live` / `polling` / `stale` / `offline`. A failed poll → `offline` and the UI marks the last update as old; the next successful poll returns to `live`. |
| 3800-char limit | `DigestSettings.preview` and `charCount` are computed **on the server** from the same renderer the bot uses, so the preview can never disagree with the message that is sent. |

`DigestSettings.charLimit` is Telegram's 3800 (AGENTS.md rule 8); `charCount` is the length of
`preview`. The client renders `preview` with `white-space: pre-wrap` and never re-renders the digest
itself — one renderer, on the backend, is the point.

---

## 4. The one write: accepting a suggested link

`linkCommit` is the only mutation the dashboard performs. Its rules are promise-level, not
request-level, so no endpoint contract can enforce them and the backend must:

1. Store the accepted link as a **strong** link (AGENTS.md rule 11: strong > weak > PR inherit >
   heuristic). A suggestion must never be applied without this call.
2. Be idempotent: accepting the same `(sha, issueNumber)` twice is a no-op, not a duplicate row.
3. Refuse to link a commit to a closed issue or to an issue of another repository.
4. Never link a commit with `secretFlag` (the UI hides the Accept button for those, but the server
   must not rely on the UI for that).

Response `{ok, sha, issueNumber}` lets the row update in place without refetching the whole screen.

---

## 5. Auth, and what must never cross the wire

- Auth is a **session cookie**, same-origin (`credentials: "same-origin"` in the HTTP adapter). There
  is no token in the dashboard, nothing in `localStorage` except the theme name, and no user id in any
  payload.
- A leaked secret is represented by `Alert.file` (a path), `Alert.commitSha` and `Commit.secretFlag`.
  **The secret value must never appear in any response body**, because the UI would render what it is
  given — and so would the digest preview. AGENTS.md rule 6 already enforces this server-side; this is
  the client-side statement of the same rule.
- Webhook HMAC verification, delivery idempotency and the job queue stay entirely behind these
  endpoints and are unaffected by the redesign.

---

## 6. What the frontend deliberately does not need

- No pagination: `today` and `people` are windowed server-side (the digest window, the week).
- No client-side progress maths: the percentage is displayed, never derived, so no commit data is
  required to draw the Goal Track.
- No websocket: a 30 s poll of `/events?since=` is enough for "new since you last looked" and survives
  serverless.
- No separate "builds" or "notifications" endpoints (see §2).
