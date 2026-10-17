import { expect, test } from "@playwright/test";

/**
 * Narrow-layout guards. These exist because two real bugs got past the first
 * smoke pass: a task title squeezed to 0px by a max-content grid column, and the
 * wordmark overflowing its box into the repo switcher at 360px. Both are silent
 * in a screenshot and invisible to a "does the heading exist" test.
 */
const ROUTES = [
  "/",
  "/connect/github",
  "/today",
  "/goals",
  "/goals/m_auth",
  "/goals/m_empty",
  "/people",
  "/digests",
  "/alerts",
  "/repos",
];

const VIEWPORTS = [
  { name: "mobile-360", width: 360, height: 740 },
  { name: "desktop-1280", width: 1280, height: 900 },
] as const;

// Every test here sets its own viewport, so the file runs once rather than once
// per project.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", "viewport is set per test");
});

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    for (const route of ROUTES) {
      test(`${route} never overflows its own boxes`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route);
        await page.locator("h1").first().waitFor();
        await page.waitForTimeout(250);

        const report = await page.evaluate(() => {
          const root = document.documentElement;
          // Text wider than the box that holds it: it will overlap whatever sits
          // next to it. Visually-hidden text and native form controls are exempt.
          const overflowing: string[] = [];
          for (const el of Array.from(document.querySelectorAll("body *"))) {
            if (el.closest(".visually-hidden")) continue;
            if (["SELECT", "INPUT", "OPTION", "TEXTAREA", "SVG"].includes(el.tagName)) continue;
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.position === "absolute") continue;
            if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth < 8) continue;
            const own = Array.from(el.childNodes).some(
              (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 2,
            );
            if (!own) continue;
            const cls =
              typeof el.className === "string" && el.className
                ? `.${el.className.trim().split(/\s+/).join(".")}`
                : "";
            overflowing.push(
              `${el.tagName.toLowerCase()}${cls} client=${el.clientWidth} scroll=${el.scrollWidth}`,
            );
          }
          return {
            docOverflow: root.scrollWidth - root.clientWidth,
            overflowing: [...new Set(overflowing)],
          };
        });

        expect(report.docOverflow, "no horizontal page scroll").toBeLessThanOrEqual(1);
        expect(report.overflowing, "no text wider than its own box").toEqual([]);
      });
    }
  });
}

test("a phone keeps the goal track readable", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/goals/m_auth");
  await page.locator("h1").first().waitFor();
  await page.waitForTimeout(250);

  const widths = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll(".track__title"));
    return {
      label: Math.round(document.querySelector(".track__label")!.getBoundingClientRect().width),
      // a short title is sized to its own text; a long one must reach the room
      // that is actually available rather than being capped at the node width
      widestTitle: Math.round(
        Math.max(...titles.map((t) => t.getBoundingClientRect().width)),
      ),
      taskTitle: Math.round(document.querySelector(".task__title")!.getBoundingClientRect().width),
    };
  });

  // 44px is the node's hit area; the text beside it must be much wider than that.
  expect(widths.label, "vertical track label has room").toBeGreaterThan(120);
  expect(widths.widestTitle, "a long task title reaches the available width").toBeGreaterThan(150);
  expect(widths.taskTitle, "a task title in the list is readable").toBeGreaterThan(150);
});
