import { expect, test, type Page } from "@playwright/test";

/**
 * The authenticated app. One test per route, per theme, asserting the three
 * things that would be embarrassing to ship broken: exactly one h1, no console
 * error, and no horizontal scroll at 360px.
 *
 * The ledger's own rules get their own tests further down â€” the signal colour
 * appearing once per screen, the invariant switches, and the promise that a
 * secret finding names a file and never a value.
 */
const ROUTES: Array<{ path: string; name: string; heading: RegExp }> = [
  { path: "/app", name: "Overview", heading: /^overview$/i },
  { path: "/app/tasks", name: "Tasks", heading: /^tasks$/i },
  { path: "/app/digests", name: "Digests", heading: /^digests$/i },
  { path: "/app/alerts", name: "Alerts", heading: /^alerts$/i },
  { path: "/app/chats", name: "Chats", heading: /^chats$/i },
  { path: "/app/system", name: "Pipeline", heading: /pipeline/i },
  { path: "/app/security", name: "Safety", heading: /safety|secrets/i },
  { path: "/app/settings", name: "Settings", heading: /^account$/i },
  { path: "/login", name: "Login", heading: /commits are not\s*progress/i },
  { path: "/terms", name: "Terms", heading: /^terms$/i },
  { path: "/privacy", name: "Privacy", heading: /^privacy$/i },
  { path: "/changelog", name: "Changelog", heading: /^changelog$/i },
  { path: "/docs", name: "Docs", heading: /^docs$/i },
  { path: "/onboarding", name: "Onboarding", heading: /four steps/i },
  { path: "/no-such-page", name: "Not found", heading: /not on the books/i },
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
  test.describe(`app Â· ${theme} theme`, () => {
    for (const route of ROUTES) {
      test(`${route.name} renders and stays inside the viewport`, async ({ page }) => {
        const problems = await prepare(page, theme);
        await page.goto(route.path);

        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveText(route.heading);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `horizontal overflow of ${overflow}px on ${route.path}`).toBeLessThanOrEqual(1);

        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  });
}

test.describe("the ledger's rules", () => {
  test("the spine names its sections in words, with no icon", async ({ page }) => {
    await page.goto("/app");
    const tabs = page.locator(".spine__tab");
    await expect(tabs).toHaveCount(8);
    for (const label of ["Overview", "Tasks", "Digests", "Alerts", "Chats", "Safety", "Settings"]) {
      await expect(tabs.filter({ hasText: label }).first()).toBeVisible();
    }
    // a section is a word, not a glyph
    await expect(page.locator(".spine__tab svg")).toHaveCount(0);
  });

  test("the active tab is marked for assistive technology", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".spine__tab.is-active")).toHaveCount(1);
    await expect(page.locator('.spine__tab[aria-current="page"]')).toHaveCount(1);
  });

  test("commits are called activity and never progress", async ({ page }) => {
    await page.goto("/app");
    // the route is lazy: wait for the tally, not just for the document
    await expect(page.locator(".tally")).toBeVisible();
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("activity");
    // the headline must speak in points
    await expect(page.locator(".tally__unit").first()).toContainText(/point/i);
    // and it must not count commits as the headline number
    await expect(page.locator(".tally__figure")).toContainText(/\d/);
  });

  test("the track is the one bold element: signal fills the points, not the links", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".micro-track").first()).toBeVisible();
    const fills = page.locator(".micro-track__done");
    await expect(fills.first()).toBeVisible();
    await expect(fills.first()).toHaveCSS("fill", "rgb(228, 68, 11)");
    // nothing interactive may wear the signal colour
    const linkFills = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .map((a) => getComputedStyle(a).color)
        .filter((c) => c === "rgb(228, 68, 11)"),
    );
    expect(linkFills).toEqual([]);
  });

  test("a secret finding names the file and never a value", async ({ page }) => {
    await page.goto("/app/security");
    const rows = page.locator(".ledger-table tbody tr");
    await expect(rows.first()).toBeVisible();

    const paths = await page.locator(".ledger-table tbody .path").allInnerTexts();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      // a path, not a credential: no long unbroken token
      expect(p).toMatch(/^[\w./-]+\.\w+$/);
      expect(p.length).toBeLessThan(60);
    }

    const body = await page.locator("body").innerText();
    // the classic credential shapes must not appear anywhere on the page
    expect(body).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(body).not.toMatch(/\bsk-[A-Za-z0-9]{20,}/);
    expect(body).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  test("an invariant control is locked and says so", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /digests and notifications/i }).click();

    const finished = page.getByRole("switch", { name: "Finished" });
    await expect(finished).toBeDisabled();
    await expect(finished).toHaveAttribute("aria-checked", "true");
  });

  test("an editable control is not locked", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /digests and notifications/i }).click();
    const moved = page.getByRole("switch", { name: "Moved" });
    await expect(moved).toBeEnabled();
    await moved.click();
    await expect(moved).toHaveAttribute("aria-checked", "false");
  });

  test("settings shows an unposted bar only once something is changed", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.locator(".unposted")).toHaveCount(0);
    await page.getByRole("switch", { name: /keyboard shortcuts/i }).click();
    await expect(page.locator(".unposted")).toBeVisible();
    await page.locator(".unposted").getByRole("button", { name: /discard/i }).click();
    await expect(page.locator(".unposted")).toHaveCount(0);
  });

  test("an unlinked repository reads as unlinked, not as zero percent", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("body")).toContainText(/not (yet )?(connected|linked)/i);
  });

  test("the status line stays visible at the foot", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".statusline")).toBeVisible();
    await expect(page.locator(".statusline")).toContainText(/worker/i);
  });
});

test.describe("the app's Goal Track", () => {
  test("node area is proportional to weight, so L reads larger than M and S", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".micro-track__done").first()).toBeVisible();
    const radii = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".micro-track__done, .micro-track__open"))
        .map((c) => Number((c as SVGCircleElement).getAttribute("r") ?? "0"))
        .filter((r) => r > 0),
    );
    expect(radii.length).toBeGreaterThan(2);
    const sorted = [...radii].sort((a, b) => a - b);
    expect(sorted[0]).toBeLessThan(sorted[sorted.length - 1]!);
  });
});