# CommitIt — design plan

Branch `front-end-redesign`. Written after checkpoint A (skills consulted, see
`docs/skills-applied.md` §5). Section numbers below refer to the brief.

---

## 1. Audit of the frontend that exists today

**What is there now:** `dashboard/` — a Vite + React 19 app, built into `public/` and deployed as the
site root (`vercel.json` `outputDirectory: "public"`), talking to the read-only BFF in
`src/dashboard.ts` and the Vercel functions in `api/data/*`.

| Area | Today | Verdict |
|---|---|---|
| Routing | **None.** One page, three tabs in local state (`dashboard` / `review` / `help`) inside `App.tsx:42`. The only URL state is `?repo=`. | Replace with real routes (skill rule 47: predictable back, deep links). |
| Screens | `App.tsx` renders everything: top bar, repo search form, Milestones, Activity (7d), "What each commit is about", Issues, Digests, Telegram, GitHub, Review, Help — in one 425-line component. | Replace with nine screens. |
| Components (`dashboard/src/components.tsx`, `components/ui/*`) | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Tabs`, `Button` (CVA), `Donut`, `OverallBand`, `AuthorBars`, `CommitList`, `DigestTimeline`, `IssuesTable`. Radix tabs + Tailwind + CVA + `clsx` + `tailwind-merge`. | Replace. Card-kit is on the anti-default list (§12: "content chopped into identical rounded cards"). |
| Progress visuals | `Donut` + `OverallBand` + `AuthorBars` (chart.js / react-chartjs-2). | Replace with the Goal Track. The donuts are fine data but they are the generic dashboard answer and they compete with the one memorable element. Percentage still comes from the API. |
| Theme | `theme.tsx` + `tokens.css`: dark default, `[data-theme]` override, persisted in localStorage. Blue accent `#1f6feb`, GitHub-ish palette. | Replace: tokens below, brand colours, `prefers-color-scheme` default with a manual override. |
| Type | System stack (`-apple-system, "Segoe UI"`). | Replace: Poppins / Public Sans / JetBrains Mono. |
| Data layer | `api.ts` fetches `/api/progress|activity|issues|digests` with `fetch`, hand-rolled `load()` + a 30 s `setInterval`. Types imported from the backend (`@src/dashboard.js`). | Replace with a typed `CommitItApi` interface + mock adapter, TanStack Query, and SSE-with-polling-fallback. |
| Other | `export.ts`, `report.ts` (weekly .doc), `Review.tsx`, `Welcome.tsx`, `Connect.tsx`, `NotifyPrefs.tsx`, `Auth.tsx`, `avatars.ts`, `brandIcons.tsx`, `ring.tsx`, `telegramHtml.ts`. | Replaced, except `brandIcons.tsx`'s idea (GitHub/Telegram marks) which is re-authored as part of the one icon family. |

**Also audited and kept (brand assets, section 3):** `assets/commitit-badge.svg`,
`public/favicon.svg`, and the master drawing, which exists as inline SVG in `dashboard/src/Logo.tsx`
(`viewBox="0 0 512 512"`, comment: "concept 2 chat mark (user-designed artwork, 2026-10-03)").

> **Brand file note.** The brief expects the master drawing at `brand/commitit-concept2-chat-avatar.svg`.
> That directory does not exist; a repo-wide search for `commitit-concept2-chat-avatar.svg` returns
> nothing. What does exist is the same artwork in three places: the inline master in `Logo.tsx`, its
> scaled copy `public/favicon.svg`, and `assets/commitit-badge.svg` (icon + wordmark). Rather than
> invent artwork, I create `brand/` and place the **existing, unmodified** geometry there, copied
> byte-for-byte from what is already in the repo. Nothing is redrawn, recoloured or re-proportioned.
> If you have the original file, dropping it at `brand/commitit-concept2-chat-avatar.svg` is a no-op
> for the app — the component reads the same geometry.

**What I replace, concretely:** all of `dashboard/src/**` except the Vite entry plumbing, plus
`index.html`'s meta. `dashboard/vite.config.ts` keeps its root/output/alias and loses Tailwind.
The backend, `public/`, `api/`, `prisma/`, `src/` are not touched.

---

## 2. The idea the whole design serves

> Progress is measured by finished tasks, never by commit counts.

