import { test, type Page } from "@playwright/test";

/**
 * Screenshot capture for docs/design-notes.md. Not part of the default run: it
 * writes files, so it only runs when SHOTS=1.
 *
 *   $env:SHOTS=1; npx playwright test e2e/capture.spec.ts --project=desktop-1280
 *
 * Each shot carries its own viewport so a single run writes honest 360px and
 * 1280px widths, whatever project happens to pick the test up.
 */
const enabled = process.env.SHOTS === "1";

type Shot = {
  name: string;
  path: string;
  theme: "night" | "day";
  /** matches the name suffix; the width is what the layout actually reacts to */
  width: 360 | 1280;
  wait?: "skeleton";
};

const SHOTS: Shot[] = [
  { name: "today-desktop-night", path: "/today", theme: "night", width: 1280 },
  { name: "today-mobile-night", path: "/today", theme: "night", width: 360 },
  { name: "today-desktop-day", path: "/today", theme: "day", width: 1280 },
  { name: "today-mobile-day", path: "/today", theme: "day", width: 360 },
  { name: "goal-desktop-night", path: "/goals/m_auth", theme: "night", width: 1280 },
  { name: "goal-mobile-night", path: "/goals/m_auth", theme: "night", width: 360 },
  { name: "goals-desktop-night", path: "/goals", theme: "night", width: 1280 },
  { name: "goals-mobile-night", path: "/goals", theme: "night", width: 360 },
  { name: "people-desktop-night", path: "/people", theme: "night", width: 1280 },
  { name: "people-mobile-night", path: "/people", theme: "night", width: 360 },
  { name: "digests-desktop-night", path: "/digests", theme: "night", width: 1280 },
  { name: "digests-mobile-night", path: "/digests", theme: "night", width: 360 },
  { name: "alerts-desktop-night", path: "/alerts", theme: "night", width: 1280 },
  { name: "alerts-mobile-night", path: "/alerts", theme: "night", width: 360 },
  { name: "repos-desktop-night", path: "/repos", theme: "night", width: 1280 },
  { name: "repos-mobile-night", path: "/repos", theme: "night", width: 360 },
  { name: "onboarding-desktop-night", path: "/connect/github", theme: "night", width: 1280 },
  { name: "onboarding-mobile-night", path: "/connect/github", theme: "night", width: 360 },
  { name: "landing-desktop-night", path: "/", theme: "night", width: 1280 },
  { name: "landing-mobile-night", path: "/", theme: "night", width: 360 },
  { name: "state-empty-mobile-night", path: "/today?state=empty", theme: "night", width: 360 },
  { name: "state-error-mobile-night", path: "/today?state=error", theme: "night", width: 360 },
  { name: "state-slow-desktop-night", path: "/today?state=slow", theme: "night", width: 1280, wait: "skeleton" },
  { name: "state-partial-desktop-night", path: "/today?state=partial", theme: "night", width: 1280 },
  { name: "state-stale-desktop-night", path: "/today?state=stale", theme: "night", width: 1280 },
  { name: "state-burst-desktop-night", path: "/digests?state=burst", theme: "night", width: 1280 },
];

/**
 * The strip and the tab bar are fixed, so in a full-page capture they would sit
 * over the middle of the page and hide content. Pinning them statically is a
 * screenshot-only change: the document keeps its own top and bottom.
 */
const UNFIX = ".strip, .landing__top, .tabbar { position: static !important; }";

async function prepare(page: Page, theme: string): Promise<void> {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("commitit-theme", value);
    } catch {
      /* storage is optional */
    }
  }, theme);
}

for (const shot of SHOTS) {
  test(`capture ${shot.name}`, async ({ page }) => {
    test.skip(!enabled, "set SHOTS=1 to write screenshots");
    await prepare(page, shot.theme);
    await page.setViewportSize({ width: shot.width, height: shot.width === 360 ? 740 : 900 });
    await page.goto(shot.path);
    if (shot.wait === "skeleton") {
      // the slow scenario keeps its 1.4s latency, so this is the loading state
      await page.waitForTimeout(250);
    } else {
      await page.locator("h1").first().waitFor({ state: "visible" });
      await page.waitForTimeout(150);
    }
    await page.addStyleTag({ content: UNFIX });
    await page.screenshot({ path: `docs/screenshots/${shot.name}.png`, fullPage: true });
  });
}
