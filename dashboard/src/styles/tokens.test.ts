/**
 * Contrast is enforced, not assumed. This reads the real token file and measures
 * every pair the interface actually paints, in both themes, so a colour cannot be
 * "fixed" in a review without this test noticing.
 *
 * The brief's day-theme values were measured rather than trusted: `--d-signal`
 * needed darkening and `--d-warn` was too light to pass, and both live in
 * tokens.css with the measured ratio beside them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function primitive(theme: "n" | "d", name: string): string {
  const match = css.match(new RegExp(`--${theme}-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${theme}-${name} is missing from tokens.css`);
  return match[1];
}

function srgb(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const THEMES = [
  { key: "n" as const, label: "night" },
  { key: "d" as const, label: "day" },
];

describe("brand colours", () => {
  it("keep the three fixed artwork values, restated and not restyled", () => {
    expect(css).toContain("--brand-ink-navy: #1e293b");
    expect(css).toContain("--brand-slate-mist: #e2e8f0");
    expect(css).toContain("--brand-signal-teal: #14b8a6");
  });

  it("keep teal on the mark and nowhere else in the interface", () => {
    // The logo is teal and stays teal. Nothing the interface paints may be:
    // the weight ramp is the only chroma the product spends on data.
    expect(css).not.toMatch(/--(n|d)-signal:/);
  });
});

describe.each(THEMES)("$label theme", ({ key }) => {
  const ground = primitive(key, "ground");
  const surface = primitive(key, "surface");
  const raised = primitive(key, "raised");
  const ink = primitive(key, "ink");
  const muted = primitive(key, "muted");
  const attention = primitive(key, "attention");
  const danger = primitive(key, "danger");
  const focus = primitive(key, "focus");
  const edge = primitive(key, "edge");
  const hairline = primitive(key, "hairline");
  const weightS = primitive(key, "weight-s");
  const weightM = primitive(key, "weight-m");
  const weightL = primitive(key, "weight-l");

  it("body text passes 4.5:1 on every surface", () => {
    for (const [name, bg] of [
      ["ground", ground],
      ["surface", surface],
      ["raised", raised],
    ] as const) {
      expect(round(contrast(ink, bg)), `ink on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("secondary text passes 4.5:1 on every surface", () => {
    for (const [name, bg] of [
      ["ground", ground],
      ["surface", surface],
      ["raised", raised],
    ] as const) {
      expect(round(contrast(muted, bg)), `muted on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("attention and danger pass 4.5:1, because they carry meaning", () => {
    for (const [name, bg] of [
      ["ground", ground],
      ["surface", surface],
    ] as const) {
      expect(round(contrast(attention, bg)), `attention on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(round(contrast(danger, bg)), `danger on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every weight step is legible as text on the ground it sits on", () => {
    for (const [name, value] of [
      ["weight-s", weightS],
      ["weight-m", weightM],
      ["weight-l", weightL],
    ] as const) {
      expect(round(contrast(value, ground)), `${name} on ground`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the three weight steps are distinguishable from each other", () => {
    // The ramp is a magnitude scale, so consecutive steps must be far enough
    // apart to read as different weights, not as one colour with noise.
    const steps = [weightS, weightM, weightL];
    for (let i = 0; i < steps.length - 1; i++) {
      expect(
        round(contrast(steps[i]!, steps[i + 1]!)),
        `${steps[i]} vs ${steps[i + 1]}`,
      ).toBeGreaterThanOrEqual(1.25);
    }
  });

  it("the focus ring passes 3:1 on every surface it can land on", () => {
    for (const [name, bg] of [
      ["ground", ground],
      ["surface", surface],
      ["raised", raised],
    ] as const) {
      expect(round(contrast(focus, bg)), `focus on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("control boundaries pass 3:1, and the hairline stays visible but quiet", () => {
    expect(round(contrast(edge, ground)), "edge on ground").toBeGreaterThanOrEqual(3);
    expect(round(contrast(edge, surface)), "edge on surface").toBeGreaterThanOrEqual(3);
    // the hairline is a rule, not a control boundary: it must be seen, not shout
    expect(round(contrast(hairline, ground)), "hairline on ground").toBeGreaterThanOrEqual(1.5);
    expect(round(contrast(hairline, ground)), "hairline on ground").toBeLessThan(
      round(contrast(edge, ground)),
    );
  });

  it("the track's nodes are visible against the ground they sit on", () => {
    expect(round(contrast(ink, ground)), "filled node on ground").toBeGreaterThanOrEqual(3);
  });
});
