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
          // So is anything marked data-truncate — an element that deliberately
          // clamps its own text with text-overflow: ellipsis, where the full
          // value is reachable elsewhere (here: in the row's expanded detail).
          // The marker lives in the markup so the exemption is auditable rather
          // than a hidden exception inside the stylesheet.
          // And so is anything inside a deliberate scroll region: a code specimen
          // that scrolls sideways is not an overflow bug, and the page-level
          // check below is what actually catches real horizontal scroll.
          const scrolls = (el: Element): boolean => {
            for (let p = el.parentElement; p; p = p.parentElement) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === "auto" || ox === "scroll") return true;
            }
            return false;
          };
          const overflowing: string[] = [];
          for (const el of Array.from(document.querySelectorAll("body *"))) {
            if (el.closest(".visually-hidden")) continue;
            if (el.closest("[data-truncate]")) continue;
            if (scrolls(el)) continue;
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

test("the phone tab bar gives every tab its own column", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/today");
  await page.locator(".tabbar").waitFor();

  const shape = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".tabbar")!).gridTemplateColumns.split(" ").length,
    tabs: document.querySelectorAll(".tabbar .tab").length,
  }));

  // There are three tabs. The bar used to declare four columns, so the three
  // sat left of centre with an empty quarter on the right.
  expect(shape.tabs).toBe(3);
  expect(shape.columns).toBe(shape.tabs);
});

test("the phone tab bar is a floating pill hovering in front of other UI", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/today");
  await page.locator(".tabbar").waitFor();

  const pill = await page.evaluate(() => {
    const el = document.querySelector(".tabbar")!;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const winHeight = window.innerHeight;
    const bottomGap = Math.round(winHeight - rect.bottom);
    const borderRadius = parseFloat(style.borderRadius);

    return {
      columns: style.gridTemplateColumns.split(" ").length,
      tabs: document.querySelectorAll(".tabbar .tab").length,
      isFloating: bottomGap > 0,
      bottomGap,
      borderRadius,
      hasBackdropFilter:
        style.backdropFilter.includes("blur") ||
        ((style as unknown as Record<string, string>)["webkitBackdropFilter"]?.includes("blur") ?? false),
      zIndex: parseInt(style.zIndex, 10),
      maxWidth: parseFloat(style.maxWidth),
    };
  });

  expect(pill.tabs).toBe(3);
  expect(pill.columns).toBe(pill.tabs);
  expect(pill.isFloating).toBe(true);
  expect(pill.bottomGap).toBeGreaterThanOrEqual(8);
  expect(pill.borderRadius).toBeGreaterThanOrEqual(24);
  expect(pill.hasBackdropFilter).toBe(true);
  expect(pill.zIndex).toBeGreaterThanOrEqual(30);
  expect(pill.maxWidth).toBeLessThanOrEqual(360);
});

test("the phone header controls when signed out share one 44px height with no text wrapping", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/connect/github?state=signed-out");
  await page.locator(".strip").waitFor();
  await page.locator(".field__select--strip").waitFor();
  await page.locator(".user-menu__signin").waitFor();
  await page.locator(".strip .icon-btn").waitFor();

  const shape = await page.evaluate(() => {
    const el = (sel: string) => document.querySelector(sel);
    const h = (sel: string) => {
      const target = el(sel);
      return target ? Math.round(target.getBoundingClientRect().height) : -1;
    };
    const signin = document.querySelector(".user-menu__signin") as HTMLElement;
    const select = document.querySelector(".field__select--strip") as HTMLSelectElement;
    const root = document.documentElement;

    return {
      controls: [
        ".field__select--strip",
        ".user-menu__signin",
        ".strip .icon-btn",
      ].map(h),
      signinText: signin?.textContent?.trim(),
      signinWrapped: signin ? signin.clientHeight > 44 || signin.scrollHeight > signin.clientHeight + 1 : true,
      docOverflow: root.scrollWidth - root.clientWidth,
      selectValue: select?.selectedOptions[0]?.text,
    };
  });

  expect(new Set(shape.controls).size).toBe(1);
  expect(shape.controls[0]).toBe(44);
  expect(shape.signinText).toBe("Sign in");
  expect(shape.signinWrapped).toBe(false);
  expect(shape.docOverflow).toBeLessThanOrEqual(1);
  expect(shape.selectValue).toBe("No repo connected");
});

test("the phone header controls share one height and a larger mark", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/today");
  await page.locator(".strip").waitFor();
  await page.locator(".user-menu__profile").waitFor();

  const shape = await page.evaluate(() => {
    const h = (sel: string) => Math.round(document.querySelector(sel)!.getBoundingClientRect().height);
    const w = (sel: string) => Math.round(document.querySelector(sel)!.getBoundingClientRect().width);
    return {
      controls: [
        ".field__select--strip",
        ".user-menu__profile",
        ".user-menu__logout-btn",
        ".strip .icon-btn",
      ].map(h),
      logo: w(".strip__brand svg"),
      avatar: w(".user-menu__avatar"),
    };
  });

  // One row, one height. A 36px avatar inside the 44px account slot reads as
  // the same control family as the switcher and the two buttons.
  expect(new Set(shape.controls).size).toBe(1);
  expect(shape.controls[0]).toBe(44);
  expect(shape.logo).toBeGreaterThanOrEqual(32);
  expect(shape.avatar).toBeGreaterThanOrEqual(36);
});

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
