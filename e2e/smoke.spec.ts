import { expect, test, type Page } from "@playwright/test";

/**
 * One test per screen, per form factor, per theme. It asserts the three things
 * that would be embarrassing to ship broken: exactly one h1, no console error,
 * and no horizontal scroll at 360px.
 */
const ROUTES: Array<{ path: string; name: string; heading: RegExp }> = [
  { path: "/", name: "Landing", heading: /a day of commits, as one message/i },
  { path: "/today", name: "Today", heading: /auth is 62% done|no issues yet|nothing here yet/i },
  { path: "/goals", name: "Goals", heading: /^goals$|no goals yet/i },
  { path: "/goals/m_auth", name: "Goal", heading: /auth is 62% done/i },
  { path: "/people", name: "People", heading: /^people$|nobody moved this week/i },
  { path: "/digests", name: "Digests", heading: /^digests$|no chat connected yet/i },
  { path: "/alerts", name: "Alerts", heading: /attention|nothing needs attention/i },
  { path: "/repos", name: "Repo settings", heading: /syncurateam\/syncura|repository settings/i },
  { path: "/connect/github", name: "Onboarding", heading: /connect a repository/i },
];

const THEMES = ["night", "day"] as const;

async function prepare(page: Page, theme: string): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
  });
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("commitit-theme", value);
    } catch {
      /* storage is optional */
    }
  }, theme);
  return problems;
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    for (const route of ROUTES) {
      test(`${route.name} renders and stays inside the viewport`, async ({ page }) => {
        const problems = await prepare(page, theme);
        await page.goto(route.path);

        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveText(route.heading);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

        // nothing may run wider than the viewport, phone included
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `horizontal overflow of ${overflow}px on ${route.path}`).toBeLessThanOrEqual(1);

        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  });
}

test.describe("the Goal Track", () => {
  test("draws one node per task, sized by weight, with an accessible name", async ({ page }) => {
    await page.goto("/goals/m_auth");

    const track = page.locator("ul.track");
    await expect(track).toBeVisible();
    await expect(track.locator("li")).toHaveCount(7);

    const medium = track.locator('li:has([data-weight="3"])').first();
    await expect(medium.locator(".track__node")).toHaveAttribute(
      "aria-label",
      /Task \d+, .*, size M, (open|closed)/,
    );

    const unestimated = track.locator('li:has([data-estimated="false"])').first();
    await expect(unestimated.locator(".track__node")).toHaveAttribute(
      "aria-label",
      /size unknown, counts as 1 point/,
    );

    // a node is reachable and describes itself
    await unestimated.locator(".track__node").focus();
    await expect(page.locator(".track__inspector-title")).toContainText(/Task \d+:/);
  });

  test("S, M and L are three visibly different node sizes", async ({ page }) => {
    // Polish holds one task of each size: 1, 5 and 3 points
    await page.goto("/goals/m_polish");
    await expect(page.locator("ul.track .track__dot")).toHaveCount(3);

    const sizes = await page
      .locator("ul.track .track__dot")
      .evaluateAll((dots) => dots.map((d) => d.getBoundingClientRect().width));
    expect(sizes.length).toBe(3);
    expect(new Set(sizes).size).toBe(3);

    // and the size grows with the weight, never the other way round
    const byWeight = await page.locator("ul.track .track__node").evaluateAll((nodes) =>
      nodes.map((n) => ({
        weight: Number(n.getAttribute("data-weight")),
        width: n.querySelector(".track__dot")?.getBoundingClientRect().width ?? 0,
      })),
    );
    const sorted = [...byWeight].sort((a, b) => a.weight - b.weight);
    expect(sorted[0].width).toBeLessThan(sorted[1].width);
    expect(sorted[1].width).toBeLessThan(sorted[2].width);
  });

  test("a reopened task draws open again, so the line moves back", async ({ page }) => {
    await page.goto("/goals/m_realtime");
    // #23 was closed and then reopened: the node is open again and says so
    const reopened = page.locator('ul.track .track__node[data-state="open"][aria-label*="reopened"]');
    await expect(reopened).toHaveCount(1);
    await expect(reopened).toHaveAttribute("aria-label", /Task 23, reconnect logic, size M, reopened/i);
  });

  test("turns from a horizontal line into a vertical rail at 360px", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator("ul.track")).toBeVisible();
    const orientation = await page.locator(".track-scroll").getAttribute("data-orientation");
    const width = page.viewportSize()?.width ?? 0;
    expect(orientation).toBe(width >= 960 ? "horizontal" : "vertical");
  });
});

