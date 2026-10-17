# Design notes — what was built, and an honest look at it

Branch `front-end-redesign`. Written after the build, from the 26 screenshots in
`docs/screenshots/` and from the measurements in `docs/lighthouse.md`. The design plan and its
revisions are in `docs/design-plan.md`; the skills log, conflicts and checkpoints are in
`docs/skills-applied.md`; the API contract is in `docs/api-needs.md`.

---

## 0. Second pass — structure and identity

The first pass was correct and too timid. This pass keeps its one idea and rebuilds everything
around it.

**A real bug found on the way in:** `--font-display: "Poppins"` and `--font-ui: "Public Sans"`
were declared in `tokens.css` but never loaded — there was no `<link>` in `index.html` and no
`@import` anywhere. The whole product had been rendering in the system UI face since the branch
started. The new faces are loaded explicitly and `preconnect`ed.

**Typography.** Bricolage Grotesque for the progress sentence, IBM Plex Sans for the interface,
IBM Plex Mono for data. Bricolage is a variable face, so headings pull its width axis down and
tighten as they grow (`wdth` 92 → 84 on `h1`): the sentence reads as a compressed instrument
label and relaxes further down the page.

**Colour.** The teal signal is gone from the interface and survives only on the brand mark, which
the artwork fixes. In its place is one ramp that carries data, and two hues that carry alarms:

| Token | Night | Means |
|---|---|---|
| `--weight-s / -m / -l` | `#6a94bb` `#8fb8dc` `#cbe4f8` | a 1 / 3 / 5-point task |
| `--attention` | `#f0a02e` | needs you |
| `--danger` | `#fb7185` | it failed |

Day inverts the ramp — on a light ground a heavy task must be the darkest or it vanishes. Every
step is contrast-tested in both themes, and a new test asserts the three steps stay far enough
apart to be told apart. That test caught `--n-weight-s: #5c86ad` at 4.39:1 on its first run; it
is now `#6a94bb` at 4.63:1. The old teal's job — "new since you last looked" — is now carried by
the word *New* and a neutral mark, because "new" is not an alarm.

**Structure: six destinations became three.** People was Today with a second copy of the same
numbers (see §4.2 item 7), and Digests, Alerts and Repos are all configuration rather than places
a lead browses. The rail is now **Today · Goals · Settings**, with Delivery, Alerts, People and
Repositories as sections of Settings. The four deep links still resolve, so an old bookmark or a
Telegram link keeps working.

**The track stopped being timid.** Node diameter is now proportional to √weight, so a node's
*area* is the number of points it carries — a 5-point task really does put five times the ink on
the screen. Sizes went from 10/16/24px to 16/28/38px, the hit area from 44px to 52px, and the nodes
are spread across the full measure instead of trailing off the left edge with 400px of empty line
beside them. The rail is inset by half a hit area so it begins and ends on a task. A closed task
fills in its own weight hue, so magnitude is legible twice — by size and by tone — while an open
task stays a hollow ring in ink.

**Commit rows are one line.** A twenty-commit list was sixty lines tall: AI summary, two thumbs,
and `Original: feat: login form with inline validation` on every row, with "Suggestions are never
applied on their own." printed once per row. All of that is now behind a **Details** toggle. The
sentence that matters moved to the list header, once.

**Atmosphere.** The ground is no longer flat: large concentric rings — the product's own motif, a
circle whose area is a weight — and a fine grid to sit them on, with one soft glow behind the
track. Every wash is an alpha at or under 7%, so none of it can move a measured contrast ratio.

**One regression, caught by the existing guard.** `text-overflow: ellipsis` on the one-line subject
tripped the "no text wider than its own box" spec, which cannot tell deliberate truncation from an
accidental overflow. Rather than weaken the check, elements that clamp themselves now say so in
the markup (`data-truncate`), and the spec exempts that marker — auditable, not a hidden exception
inside the stylesheet.

---

## 1. What was built

Thirty commits on the branch, one decision each, all Conventional (the branch also carries one unrelated
`feat(bot):` commit that was already here before this pass):