So the design has exactly one hero and it is not a number in a card: it is **the Goal Track**, a line
of nodes where a solid node is a finished task and the sentence beside it says
"Auth is 62% done: 8 of 13 points, due in 6 days." The 62 % arrives from the API and is displayed, never
derived from commits. Commits sit underneath, grouped by author, as activity — quieter type, no
progress device anywhere near them.

**Direction: "one line through it."** A chat is a thread, a commit graph is a line of nodes, and the
logo is two nodes joined by a line with a teal dot on the bubble. That single line is the interface's
only motif, and it is used as structure: the rail's spine, the rule between regions, the separator
between author groups, and the Goal Track itself. Nothing else is ornamental. No second motif, no
pattern, no illustration, no gradient, no icon-on-a-coloured-circle.

Two consequences that decide most of the detail:

1. **Regression from the default dashboard.** No card grid. Regions are separated by a tonal step
   (`--ground` → `--surface`) plus one hairline. No shadows at all. This is the brief's §4 and also
   skill rule 21.
2. **One bold thing.** Type is large only for the progress sentence, and wide only for the track.
   Everywhere else type is 12–16 px, and the page is mostly empty space, because calm is the product.

---

## 3. Colour tokens

Three token layers (primitive → semantic → component), one file, no raw hex in any component
(skill rule 19). Themes: `<html data-theme="night|day">`; the default follows
`prefers-color-scheme`, and a manual toggle persists an override in localStorage.

| Token | Night | Day | Role |
|---|---|---|---|
| `--ground` | `#151D2E` | `#E2E8F0` | page background |
| `--surface` | `#1E293B` | `#EDF1F6` | panels and regions |
| `--raised` | `#28364D` | `#F8FAFC` | menus, popovers, the digest bubble |
| `--ink` | `#E2E8F0` | `#1E293B` | main text, **filled (finished) nodes** |
| `--muted` | `#94A3B8` | `#475569` | secondary text |
| `--hairline` | `#33415A` | `#CBD5E1` | the one rule weight |
| `--signal` | `#14B8A6` | `#0E6F68` | **only** "new since you last looked" |
| `--warn` | `#F59E0B` | `#B45309` | stale, at risk |
| `--danger` | `#FB7185` | `#BE123C` | failed build, leaked secret, force-push |
| `--focus` | `#7DD3FC` | `#0F5C8C` | focus ring (≥3:1 on every surface) |

**Day-theme `--signal`.** `#14B8A6` on Slate Mist is 1.9:1 and fails. Starting from the brief's
`#0E6F68` and measuring: it lands at **4.80:1** against `--ground`, 4.86:1 against `--surface`,
5.02:1 against `--raised` — so it passes 4.5:1 and needs no further darkening. Measured, not assumed,
and locked by a unit test (`dashboard/src/lib/contrast.test.ts`) that walks the whole token table.

**Signal has one job.** It is never a CTA colour, never a heading accent, never decoration. It appears
as (a) the "new" dot on a Goal Track node, (b) the "New" chip beside digest lines that arrived since
the last digest, and (c) the logo's notification dot. The primary button uses `--ink` on `--ground`
with an inversion — quiet and unmistakably not-teal. (Conflict C2.)

**Tonal ramp, no shadows.** `--ground` → `--surface` → `--raised` are the only separations; the
`--hairline` is one weight (1 px / `1.5px` on retina via `border-width: 1px` and no double borders).

---

## 4. Type

FIXED by §3: Poppins 700 wordmark. Extended per §4: Poppins 600/700 display, Public Sans 400/500/600
body and UI, JetBrains Mono for code. Self-hosted via `@fontsource` (woff2, `font-display: swap`,
only the four weights actually used) so there is no third-party request and no layout shift from a
late webfont. (Conflict C1 logged.)

| Token | Size / line-height | Face | Use |
|---|---|---|---|
| `--type-display` | 44 / 1.12 | Poppins 600 | the progress sentence on Today (one per screen) |
| `--type-title` | 32 / 1.2 | Poppins 600 | screen titles, landing headline |
| `--type-heading` | 24 / 1.3 | Poppins 600 | goal titles, onboarding step titles |
| `--type-subhead` | 20 / 1.35 | Public Sans 600 | author names, card-less group heads |
| `--type-body` | 16 / 1.6 | Public Sans 400 | everything by default; the mobile baseline |
| `--type-small` | 14 / 1.5 | Public Sans 500 | labels, secondary lines, buttons |
| `--type-micro` | 12 / 1.45 | Public Sans 600 | the only small-label size; sentence case |
| `--type-code` | 13 / 1.4 | JetBrains Mono 500 | SHAs, branch names, paths — and nothing else |