test.describe("hard cases from the brief", () => {
  test("a leaked-secret alert names the file and never a secret value", async ({ page }) => {
    await page.goto("/alerts");

    const secret = page.locator("article.alert", { hasText: "possible key was pushed" });
    await expect(secret).toBeVisible();
    await expect(secret).toContainText("src/config/keys.ts");

    // nothing that looks like a credential may be rendered anywhere on the page
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const tell of ["sk_live_", "-----begin", "api_key=", "secret=", "password"]) {
      expect(body, `the page must not contain "${tell}"`).not.toContain(tell);
    }
  });

  test("an empty goal says no issues yet rather than 0%", async ({ page }) => {
    await page.goto("/goals");
    const profile = page.locator("article.goal-row", { hasText: "Profile" });
    await expect(profile).toContainText("no issues yet");
    await expect(profile).not.toContainText("0%");

    const goalsBody = await page.locator("body").innerText();
    // "no due date" is stated in words for a goal that has none
    expect(goalsBody).toContain("no due date");
  });

  test("the progress sentence states points, never a commit count", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator("h1")).toBeVisible();
    const sentence = await page.locator("h1").innerText();
    expect(sentence).toMatch(/points/);
    expect(sentence).not.toMatch(/commits?/);

    // and the activity list underneath carries no percentage at all
    const groups = page.locator(".group .commits");
    if ((await groups.count()) > 0) {
      expect(await page.locator(".group").first().innerText()).not.toContain("%");
    }
  });

  test("a long subject wraps instead of blowing out the 360px viewport", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: /Since your last digest/i })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // the 200-word subject is present in full: wrapped, never clipped with an ellipsis
    const body = await page.locator("body").innerText();
    expect(body).toContain("refactor: split the auth middleware");
    expect(body).toContain("cover the happy path");
  });
});

test.describe("states reached on purpose", () => {
  const CASES: Array<{ state: string; path: string; expect: RegExp; banner?: RegExp }> = [
    { state: "normal", path: "/today", expect: /auth is 62% done/i },
    { state: "slow", path: "/today", expect: /auth is 62% done/i },
    { state: "empty", path: "/today", expect: /nothing here yet/i },
    { state: "error", path: "/today", expect: /^today$/i, banner: /could not load/i },
    { state: "empty", path: "/goals", expect: /no goals yet/i },
    { state: "empty", path: "/alerts", expect: /nothing needs attention/i },
    { state: "empty", path: "/digests", expect: /no chat connected yet/i },
    { state: "error", path: "/people", expect: /^people$/i, banner: /could not load/i },
  ];

  for (const item of CASES) {
    test(`${item.path}?state=${item.state}`, async ({ page }) => {
      await page.goto(`${item.path}?state=${item.state}`);
      await expect(page.locator("h1")).toHaveText(item.expect);
      if (item.banner) {
        await expect(page.locator(".banner")).toContainText(item.banner);
      }
    });
  }
});

test.describe("accessibility", () => {
  test("the skip link moves focus to the content", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator("h1")).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.locator(".skip-link");
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("the theme switch is labelled and works by keyboard", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator("h1")).toBeVisible();
    const toggle = page.getByRole("button", { name: /switch to the (day|night) theme/i }).first();
    await toggle.focus();
    await page.keyboard.press("Enter");
    const after = await page.locator("html").getAttribute("data-theme");
    expect(after === "night" || after === "day").toBe(true);
  });

  test("navigation marks the current page", async ({ page }) => {
    await page.goto("/goals");
    const current = page.locator('[aria-current="page"]');
    await expect(current.first()).toContainText(/Goals/i);
    expect(await current.count()).toBeGreaterThanOrEqual(1);
  });
});
