# CommitIt — what the frontend needs from the API

Branch `front-end-redesign`. **No backend file was changed on this branch.** This document is the
contract the redesign was built against, so the backend work can be planned from it.

Every screen talks to exactly one interface — `CommitItApi` in `dashboard/src/api/client.ts` — and
never to `fetch` directly. `dashboard/src/api/http.ts` already encodes the HTTP call for each method.
The mock adapter (`dashboard/src/api/mock.ts`) satisfies the same interface, so switching to a live
backend is one line:

```ts
// dashboard/src/api/index.ts
const USE_REAL_API = false;   // → true
```

Because the mock and the HTTP adapter implement the same interface, **every endpoint below has been
exercised by the UI in the mock**: the shapes are known-good, not sketched.

---

## 1. Endpoint map

`repoId` is CommitIt's own repository id (not `owner/name`); `:id` in a path is that id, URL-encoded.

| # | `CommitItApi` method | Endpoint | Verb | Returns | Backend today |
|---|---|---|---|---|---|
| 1 | `me()` | `/api/me` | GET | `Me` | Exists. Must gain `repos[]` and `telegramLinked`. |
| 2 | `repos()` | `/api/repos` | GET | `Repo[]` | New. Today only `GET /api/repo?repo=owner/name` for one repo. |
| 3 | `today(repoId)` | `/api/repos/:id/today` | GET | `TodaySnapshot` | New. Folds `/api/progress` + `/api/activity` + `/api/issues` into one first-paint request. |
| 4 | `goals(repoId)` | `/api/repos/:id/goals` | GET | `Milestone[]` | New; `/api/progress` already computes the weights. |
| 5 | `goal(repoId, goalId)` | `/api/repos/:id/goals/:goalId` | GET | `GoalDetail` | New. |
| 6 | `people(repoId)` | `/api/repos/:id/people` | GET | `PersonSummary[]` | New. `/api/activity` has per-author commits; add `closedTasks` + `weightedPointsClosed`. |
| 7 | `alerts(repoId)` | `/api/repos/:id/alerts` | GET | `Alert[]` | New. |
| 8 | `linkCommit(repoId, sha, issueNumber)` | `/api/repos/:id/commits/:sha/link` | POST `{issueNumber}` | `{ok, sha, issueNumber}` | **New. The only write the dashboard performs.** |
| 9 | `digests(repoId, mode?)` | `/api/repos/:id/digest?mode=` | GET | `DigestSettings` | New shape over the existing `/api/digests`. |
| 10 | `saveDigest(repoId, patch)` | `/api/repos/:id/digest` | PUT | `DigestSettings` | New. |
| 11 | `sendTestDigest(repoId)` | `/api/repos/:id/digest/test` | POST | `TestDigestResult` | New (uses the existing Telegram sender). |
| 12 | `settings(repoId)` | `/api/repos/:id/settings` | GET | `RepoSettings` | New. |
| 13 | `setAiEnabled(repoId, enabled)` | `/api/repos/:id/settings/ai` | PUT `{enabled}` | `RepoSettings` | New. Writes `repos.ai_enabled` (AGENTS.md rule 7). |
| 14 | `disconnect(repoId)` | `/api/repos/:id/connection` | DELETE | `204` | New. Deleting the connection must not delete history. |
| 15 | `startGitHub()` | `/api/auth/github/start` | GET | `{url}` | Exists as `/api/auth/login` (GitHub App install). |
| 16 | `chooseRepo(fullName)` | `/api/auth/github/repo` | POST `{fullName}` | `Me` | New; persists the repo chosen in onboarding. |
| 17 | `startTelegramLink()` | `/api/link/telegram` | POST | `TelegramLink` | Exists as `POST /api/link?op=issue`. Needs to return `{code, deepLink, pollToken}`. |
| 18 | `pollTelegramLink(pollToken)` | `/api/link/telegram/:pollToken` | GET | `{linked, chatTitle?}` | Exists as `GET /api/link?op=poll&code=`. |
| 19 | `saveOnboardingMode(mode)` | `/api/onboarding/mode` | POST `{mode}` | `{saved, mode}` | Exists as `POST /api/link?op=set-digest`. |
| 20 | `subscribe(repoId, …)` | `/api/repos/:id/events` | SSE (GET) | `ActivityEvent` frames | New. Fallback `GET /api/repos/:id/events?since=last` (JSON array), polled every 30 s. |

Path style is a proposal, not a requirement: nothing in the UI depends on it. What matters is that each
method maps to one request and returns the listed shape.

---

## 2. Model fields the backend must supply

The redesign added four fields to the model in `dashboard/src/api/types.ts`. They are the only changes
to the data contract, and each one exists because a screen cannot be correct without it.

| Field | Why the UI needs it |
|---|---|
| `Issue.reopenedAt` | The Goal Track draws a reopened task as **open again**, which moves the filled line back. Without it a reopened task still looks finished, and the track lies about progress. |
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
| stale | The `subscribe` `onStatus` callback reports `live` / `polling` / `stale` / `offline`. SSE `onerror` → `stale`, then the client falls back to 30 s polling itself. |
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
- No websocket: SSE with a polling fallback is enough for "new since you last looked".
- No separate "builds" or "notifications" endpoints (see §2).
