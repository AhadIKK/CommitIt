# Dashboard browser smoke checklist (webapp-testing, manual run)

Backend first: `npm run dev` (:3000), then `npm run dashboard:dev` (:5173).
Work through each line with DevTools open (Console + Network, no errors).

## Load
- [ ] Repo input prefilled with `AhadIKK/CommitIt`; page loads with no console errors
- [ ] Loading state appears, then sections populate (or honest empty states)

## Views (tablist above content)
- [ ] Dashboard / Review / Help tabs switch; `aria-selected` follows focus
- [ ] Review: Prev/Next buttons work; Left/Right arrow keys move slides; counter reads `n / 3`
- [ ] Help answers match the BFF data shown on Dashboard

## Themes
- [ ] Toggle switches dark ↔ light; choice persists after reload
- [ ] Pills, bars, donuts stay legible in both themes (spot-check contrast)

## Data + exports
- [ ] Donut % matches its points label (e.g. 62% with 8/13 pts)
- [ ] Issues CSV downloads and opens in Excel (columns: number,title,state,weight,milestone)
- [ ] Activity CSV downloads (columns: login,commits,merged_prs)
- [ ] Export .doc opens in Word (headings + 2 tables, no raw markup)
- [ ] Print preview shows the full report, light colors, no clipped rows

## Responsive + a11y
- [ ] 360px wide: no horizontal scroll except inside the issues table
- [ ] Keyboard only: repo input → Load → tabs → exports all reachable, focus visible
- [ ] Avatars and status glyphs are decorative (screen reader hears login/state text)
- [ ] `prefers-reduced-motion` respected (no transitions)

## Failure paths
- [ ] Backend down: error message names the failure, no blank page
- [ ] Unknown repo: empty states render, summary reads "No commits…"