Rules: sentence case everywhere; no all-caps labels, no letter-spacing on labels (kills the tracked
eyebrow tell); left-aligned at every width; measure capped at 68 ch; `font-variant-numeric: tabular-nums`
on every number; figures/percentages set in Public Sans tabular, not mono (mono is for code only,
skill rule 19/C1).

---

## 5. Layout concept

**Alignment:** hard left, one column. Nothing centred except the landing hero's demonstration block and
the onboarding step column.

**Desktop:** a 240 px left rail (the spine: a 1 px `--hairline` on its right edge that reads as the
continuation of the same line that runs through the track) + a main column capped at 960 px. Rail
carries brand, repo switcher, primary nav, and the theme toggle at the bottom. No top bar on desktop.

**Mobile (primary, 360 px first):** no rail. A 56 px top strip with the brand mark, the repo switcher and
the digest-status dot; content; a 4-item bottom tab bar (Today, Goals, People, Digests) with 44 px targets
and a safe-area inset. `min-h-dvh`, `overscroll-behavior: none`, no horizontal scroll.

**The spine, made literal:** on desktop the rail's hairline continues into the content area as the top
rule of each region, so the eye follows one unbroken line from the logo down through the Goal Track and
into the commit list. Where a line meets a node, the node is placed *on* the line. This is the only
"signature" the layout has.

**Spacing:** 4/8 rhythm. Section gap 32/48; group gap 16; row gap 8; inline gap 8.

### 5.1 Today — desktop (1280)

