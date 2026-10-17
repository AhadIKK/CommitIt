# Skills applied — CommitIt frontend redesign

Branch: `front-end-redesign`. Every entry below is dated. Checkpoints A, B (per screen) and C
are appended as the work progresses, per section 0.2 of the brief.

Last updated: 2026-10-17

---

## 1. Skill load log (gate)

| # | Skill | How loaded | Result |
|---|---|---|---|
| 1 | `ui-ux-pro-max` | skill tool (id `ui-ux-pro-max`), base dir `.opencode/skills/ui-ux-pro-max` | Loaded, full SKILL.md read |
| 2 | `frontend-design` | skill tool (id `frontend-design`), base dir `.opencode/skills/frontend-design` | Loaded, full SKILL.md read |

Both loaded on the first attempt, no errors. No fallback, no substitution was needed.

### Tooling actually run for `ui-ux-pro-max`

The skill ships a search script; it was run (Python 3.11.9) exactly as the skill documents:

- `search.py "<query>" --design-system -p "CommitIt" --variance 4 --motion 3 --density 7`
- `search.py "team progress tracker mobile app analytics board" --design-system ...` (the skill's
  documented retry-after-miss step)
- `--domain ux`: `"touch target bottom navigation mobile"`, `"form inline validation error near field"`,
  `"empty state onboarding first run"`, `"sticky header focus obscured skeleton loading"`
- `--domain typography`: `"geometric sans developer tool headings"`
- `--domain color`: `"dark mode technical app navy teal dashboard"`
- `--domain landing`: `"hero product demo single cta"`
- `--domain icons`: `"icon button accessible label decorative aria hidden"`
- `--stack react`: `"react table list rerender memo"`
- Read `references/pro-rules.md` (canonical pre-delivery checklist) and
  `references/quick-reference.md` (rule index; categories 1–3 read in full, 4–10 used as an index).

**Provenance, stated honestly (skill rule: never persist unverified output):**

- `--design-system` **pattern** matches were off-topic both times ("FAQ/Documentation Landing",
  then "Hero + Testimonials + CTA"). The retry did not fix it. → **No verified pattern match.**
  I do **not** use either pattern. Treated as a failed lookup, not as data.
