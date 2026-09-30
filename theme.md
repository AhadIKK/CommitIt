# CommitIt — Theme

Applies to Telegram messages (now) and web dashboard (V2). Goal: scannable, low-noise, factual.

## Voice
- Terse, neutral, no hype. Past tense for activity, present tense for progress.
- Always label AI output: `AI summary:` prefix. Allow correction via `/link`.
- Never expose SHAs fully (short 7), never expose secret values.

## Telegram formatting
- Parse mode: HTML. Escape `<>&` in commit messages/usernames.
- Structure: header line → progress line → author groups → unlinked → warnings.
- Emoji vocabulary (fixed, no others in MVP):
  - `📊` digest, `🔴` CI failed / urgent, `🟢` CI fixed / merged, `⚠` risk/stale, `🔑` possible secret, `➕` progress gain
- Author line: `• <b>Name</b> — N commits: feat (x), fix (y)`
- Category tags: monospace `feat` `fix` `docs` `refactor` `test` `chore` `merge`
- Footer: `<a href="compare_url">+N more / view diff</a>`

### Templates
Instant (high-priority only — CI fail, secret, force-push to main, direct push to protected):
```
🔴 CI failed on main — build #142
By: Fizan · "Add login route"
<a href="run_url">View run</a>
```
Daily digest:
```
📊 <b>Repo — today</b>
Milestone "Auth": 62% (+8%) (8/13 pts)
• <b>Fizan</b> — 3 commits: feat (login UI), fix (token expiry), test
• <b>Ahad</b> — 2 commits: feat (JWT middleware), docs
Unlinked work: 1 commit → suggested #14
⚠ Stale: feat/profile, no activity 6d
```

## Dashboard theme (V2)
- Font: system stack + monospace for SHAs/branches. No custom fonts in MVP.
- Colors: bg #0F1419 / cards #1A222C (dark) or bg #F6F8FA / cards #FFFFFF (light); accent blue #1F6FEB (progress), green #1A7F37 (merged/closed), red #CF222E (failed/risk), amber #9A6700 (stale).
- Charts: milestone donut (% weighted), stacked bars per author (commits vs merged PRs), timeline of digests. No 3D, no gradients.
- Tables: issues with weight badges S/M/L, state pills open/closed.
