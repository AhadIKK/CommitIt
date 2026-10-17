# Dashboard smoke checklist (redesigned dashboard)

Replaces the pre-redesign checklist, which described a three-tab page that no longer exists. Run this
after any change to `dashboard/src/**`.

**No backend is needed.** The dashboard runs against the mock adapter by default
(`dashboard/src/api/index.ts`, `USE_REAL_API = false`). Fixtures cover the hard cases on purpose.

```powershell
npm.cmd run dashboard:dev        # http://localhost:5173
```

## 1. What automation already covers — read this before doing anything by hand

| Command | What it proves | Expected |
|---|---|---|
| `npx.cmd vitest run dashboard/src` | Weighting, the progress sentence, the digest renderer's caps, formatting helpers, and contrast for every token pair in both themes. | 47 passed |
| `npx.cmd playwright test` | Every screen at 360 px and 1280 px in both themes; the Goal Track's node sizes, accessible names and reopen behaviour; the brief's hard cases; keyboard focus and the skip link; the state matrix; narrow-viewport overflow guards. | 95 passed, 73 skipped |
| `$env:SHOTS=1; npx.cmd playwright test e2e/capture.spec.ts` | Rewrites the 26 screenshots in `docs/screenshots/`. Writes files, so it is opt-in. | 26 passed |
| `npx.cmd tsc -p dashboard/tsconfig.json --noEmit` | Types, including the mock against the `CommitItApi` interface. | no output |
| Lighthouse | Accessibility 100, performance 93–96 on `/`, `/today`, `/digests`. Method and results: `docs/lighthouse.md`. | — |

`npm test` at the repository root also runs the backend tests — they are unrelated to this app and are
not part of this checklist.

## 2. The state matrix — walk these URLs once

Each state is a real route, not a storyboard. The mock announces the active scenario on screen.

| URL | Expect |
|---|---|
| `/today` | Progress sentence, track, activity grouped by author, "Needs attention" |
| `/today?state=empty` | "No goals yet." with the invitation to create a milestone |
| `/today?state=error` | Danger banner naming the failure, with a retry; last good data kept |
| `/today?state=slow` | Skeletons shaped like the final layout, ~1.4 s, no layout jump |
| `/today?state=partial` | Track and sentence present, activity region says it could not load |
| `/today?state=stale` | Live bar reads "Connection dropped, showing the last load"; nothing is blanked |
| `/today?state=offline` | Live bar reads "Offline, showing the last load"; the content under it is kept |
| `/digests?state=burst` | The 100-commit push collapses to one line, the preview stays under 3800 characters |
| `/digests?state=empty` | "No chat connected" invitation instead of a settings form |
| `/goals?state=empty`, `/alerts?state=empty`, `/people?state=error` | Empty and error states of the other screens |

## 3. Manual only — a human still has to check these

- [ ] **Keyboard only, no mouse.** Skip link → repo switcher → every nav item → every track node →
      every action button. Focus is always visible, never covered by the strip or the tab bar, and the
      order matches the visual order.
- [ ] **Screen reader on the Goal Track** (VoiceOver / NVDA). Each node announces
      "Task 12, login form, size M, closed"; a reopened one says "reopened, open again"; an unestimated
      one says it counts as 1 point. The track as a whole reads as a list, not a pile of dots.
- [ ] **Real touch on a real phone.** 44 px targets, 8 px gaps, nothing needs a second tap, and the
      bottom bar does not cover the last row when the keyboard is up.
- [ ] **200 % browser zoom** on Today and Digests. The page reflows; it does not scroll sideways.
- [ ] **Forced colours (Windows High Contrast).** Region separation survives on the hairline and the
      node rings, and "new" still reads as a word.
- [ ] **Both themes by eye** on every screen, including the error and empty states — automation checks
      token contrast, not that an empty state still makes sense on a light ground.
- [ ] **Voice.** Every alert says what happened and what to do. No apology, no "something went wrong",
      no ALL-CAPS, no `·` between facts, no "→" on a button. Empty states invite an action.
- [ ] **A leaked secret is never visible.** `/alerts` names `src/config/keys.ts` and nothing that looks
      like a credential — not in the alert, not in the commit row, not in the digest preview.
- [ ] **Progress is never commit count.** No screen shows a percentage, ring or bar derived from commits.
      The only numbers that move a goal are finished tasks, weighted.

## 4. Before merging

- [ ] `docs/screenshots/` regenerated if any screen changed, and reviewed again against the brief
- [ ] `docs/skills-applied.md` checkpoint C updated with anything new found in the pass
- [ ] No secret, token or `.env` value anywhere in the diff

## 5. Run log

**2026-10-18** — full automated run green (47 unit, 95 e2e, 73 skipped, tsc clean, 26 screenshots
rewritten). Manual pass: the state matrix walked from the URLs in §2; keyboard, skip link and the theme
switch checked; both themes reviewed per screen against the screenshots. The critique round it produced
is written up in `docs/design-notes.md` §4, including the items deliberately left unfixed.
**Not done on a real device:** touch targets, forced-colours mode and a real screen-reader session
(Windows + VoiceOver was used for the keyboard pass, but the 44 px targets were verified from CSS
measurements and Playwright, not by finger).