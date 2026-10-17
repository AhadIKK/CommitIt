# Lighthouse — measured, not assumed

Branch `front-end-redesign`, 2026-10-18. The brief asks for **accessibility ≥ 95** and
**performance ≥ 90**. Both were measured on a production build, on an unthrottled local server, with
Lighthouse's default mobile emulation (412 px viewport, 4× CPU throttle, slow-4G network).

## How it was run

No Lighthouse config exists in this repo, so the run is reproducible from these five steps:

```powershell
# 1. a production build, to a temp folder — NOT ../public (that would empty public/llms.txt)
npx.cmd vite build -c dashboard/vite.config.ts --outDir "$env:TEMP\commitit-lh" --emptyOutDir

# 2. serve it with gzip + immutable cache headers on /assets/*, SPA fallback to index.html
#    (scripts were one-off files in %TEMP%; any static host behaves the same way)

# 3. point Lighthouse at its own Chrome
$env:CHROME_PATH = "$env:LOCALAPPDATA\ms-playwright\chromium-1248\chrome-win64\chrome.exe"

# 4. run it per route
npx.cmd lighthouse@12 http://localhost:4181/today --quiet --output=json `
  --only-categories=performance,accessibility `
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage"

# 5. read categories.performance.score and categories.accessibility.score
```

The app was served with `USE_REAL_API = false`, i.e. the mock adapter, so no backend was involved.
That measures the interface, which is what this branch changed.

## Results

| Route | Performance | Accessibility | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|
| `/` (Landing) | **94** | **100** | 2.4 s | 2.5 s | 22 ms | 0 |
| `/today` | **96** | **100** | 2.0 s | 2.3 s | 106 ms | 0.0002 |
| `/digests` | **93** | **100** | 2.3 s | 2.6 s | 79 ms | 0.077 |

Both targets are met on all three routes, on the harsher mobile preset.

**A first run scored 79–81 performance.** That number was wrong, and it is worth recording why: the
one-off static server used for the first run sent the bundles **uncompressed** with no cache headers,
which is not how anything is deployed. Lighthouse's own `uses-text-compression` and
`uses-long-cache-ttl` audits caught it, so the harness was fixed (gzip + `immutable` on hashed assets)
and the run repeated. The second set of numbers is the honest one, because it isolates the cost of the
interface from the cost of a throwaway file server.

## What is left on the list, and whether it matters

| Finding | Verdict |
|---|---|
| `render-blocking-resources` (one CSS file, 49 kB → 15 kB gzip) | Real, and accepted. One stylesheet with `font-display: swap` and preloaded fonts is what keeps first paint honest; splitting it per route would trade a render-block for a flash of unstyled route. |
| `unused-css-rules`, `unused-javascript` | Informational only. JavaScript **is** route-split (`Landing`, `Goals`, `Goal`, `People`, `Digests`, `Alerts`, `RepoSettings`, `Onboarding` are separate chunks, 2.9–9 kB each). The CSS is one file for all nine screens, on purpose. |
| `label-content-name-mismatch`, score 0, **weight 0** on `/today` | Recorded and explained in `design-notes.md` §5. The visible words of a Goal Track node ("12", "Login form", "M") are all present in its accessible name ("Task 12, login form, size M, closed"); the audit wants them contiguous. Weight 0, and the accessibility category still scores 100. |
| `largest-contentful-paint-element` on `/digests` (CLS 0.077) | The only non-zero layout shift in the product, and it is still inside the 0.1 "good" band. The digest preview bubble reflows once when the preview text arrives. Left as-is; recorded so it is a decision and not an oversight. |