```
│                                                  ┌──────────────────────────────────────────────┐
│  ◗ CommitIt                                      │ SynCura ▾                      Digest  ●  ⟳  │
│                                                  ├──────────────────────────────────────────────┤
│  ▎Today                                          │                                              │
│   Goals                                          │  Auth is 62% done: 8 of 13 points,           │
│   People                                         │  due in 6 days.                              │
│   Digests                                        │                                              │
│   ——————                                         │  ○───●───●───────●───●───────◉──────○────○    │
│   Alerts   ⚠ 1                                   │   ▲ hoverable / focusable nodes              │
│   Repos                                          │                                              │
│                                                  │  ──────────────────────────────────────────  │
│  ●●●●●●●●                                        │  Since your last digest · 9:00               │
│  Fizan ▾                                         │                                              │
│                                                  │  Fizan                                    3  │
│  ☾ / ☀                                           │    ▸ feat   Login form          a3f9c1  #12  │
│                                                  │    ▸ fix    Token expiry        7bd021  #12  │
│                                                  │    ▸ test   Auth middleware     c41e88  #14  │
│                                                  │  ──────────────────────────────────────────  │
│                                                  │  Ahad                                     2  │
│                                                  │    ▸ feat   JWT middleware      91aa30  #14  │
│                                                  │    ▸ chore  Update              e2f6d4  Unlinked│
│                                                  │       Suggested: #16 Health route  [Accept]  │
│                                                  │  ──────────────────────────────────────────  │
│                                                  │  Needs attention                             │
│                                                  │    ⚠ Branch feat/profile: no activity 6 days │
└──────────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

### 5.2 Today — mobile (360)

```
┌────────────────────────────┐
│ ◗ CommitIt      SynCura ▾ ●│  ← 56px strip, 44px targets
├────────────────────────────┤
│ Auth is 62% done:          │  ← display 32/44, wraps
│ 8 of 13 points,            │
│ due in 6 days.             │
│                            │
│ ● Auth                     │  ← vertical Goal Track
│ │  Task 11  Login route  M │     (git-log-graph rail)
│ ├─◉ Task 12  Token exp.  M │
│ ├─● Task 14  Middleware  S │
│ │  Task 16  Health      —  │  ← dashed = unestimated, counts as 1
│ ○ Task 17  Settings      L │
│                            │
│ ────────────────────────── │
│ Since your last digest 9:00│
│                            │
│ Fizan                    3 │
│  feat  Login form  a3f9c1  │  ← row wraps, SHA stays mono
│        Task 12             │
│  fix   Token exp.  7bd021  │
│        Task 12             │
│ ────────────────────────── │
│ ⚠ Branch feat/profile:     │
│   no activity for 6 days   │
├────────────────────────────┤
│ Today  Goals  People  Digest│  ← 4 tabs, icons + labels, 44px
└────────────────────────────┘
```

### 5.3 Digests — settings with the live preview

```
┌─────────────────────────────────────────┬──────────────────────────────────────────────┐
│ Delivery                                │  The next message                            │
│                                         │                                              │
│  How often                              │  ╭─────────────────────────────────────────╮ │
│  ( ) Instant   (•) Hourly               │  │ SynCura · hourly digest · 9:00          │ │
│  ( ) Daily     ( ) Weekly               │  │                                         │ │
│                                         │  │ Auth is 62% done: 8 of 13 points.       │ │
│  Quiet hours                            │  │ ○──●──●────●──●────◉────○───○           │ │
│  From [22:00 ▾]  To [07:00 ▾]  ☑ mute   │  │                                         │ │
│                                         │  │ Fizan                                   │ │
│  Filters                                │  │  feat  Login form        a3f9c1  #12    │ │
│  Branches [main ×] [+ add]              │  │  fix   Token expiry      7bd021  #12    │ │
│  Authors  [all ▾]                       │  │ Ahad                                    │ │
│  Events   ☑ commits ☑ PRs ☑ issues      │  │  feat  JWT middleware    91aa30  #14    │ │
│                                         │  │                                         │ │
│  [ Save settings ]                      │  │ +2 more · compare link                  │ │
│  Saved.                                 │  ╰───────────────────────────────────────╯  │
│                                         │   1 842 / 3 800 characters                  │
│  [ Send test digest ]                   │   ↑ the bubble outline is the logo's         │
│  Sent to SynCura · delivered 9:00       │     bubble shape, drawn at message scale     │
└─────────────────────────────────────────┴──────────────────────────────────────────────┘
```

### 5.4 Landing — the hero is the interaction

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◗ CommitIt                                          [ Connect a repo ]    │
│                                                                          │
│  A day of commits, as one message.                                       │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Instant      │  Hourly  │  Daily         ← one control, 3 states  │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ (a3f9c1) feat Login form        ─┐                                 │  │
│  │ (7bd021) fix  Token expiry       │  14 separate notifications       │  │
│  │ (c41e88) test Auth middleware    │  collapse into ↓                 │  │
│  │ … 14 rows, 1 per commit          │                                 │  │
│  │                                  │                                 │  │
│  │        ╭─────────────────────── ╯──────────────────────────╮      │  │
│  │        │ SynCura · daily digest · 9:00                     │      │  │
│  │        │ Auth is 62% done: 8 of 13 points.                 │      │  │
│  │        │ ○──●──●────●──●────◉────○───○                      │      │  │
│  │        │ Fizan  feat Login form  a3f9c1  #12                │      │  │
│  │        ╰───────────────────────────────────────────────────╯      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ──────────────────────────────────────────────────────────────────────  │
│  How it connects        What it never does                               │
│  GitHub webhook → one   It reads metadata and short summaries. Secrets   │
│  line of setup.         are scanned before any AI call, and secret       │
│  Telegram bot → one     values never leave GitHub.                       │
│  tap to link.                                                            │
│                                                                          │
│  [ Connect a repo ]                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

No testimonials, no logos, no statistics (C3). The demo is real DOM driven by the same fixtures as
the app, not a screenshot.

---

## 6. UX plan

### 6.1 Information architecture and navigation

| Route | Screen | Job |
|---|---|---|
| `/` | Landing (public) | Show the value in one interaction, get a repo connected |
| `/connect/:step` | Onboarding | GitHub → repo → Telegram → digest mode → test digest |
| `/today` | Today | Are we on track, and what moved since the last digest |
| `/goals` | Goals | All goals with their progress sentence |
| `/goals/:id` | Goal | One goal: tasks, owners, linked and unlinked work |
| `/people` | People | Per-author activity and finished tasks, week view |
| `/digests` | Digests | Delivery settings with a live preview |
| `/alerts` | Alerts | Secret, build, force-push, stale, inactivity |
| `/repos` | Repo settings | Webhook health, AI summaries, connected chat, disconnect |

Rail = Today · Goals · People · Digests · Alerts · Repos (secondary nav lives in the rail, rule 48).
Bottom bar on mobile = Today · Goals · People · Digests (4 ≤ 5, icon **and** label, rule 46). Alerts
and Repos are reached from the mobile strip and from Today's "Needs attention" — they are destinations,
not primary tabs. Repo switcher sits at the top of the rail (desktop) and in the strip (mobile), and
writes `?repo=` so every screen is deep-linkable and shareable (rule 47).

### 6.2 State matrix (every screen)

| Screen | Loading | Empty | Error | Partial | Stale / offline |
|---|---|---|---|---|---|
| Landing | skeleton of the demo block | n/a | inline banner if the demo fixtures fail to load | not applicable | static content stays; no live claim made |
| Onboarding | per-step skeleton on the button + step body | "No repos found on this account" + Resend GitHub access | step-scoped error with the fix and a retry | later steps disabled with a reason | link step shows "waiting for Telegram" after 60 s with the paste-code fallback |
| Today | track skeleton (same node count), row skeletons | "No goals yet. Create a milestone on GitHub and it will appear here." | banner + retry; last good data kept | track renders, commits region says "activity unavailable" | "Updated just now" → "Last updated 4 min ago, reconnecting" bar, `status` role |
| Goals | 3 goal skeletons | the empty-goals invitation | banner + retry | goal without a due date renders without the date clause | same live bar; percentages marked as of last sync |
| Goal | track + list skeletons | empty goal: "This goal has no tasks yet. Add issues to the milestone on GitHub." | banner + retry | unlinked commits listed, links section hidden | same live bar |
| People | member row skeletons | "No activity this week." | banner + retry | author with no finished tasks shows "no tasks closed yet" rather than 0 % | same live bar |
| Digests | preview skeleton in the bubble | "No repo connected yet" → onboarding link | save/send errors inline with cause + fix | preview shows partial settings note | unsent state visible: "Test digest not sent — Telegram unreachable" |
| Alerts | 2 alert skeletons | "Nothing needs attention." + what is watched | banner + retry | alert missing a run link omits the link rather than showing a dead one | same live bar |
| Repo settings | skeleton | "No chat connected" + link action | webhook health in `--danger` with the exact fix | AI toggle disabled with reason if no provider | same live bar |

Plus, on **every** screen: `prefers-reduced-motion` replaces the one animation with its end state, and
the 100-commit-burst fixture proves the formatter never truncates mid-token.

### 6.3 Accessibility approach (skill rules 1–13, 39–45, 49)

- Semantic landmarks: `header` (strip), `nav` (rail / tab bar), `main` (`#main`, skip-link target),
  `footer` on Landing. One `h1` per screen.