- `--design-system` **palette** matches were off-topic in the retry (book-brown/amber "Book brown +
  page amber"). The first run's "Code dark + run green" palette is close to the brand but the brand
  is FIXED. → **No verified palette match.** Palette comes from section 3, using the skill's
  contrast and semantic-token rules as the checks.
- `--design-system` **style** matches were genuinely on target: "Minimalism & Swiss Style"
  (keywords: clean, spacious, functional, high contrast, geometric, grid-based, essential) and
  "Dark Mode (OLED)" (low-light, high contrast, eye-friendly). → **Verified match. Adopted** for the
  night theme and for the region/rule discipline.
- `--domain typography` matched "Developer Mono — JetBrains Mono / IBM Plex Sans" (mood: code,
  developer, technical, precise). → **Verified match, conflicts with a FIXED item.** The brief fixes
  Poppins + Public Sans + JetBrains Mono. FIXED wins; I keep only the skill's *split* — monospace for
  code, sans for UI (logged in §4).
- `--domain color` matched "Smart Home/IoT Dashboard" whose *Primary* is literally `#1E293B` and
  *Muted Foreground* is `#94A3B8` — the brand values. → **Verified match** for structure
  (primary/foreground/muted/border roles), values overridden by FIXED brand.
- All `--domain ux`, `--domain icons`, `--domain landing`, `--stack react` results were on-topic and
  are used below. The lint/guidance queries matched exactly one dominant intent each, as the skill's
  query contract requires.

---

## 2. `ui-ux-pro-max` — rules I will apply (usability foundation)

Numbered so the design plan and per-screen checkpoint entries can cite them.

### Accessibility (skill priority 1, CRITICAL)
1. **Contrast ≥ 4.5:1** for normal text, **3:1** for large text and for meaningful non-text
   (icons, borders, node strokes). Tested per theme, never inferred from one theme
   (`color-accessible-pairs`, `color-dark-mode`, pro-rules "Light/Dark Mode Contrast"). Enforced by
   an automated unit test over the token table, not by eye.
2. **Visible keyboard focus** on every interactive control — 2px ring, ≥3:1 against both the control
   and its background, `outline-offset` so it is never clipped (`focus-states`, `focus-appearance`).
3. **Focus not obscured (WCAG 2.2 AA)** — sticky top bar, banner and bottom tab bar get
   `scroll-padding` and bottom content inset so focus is never covered (`focus-not-obscured`,
   `sticky-navigation`).
4. **Colour is never the only signal** (`color-not-only`): every category, severity and state carries
   an icon and a text label as well as its colour.
5. **Keyboard operability** for everything, including the Goal Track: tab order matches visual order,
   `role="img"`/list semantics with a full accessible name per node, and a non-pointer path to every
   action (`keyboard-nav`, `dragging-alternative` — the track has no drag at all).
6. **Semantic structure**: one `h1` per screen, no heading level skipped, `main` landmark, skip link
   to it, labelled nav landmarks (`skip-links`, `heading-hierarchy`, `form-labels`).
7. **Live regions** used with restraint: exactly one polite status region for activity updates and
   delivery state; the stale/offline bar is a `status`, never a `role="alert"` storm
   (`contextual-live-badge-updates`, `toast-accessibility`).
8. **Reduced motion** honoured: `prefers-reduced-motion: reduce` replaces the Goal Track fill with the
   final state instantly (`reduced-motion`).
9. **Web target size**: pointer targets ≥ 24×24 CSS px minimum, and ≥ 44×44 px for the touch surfaces
   (bottom tab bar, node hit areas, toggles) (`web-target-size`, `touch-target-size`).

### Touch & interaction (priority 2, CRITICAL)
10. **44×44 px minimum** touch targets and **≥8 px** gaps between adjacent targets
    (`touch-target-size`, `touch-spacing`).
11. **Press feedback within 100 ms** that does not shift layout bounds (opacity/tonal step only, no
    transform that reflows) (`press-feedback`, `tap-feedback-speed`).
12. **No hover-only affordances**: anything revealed on hover is also reachable by focus and tap
    (`hover-vs-tap`).
13. **Loading buttons** disable and show progress for the duration of an async action
    (`loading-buttons`), with the follow-up message repeating the action name.

### Performance (priority 3, HIGH)
14. **Skeletons shaped like the final layout** for first loads > 1s, not spinners; **space reserved**
    so nothing jumps (Cumulative Layout Shift < 0.1) (`progressive-loading`, `content-jumping`).
15. **Route-level code splitting** with `React.lazy` so Landing/Onboarding do not ship the app shell
    and vice versa (`bundle-splitting`, `lazy-loading`).
16. **Self-hosted fonts with `font-display: swap`**, critical weights only, preloaded, sized to avoid
    layout shift (`font-loading`, `font-preload`, `critical-css`).
17. **Transform/opacity only** in animation; never animate `width`/`height`/`top`/`left`
    (`transform-performance`, `layout-shift-avoid`).
18. **Tabular figures** for all counters, percentages, points and timestamps so numbers do not jitter
    (`number-tabular`).

### Style selection (priority 4, HIGH)
19. **Semantic tokens only** — components never hardcode a hex value; everything resolves through the
    three-layer token file (`color-semantic`, `token-driven-theming`).
20. **One icon family, one stroke width, one fill discipline** at each hierarchy level. No emoji as
    icons (`no-emoji-icons`, `icon-style-consistent`, `stroke-consistency`).
21. **Tonal separation, not shadows**: surfaces separated by a step in the tonal ramp plus a single
    hairline; no drop-shadow kit, no blur as decoration (`elevation-consistent`, `blur-purpose`).
22. **One primary action per screen**; secondary actions are visually subordinate
    (`primary-action`).
23. **Same style on every screen** — the rail, the track, the rules and the type are identical across
    all nine screens (`consistency`).

### Layout & responsive (priority 5, HIGH)
24. **Mobile-first**, designed at **360 px** and enhanced at 768 / 1280 / 1920
    (`mobile-first`, `breakpoint-consistency`).
25. **No horizontal scroll at 360 px** and never disable zoom (`horizontal-scroll`, `viewport-meta`).
26. **Body text ≥ 16 px on mobile** (`readable-font-size`); line length 35–60 chars mobile, 60–75
    desktop (`line-length-control`, `line-length`).
27. **4/8 px spacing rhythm** at component, section and page level (`spacing-scale`).
28. **`min-h-dvh`, not `100vh`**; fixed bottom bar reserves content inset
    (`viewport-units`, `fixed-element-offset`).
29. **Long tokens reflow**: commit subjects, SHAs used as prose, branches and paths use
    `overflow-wrap: anywhere` on a shrinkable child, never `word-break: break-all` on prose
    (`long-token-wrapping`).
30. **A numbered z-index scale** declared once (`z-index-management`).

### Typography & colour (priority 6, MEDIUM)
31. **Line-height 1.5–1.75** for body; weights 600–700 headings / 500 labels / 400 body; a single
    type scale (12/14/16/20/24/32/44) (`line-height`, `weight-hierarchy`, `font-scale`).
32. **Wrap rather than truncate**, and when truncation is unavoidable, ellipsis + full value available
    to pointer *and* keyboard users (`truncation-strategy`, `compact-label-overflow`).
33. **Whitespace groups**: related things closer, unrelated things further apart — spacing encodes
    meaning instead of a card boundary doing it (`whitespace-balance`).
34. **Headings wrap naturally**; no blanket non-breaking spaces to force a shape
    (`heading-line-balance`).

### Animation (priority 7, MEDIUM)
35. **One orchestrated moment per session**: the Goal Track fill on Today. Nothing else animates
    without a cause (`excessive-motion`, `motion-meaning`).
36. **Motion answers an action**: node fills on live arrival, digest preview updates, toggle confirms;
    enter decelerates, exit is ~65 % of enter; state changes are cancellable and set their final state
    explicitly (`easing`, `exit-faster-than-enter`, `cancellable-state-transitions`, `state-transition`).
37. **Never block input** during animation; UI stays interactive (`no-blocking-animation`).
38. **Stagger 30–50 ms** where a list genuinely arrives as a group (`stagger-sequence`) — used once,
    on the landing hero collapse, not on every section.

### Forms & feedback (priority 8, MEDIUM)
39. **Visible label per field**, never placeholder-only; helper text persists below complex inputs
    (`input-labels`, `input-helper-text`).
40. **Validate on blur**, show the error directly below the field, wire it with `aria-describedby`;
    after a failed submit with several errors, focus a linked, focusable error summary and keep the
    inline errors (`inline-validation`, `error-placement`, `error-summary`, `focus-management`).
41. **Errors state cause + fix, never apologise**, and always carry a recovery path
    (`error-clarity`, `error-recovery`).
42. **Empty states invite an action** (`empty-states`): "No goals yet. Create a milestone on GitHub
    and it will appear here."
43. **Submit feedback**: loading → success/error, and destructive actions confirm first
    (`submit-feedback`, `confirmation-dialogs`).
44. **Disabled states** use reduced opacity + semantic attribute + no action
    (`disabled-states`).
45. **Multi-step flow** (onboarding) shows its step indicator and always allows going back
    (`multi-step-progress`); progress is saved per step (`form-autosave`).

### Navigation (priority 9, HIGH)
46. **Bottom tab bar ≤ 5 items, each icon + text label** — Today, Goals, People, Digests
    (`bottom-nav-limit`).
47. **Predictable back**: real URLs via the router, deep-linkable, browser back restores the screen
    and its scroll position (`back-behavior`).
48. **Secondary navigation lives in the rail**, not in the primary tab bar (`drawer-usage`).

### Charts & data (priority 10, LOW)
49. **Never colour alone**, always a legend/label, and an accessible text equivalent for any data
    visual (`charts`, `color-not-only`). The Goal Track is a data visual: it gets a per-node
    accessible name and a plain-language sentence beside it.

### Canonical pre-delivery checklist (`references/pro-rules.md`)
Applied as the final pass at checkpoint C. Because this is web (not native), the skill's own scope
notice directs web interaction patterns to `quick-reference.md`; the checklist's touch-target,
contrast-parity, safe-area, `aria-hidden`-on-decorative-icon, colour-not-only, reduced-motion and
focus-order items all still apply and are run verbatim. The native-only items (haptics, Dynamic Type,
platform scopes) do not apply and are noted as not-applicable rather than silently skipped.

---

## 3. `frontend-design` — rules I will apply (visual identity and craft)

1. **Ground every choice in the subject.** The subject is *a day of commits reduced to one calm
   message*. The design's primary job is to make "how close are we to done" readable in one glance on
   a phone, without ever implying that commits are progress.
2. **One concrete aesthetic direction, taken from the subject's own vernacular — not from dashboard
   kit.** Direction: **"one line through it."** A chat is a thread; a commit graph is a line of nodes;
   the logo is two nodes joined by a line. The interface is drawn with that same single line. It is
   reused as structure (the rail spine, the region rule, the Goal Track) rather than as ornament, and
   no second decorative motif is introduced.
3. **Choose typefaces deliberately** — here constrained by the FIXED brand, so personality comes from
   scale, weight, measure and figure style: one display line per screen (the progress sentence) set
   large in Poppins 600; everything else quiet in Public Sans; JetBrains Mono for SHAs, branches and
   paths only.
4. **Avoid the listed default treatments**: no accenting one word in a headline with another colour or
   italic; no all-caps labels; no eyebrow above a heading that the heading already says; no
   "WORD — fragment" labels; no middle-dot meta strings; no trailing "→" on links or buttons.
5. **Structure is information.** Rules, nodes and indentation exist only where they mean something:
   the hairline separates author groups; node size is task weight; indentation is goal membership.
   No box, border or number appears decorationally. Numbered markers **only** on the onboarding steps,
   which really are a sequence.
6. **One orchestrated motion moment** (the Goal Track fill) plus motion that answers an action.
   Explicitly *not* fade-and-slide-up on each section, and no hover animation on every row.
7. **Writing is design content**: plain, specific, active, sentence case; buttons name their action and
   the confirmation repeats it; errors say what happened and what to do next and do not apologise;
   empty states are invitations.
8. **Two-pass process**: plan (this document + `design-plan.md`) → review the plan against the brief
   and revise what reads as generic (recorded in `design-plan.md` §7) → build → self-critique at
   checkpoint C with screenshots, then remove one accessory.
9. **Restraint**: boldness is spent in exactly one place, the Goal Track. Everything else is quiet.
10. **Quality floor without announcing it**: responsive to 360 px, visible focus, reduced motion,
    accessible contrast, harmonious palette.

---

## 4. Division of labour and precedence

- **Behaviour and accessibility** are decided by `ui-ux-pro-max` (navigation, interaction patterns,
  forms and validation, loading/empty/error/stale states, touch targets, responsive behaviour,
  component and token decisions).
- **Look and craft** are decided by `frontend-design` (aesthetic direction, typography treatment,
  layout concept, restrained motion, voice, the plan→review→critique loop).
- **Precedence**: (1) FIXED items in the brief — brand and *progress = finished tasks* — always win;
  (2) then the two skills, with `frontend-design` deciding how it looks and `ui-ux-pro-max` deciding
  how it behaves and whether it is accessible; (3) then the brief's starting proposals, which either
  skill may overrule if the change is logged here.

### Conflicts logged so far

| # | Conflict | Resolution | Reason |
|---|---|---|---|
| C1 | `ui-ux-pro-max` typography match recommends JetBrains Mono as the **heading** face with IBM Plex Sans body ("Developer Mono"). | FIXED wins: Poppins 600/700 headings, Public Sans body, JetBrains Mono for code only. | Section 3 fixes the wordmark face as Poppins 700 and the brief fixes the body face; brand outranks a database match. The skill's *split* (mono for code, sans for UI) is kept. |
| C2 | Skill's `--design-system` proposes a bright accent for CTAs (e.g. `#22C55E` "run green"). | FIXED wins: `--signal` (teal) means only "new since you last looked"; the primary button uses `--ink`, not teal. | Section 3: teal means exactly one thing. A teal CTA would break that meaning. |
| C3 | Skill pattern match "Hero + Testimonials + CTA" includes a testimonials carousel. | Rejected: the brief forbids testimonials and invented statistics; pattern match was unverified anyway. | Section 7.4 and the anti-default list. |
| C4 | `frontend-design` asks for deliberately chosen (non-default) typefaces. | Partially overruled by FIXED brand faces; compensated with scale/weight/figure treatment. | Section 3 fixes the faces. |
| C5 | `frontend-design` warns against hairline-rules/zero-radius as a "broadsheet" tell. | Kept deliberately, but only where the rule carries information, and with a *single* rule weight and a *single* radius scale — not a whole-surface treatment. | The hairline **is** the subject's motif (the line joining two nodes) and the brief explicitly asks for "tonal steps and a single hairline, not drop shadows" (§4). Rationale logged rather than silently ignored. |

---

## 5. Checkpoint log

### Checkpoint A — before writing the design plan (2026-10-17)
Consulted both skills again (SKILL.md bodies + the searches listed above) and re-read
`ui-ux-pro-max` rules §1–§3 and `pro-rules.md` before drafting `docs/design-plan.md`.

Concretely applied at this checkpoint:
- **ui-ux-pro-max** §2 rules 1, 2, 3, 4, 8, 9, 10, 19, 21, 22, 24, 25, 26, 27, 31, 33, 43, 46, 47, 49
  shaped the UX plan (navigation model, the state matrix, the accessibility approach, the token
  structure and the Goal Track's accessible name). Rule 16 shaped the font plan.
- **frontend-design** §3 rules 2, 3, 4, 5, 6, 7 shaped the visual direction, the type treatment, the
  wireframes and the voice section.
- Could not satisfy: `ui-ux-pro-max` has no verified `--design-system` **pattern** or **palette** match
  for this product (documented in §1). The plan therefore uses the verified **style** matches
  (Minimalism & Swiss / Dark-Mode) as its only design-system input, plus the FIXED brand, and says so.

### Checkpoint B — per screen (entries added as each screen is built)

_(populated during the build, section 11 step 4)_

### Checkpoint C — before the final critique pass

_(populated at section 11 step 5)_