| Commit | What it is |
|---|---|
| `88dfa44` | `chore: add brand artwork to brand/` — the existing geometry, byte-copied, never redrawn |
| `1b83454` | `docs: add design plan` |
| `4319c47` | `refactor(dashboard): remove the previous card-kit frontend` |
| `746cc49` | `chore: drop the dashboard dependencies the redesign replaces` |
| `e500e5e` | `feat(dashboard): add the brand tokens, themes and type scale` |
| `a99b068` | `feat(dashboard): add the base components and screen layout styles` |
| `46df330` | `feat(dashboard): add the typed API client with a mock adapter` |
| `5ae4ac0` | `feat(dashboard): add the pure helpers for weights, formatting and digests` |
| `fdbf7fd` | `feat(dashboard): add the Goal Track and the shared components` |
| `34b2ad6` … `7e95e83` | The nine screens: Today, Goals + Goal, People, Digests, Alerts, Repo settings, Onboarding, Landing |
| `538976e` | `feat(dashboard): mount the app frame and the routes` |
| `33f7711` | `test(dashboard): cover weights, formatting, digests and colour contrast` |
| `f545402` | `test(dashboard): smoke every screen on mobile and desktop in both themes` |
| `28ecbfe` | `test(dashboard): guard narrow layouts and capture the state matrix` |
| `3f0d042` … `cb8df1d` | The critique pass: the digest separator, the owner avatar, the goals redundancy, the secret alert's copy, the unrendered model shapes |
| `95f30a6` | `refactor(dashboard): fix the 360px layouts and drop inline styles` |
| `d32d136`, `25f103d` | The docs: design notes, api needs, Lighthouse, this checklist |

Then the critique pass (§4 below) and the state-matrix captures. Files:

```
dashboard/src/api/       client.ts (the interface)  http.ts  mock.ts  fixtures.ts  types.ts  index.ts (the switch)
dashboard/src/brain-free lib/  weight.ts  digest.ts  format.ts  contrast/tokens tests
dashboard/src/components GoalTrack.tsx  surfaces.tsx  controls.tsx  CommitRow.tsx  CommitGroup.tsx  AppShell.tsx  brand.tsx  glyphs.tsx
dashboard/src/screens/   Landing  Onboarding  Today  Goals  Goal  People  Digests  Alerts  RepoSettings
dashboard/src/styles/    tokens.css  components.css  layout.css  screens.css
e2e/                     smoke.spec.ts  responsive.spec.ts  capture.spec.ts (SHOTS=1 only)
```

## 2. The screenshots

`docs/screenshots/`, 26 captures, all regenerable with
`$env:SHOTS=1; npx playwright test e2e/capture.spec.ts --project=desktop-1280`.

| Screens | Files |
|---|---|
| Today (both themes, both widths) | `today-desktop-night`, `today-desktop-day`, `today-mobile-night`, `today-mobile-day` |
| Goal Track on its own screen, both orientations | `goal-desktop-night`, `goal-mobile-night` |
| Goals, People, Digests, Alerts, Repos, Onboarding, Landing | `<screen>-desktop-night`, `<screen>-mobile-night` |
| The state matrix | `state-empty-mobile-night`, `state-error-mobile-night`, `state-slow-desktop-night`, `state-partial-desktop-night`, `state-stale-desktop-night`, `state-burst-desktop-night` |

The capture spec sets its own viewport per shot (a first version did not, and produced 1280 px "mobile"
shots), pins fixed chrome to static so it cannot overlay content, and reaches the states through
`?state=…`, which is a review-only switch that announces itself on screen when it is on.

---

## 3. What holds up

**The one idea survives contact with every screen.** Progress is finished tasks, weighted, and no
screen anywhere shows a percentage or a bar derived from commit counts. The Today heading is a sentence
("Auth is 62% done: 8 of 13 points, due in 6 days."), commits sit below it as activity with a glyph and
a word for their category, and the words "activity, not progress" are on the activity list itself.