- The Goal Track is a `role="list"` of nodes; each node is a button (link to the task) whose accessible
  name is "Task 14, login route, size M, closed" / "…, size unknown, counts as 1 point, open" /
  ", newly closed". The track as a whole carries a text alternative: the progress sentence.
- Focus: 2 px `--focus` ring, 2 px offset, never removed, never clipped by the sticky strip or tab bar
  (`scroll-padding-top: var(--strip-h)`, bottom inset).
- Forms (onboarding, Digests, Repo settings): visible labels, blur validation, inline `aria-describedby`
  errors, focusable error summary on multi-error submit, `role="status"` for saves, `role="alert"` only
  for the leaked-secret banner and hard failures.
- Colour never carries state alone: category = glyph + word; "new" = dot + the word "New"; alert
  severity = icon + word + colour.
- 44 px touch targets, 8 px gaps, `touch-action: manipulation`.
- `prefers-color-scheme` default, manual override persisted; contrast enforced by unit test per theme.
- No `localStorage` other than the theme name; no token, no user id (rule 10, brief §10 security).

### 6.4 Voice

Goal, Task, Commit, Digest, Unlinked work — one word each, everywhere. Buttons name their action and
the confirmation repeats it. Errors state cause + fix. Empty states invite. No apologising. No
all-caps, no "WORD — fragment", no middle-dot meta strings, no trailing arrows.

### 6.5 Motion

One orchestrated moment: on the first Today render of a session, the track fills left-to-right (top-to-
bottom on mobile) to its current state, once, ~700 ms, `prefers-reduced-motion` → instant. Everything
else motion only answers an action: a node filling when a live event arrives, the digest bubble
expanding from its compact state, a toggle confirming. No entrance animation on sections, no hover
animation on rows.

---

## 7. Review of this plan against the brief — what read as generic, and what I changed

Worked through as the skill's second pass, comparing this plan against "what I would produce for any
similar dashboard".

| # | Generic default I had reached for | Changed to | Why |
|---|---|---|---|
| R1 | Region = rounded card with a 1 px border on `--surface` (i.e. the existing app's `Card`). | **Tonal step + one full-bleed hairline that starts at the node column.** No radius on regions at all (radius is reserved for the digest bubble, which is literally a bubble). | The card kit is a named tell (§12) and it made every region weigh the same, which fights the single-hero rule. The hairline also *is* the motif, so it earns its place. |
| R2 | Progress as a big number with a label and a small ring — the "big stat hero" tell. | The display line is a **sentence**, and the number is one clause inside it: "Auth is 62% done: 8 of 13 points, due in 6 days." | §12 forbids "a big number with a small label"; more importantly a sentence cannot be read as commit-count progress. |
| R3 | Commit rows as a table with a category chip in the brand colour. | A **glyph + word** category mark (never colour-only), author name as a group head with a right-aligned count, hairline between groups. | Rule 4 / §7.1, and it removes the chip kit. |
| R4 | A tracked-out ALL-CAPS eyebrow on each region ("SINCE YOUR LAST DIGEST"). | Sentence-case group heads at 14 px/600 with the count beside them; the digest window is stated as a normal clause ("Since your last digest · 9:00" → rewritten as "Since your last digest, 9:00"). | Named tell in both skills. |
| R5 | Middle-dot meta strings ("12 · 3 points · 6 days"). | Each clause is a sentence in the display line; metadata rows use real punctuation and spacing, not `·` separators. | Named tell. Also recorded in §4 of the brief. |
| R6 | A "→" on "View goal →" and on the landing CTA. | Plain labels: "Open goal", "Connect a repo". Chevron only inside the node's own affordance where it means "expands". | Named tell. |
| R7 | Monospace for every small label because the rest of the repo is code-shaped. | JetBrains Mono is used **only** for SHAs, branch names and file paths. | Rule 19 / C1 and §12 ("monospace for every small label"). |
| R8 | A gradient wash behind the landing hero, and a dark→light diagonal. | Flat `--ground`. The hero's interest comes from the collapse interaction. | §12, and §4 says "no gradient washes". |
| R9 | Animating the track by animating `stroke-dashoffset` on a long path *and* re-running on every mount. | One `transform: scaleX`/`scaleY` sweep on a wrapper, once per session (sessionStorage flag), final state in the DOM for reduced motion. | Rule 17 (transform/opacity only) and rule 35 (one moment, not per navigation). |
| R10 | Reusing the donut/ring chart the old app had, but in brand colours. | Deleted. The Goal Track is the only data visual. | The donut *is* the generic dashboard answer, and it would compete with the memorable element. |
| R11 | Sticky top bar on desktop, which would obscure focus. | No top bar on desktop at all (the rail is the header); on mobile the strip is 56 px and `scroll-padding` compensates. | Rule 3, rule 48. |
| R12 | Numbered markers on the Goals list and on the rail. | Numbers **only** on the onboarding steps. Goals and nav have none. | §12 and frontend-design rule 5. |

Kept deliberately after review, with the reason recorded: the hairline-with-no-radius system (C5), the
left rail (rule 48), and the large display sentence (R2) — these three are choices made for *this*
brief, not defaults, and they are the ones I would defend.

---

## 8. Build order (section 11 step 4)

1. Tokens, themes, fonts, base components (button, input, toggle, tabs, banner, node, avatar).
2. API types, `CommitItApi` interface, mock adapter, fixtures (all the hard cases from §10).
3. Goal Track, tested against every fixture edge case.
4. Today, Goals + Goal, People.
5. Digests with the live preview.
6. Alerts, Repo settings.
7. Onboarding.
8. Landing + hero interaction.
9. Accessibility, responsive and performance pass.

Commits are small and Conventional (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), all on
`front-end-redesign`.