**The Goal Track is genuinely readable, and it is the only bold thing.** In the mobile shot the three
node sizes are visibly different (10 / 16 / 24 px, a 2.4× ratio) and the dashed unestimated ring and the
single teal dot read at a glance. The reopened task (#16/#11 in the fixtures) draws open again and the
filled line stops before it, which is the honest behaviour and the reason the element exists. The
Playwright suite asserts the three sizes are distinct, that the line moves back for a reopened task,
that a leaked-secret alert names the file and nothing else, and that the progress sentence contains
"points" and never the word "commits".

**Accessibility is measured, not asserted.** Lighthouse: **100 on `/`, `/today` and `/digests`** (target
95). Contrast is enforced by a unit test that walks the whole token table in both themes, which is how
the day-theme `--warn` was caught at 4.07:1 and moved to `#A34A08` (4.81:1). Focus rings are 2 px with
offset, the skip link works, the theme switch is keyboard-operable, and the narrow-layout overflow
guards (`e2e/responsive.spec.ts`) are the tests that found three real 360 px bugs — a squeezed Goal
Track label, a 0 px-wide task title, and a wordmark overlapping the repo switcher.

**The states are real states, not mock-ups of states.** Six of the 26 screenshots are the matrix, and
each one is a route you can visit: `?state=empty|error|slow|partial|stale|offline|burst`. Partial is the
interesting one — on Today the track and the sentence stay, and only the activity region says it could
not be loaded, because the API contract (§3 of `api-needs.md`) says a broken sub-read must not fail the
whole response.

**Restraint held.** One icon family (Lucide) at one stroke weight, no shadows anywhere, no second
motif, no gradient, no testimonial, no invented statistic, no commit-count bar. Numbers only on the
onboarding steps, which really are a sequence.

---

## 4. What is weaker — and what I did about it

Ordered by how much a reader would notice. "Fixed" means the fix is on this branch and covered by a
test; "recorded" means it is a decision, with the reason, not an oversight.

### 4.1 Fixed during the critique

1. **The digest message ran words together.** `commitLine()` padded the category to five characters and
   used the padding *as* the separator, so any category at least five characters wide glued itself to
   the subject. The message people would actually receive in Telegram read
   `choreupdate e2f6d4f`, `refactorrefactor: split the auth middleware…`, `otherMerge pull request #42`.
   Every unit test had used `feat` and `fix`, which are short enough to hide it. Fixed (the separator is
   now always its own space) and covered by a regression test that walks all seven categories. This is
   the most valuable thing the critique pass found: the digest *is* the product.
2. **An "UN" avatar chip on unassigned tasks.** The People/Goal task rows drew an initial-letter avatar
   even when the owner was the word "unassigned", so the row read `M, 3 points  UN  unassigned`. The
   avatar is decorative, so it now only renders when the assignee is a person the screen actually knows.
3. **The secret alert stuttered.** The "possible key was pushed" alert said the file was skipped in every
   AI call, and then the screen appended that it was skipped before any AI call. Three sentences saying
   one thing. The fixture now supplies the specific fact ("Commit 4b7a22e touched one file.") and the
   screen supplies the one explanation, so the two can no longer echo each other.
4. **The Goals list said everything twice.** Each row printed "due in 6 days" beside the title *and*
   inside the sentence, and "62% done: 8 of 13 points" *and* inside the sentence. The row now prints the
   sentence once and adds only what the sentence does not carry (`4 of 7 tasks finished`). The overdue
   warning stays in the head, because a red word is the one scannable urgency cue.
5. **Dead weight in the model.** `Build`, `Notification`/`NotificationKind`, `Freshness` and
   `OnboardingState`, plus the `builds` and `notifications` fixture collections, were declared while
   exploring the domain and rendered by nothing — build failures arrive as `Alert` rows, freshness
   arrives as the live channel's status, and the onboarding step is in the URL. Removed, so the contract
   describes only what the nine screens consume.
6. **Three 360 px layout bugs**, found by the new overflow specs rather than by eye: the vertical Goal
   Track label collapsed to 0 px, `.task__title` collapsed to 0 px because the meta column won the
   width, and the wordmark overlapped the repo switcher (`scrollWidth` 109 > `clientWidth` 96).

### 4.2 Recorded, not fixed

7. **People repeats itself.** The sentence "fizan finished 2 tasks, worth 6 points, and committed 3
   commits." is followed by a three-up row of "Tasks finished 2 / Points closed 6 / Pull requests merged
   0". Two of the three numbers are stated twice. It is *not* the "big number with a small label" tell —
   the values are body size, not oversized — and the row carries `mergedPRs`, which the sentence does not,
   so removing it loses information. The honest fix is to delete the two duplicated stats and keep the
   row as a labelled line at small size. I left it because I would rather ship one clear redundancy than
   restructure a screen at the end of the pass.
8. **Mixed time formats on Digests.** The digest preview header uses the product's own 24-hour clock
   ("9:00", from `clockTime()`), while the quiet-hours fields are native `<input type="time">` elements
   that their platform renders as "10:00 PM". Both are correct and neither is wrong, but they are two
   formats on one screen. Fix: render quiet hours through the same formatter, or set the field labels to
   match. Recorded because native time inputs bring real keyboard and screen-reader support that a
   hand-rolled 24-hour picker would have to re-earn.
9. **Onboarding runs inside the app shell.** On a phone, the first-run flow shows the repo switcher and
   the four-item tab bar, i.e. navigation into screens that have no data yet, and a switcher for a repo
   the person has not chosen. It keeps URL/back behaviour simple and lets someone bail out mid-flow, but
   the cleaner answer is to render `/connect/:step` outside the frame, as Landing already is. Recorded
   rather than changed because it moves a route out of the shell and would need its own capture pass.
10. **The Goals rows keep one deliberate repetition**: "● 3 days overdue" beside the title and ", 3 days
    overdue." in the sentence. The head version is the only place colour and a word mark urgency
    together, so it earns the echo.
11. **The digest message header uses middle dots** ("syncurateam/syncura · daily digest · 9:00"), which the
    brief's anti-default list warns about for interface copy. It is kept, because that string is not
    interface copy: it is the first line of the real Telegram message, and it has to match what
    `src/formatter.ts` sends. The rule is about the UI inventing `·`-joined meta strings; changing this
    one would make the preview a lie. Logged as conflict C6.
12. **One stylesheet for nine screens.** Lighthouse flags it as render-blocking and as unused CSS. It is
    15 kB gzipped for the whole product, and splitting it per route would trade a render block for a
    flash of unstyled route. Performance still measured 93–96.
13. **CLS 0.077 on Digests** — the preview bubble reflows once when the preview text arrives. Inside the
    0.1 "good" band, and the only non-zero shift in the product.
14. **`label-content-name-mismatch` (weight 0, Lighthouse)** on the Goal Track's links: the audit wants
    the visible label ("12  Login form  M") to appear *contiguously* in the accessible name ("Task 12,
    login form, size M, closed"). Every visible word is in the name, so WCAG 2.5.3 is satisfied in
    substance, and the name carries more than the label would. The accessibility category still scores
    100. Recorded with the reasoning rather than flattened into "12 Login form M, closed"-style names
    that would be worse for a screen reader.

---

## 5. Section 13 — the decorative element removed

Two were removed; the first is the one the brief asks for.

**The `○` glyph before "Unlinked"** in `CommitRow`. The word already says it; the ring was a mark that
carried no information, repeated on every unlinked row. It is the clearest example of the anti-default
the brief lists as "decorative numbered markers" — a symbol that only signals "a symbol belongs here".

Also removed, in the same spirit, from the same critique pass: the middle-dot meta line that used to sit
under each chat bubble (`.bubble__meta`) on Landing and Digests.

## 6. Where this departs from the starting proposal, and why

Each of these was in the brief's starting proposal or implied by it, and each is logged with a reason in
`docs/skills-applied.md` (conflicts C1–C6) or in this document. Nothing was changed silently.

- **Four model additions** — `Issue.reopenedAt`, `TodaySnapshot.focusIssues`, `DigestSettings.subscription:
  Subscription | null`, and a new `linkCommit(repoId, sha, issueNumber)` on `CommitItApi`. The first three
  exist because a screen cannot be correct without them; the fourth because accepting a suggested link is
  a real write and needed a real method. All four are in `docs/api-needs.md` §2.
- **The one-place-per-commit rule for linking**: no auto-linking, ever. The Accept button is the only
  path, and the row says so out loud ("Suggestions are never applied on their own.").
- **`prefers-color-scheme` as the default**, with the manual override persisted under one `localStorage`
  key (`commitit-theme`) and set before first paint by an inline script in `index.html`.
- **`brand/` was created** holding the existing, unmodified artwork, because the master file the brief
  names does not exist in the repo (recorded in `docs/design-plan.md` §1).
- **Dependencies removed** — Tailwind, CVA, `clsx`, `tailwind-merge`, chart.js, framer-motion and one
  Radix package, all of which the redesign replaces with plain CSS custom properties and in-house
  components. `npm install` dropped 38 packages.
- **The mock gained a `?state=` switch**, which is how every state in the matrix can be reviewed on
  purpose instead of being taken on trust.

## 7. What I would do next, in order

Items 1–3 of this list were done in the second pass (§0); the rest stand.

1. ~~People: collapse the sentence and the stat row into one line so no number is stated twice.~~
   Now a section of Settings rather than a screen of its own.
2. Onboarding: render `/connect/:step` outside the app frame, with its own step indicator and no
   repository switcher until step 2.
3. ~~Digests: put quiet hours through the product's own time formatting so one screen has one
   clock.~~ Still open — it is inside Settings' Delivery section now, so the two clocks sit on one
   screen more often than they used to, not less.
4. Ask the backend for the six endpoints in `docs/api-needs.md` §3 that carry the partial/stale
   contract, and flip `USE_REAL_API` to `true` — everything on this branch was built to be
   switched over in one line.
5. Mobile. This pass was reviewed at 1280px only, on the client's instruction. The guards pass at
   360px, but the pass has not been *looked at* on a phone: the one-line commit row, the wider
   52px track nodes and the distributed track layout all need a real mobile read. The Settings
   tabs are the most likely to break first.
