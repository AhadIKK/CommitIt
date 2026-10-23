/**
 * Glyphs. One family, one stroke width, one fill discipline: every mark is drawn
 * on a 14-unit grid with a 1.6 stroke, so nothing looks pasted in from another
 * set. Each is decorative — the word beside it carries the meaning, so a colour
 * is never the only signal (skill rule 4).
 */
import type { Alert, CommitCategory } from "../api/types.js";

type GlyphProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 14 14",
  fill: "none" as const,
  stroke: "currentColor" as const,
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  focusable: "false" as const,
});

const CATEGORY_LABEL: Record<CommitCategory, string> = {
  feat: "feat",
  fix: "fix",
  docs: "docs",
  refactor: "refactor",
  test: "test",
  chore: "chore",
  other: "other",
};

export function categoryLabel(category: CommitCategory): string {
  return CATEGORY_LABEL[category] ?? "other";
}

/** One glyph per commit category, built from the node-and-line motif. */
export function CategoryGlyph({ category, size = 14 }: GlyphProps & { category: CommitCategory }) {
  const p = base(size);
  switch (category) {
    case "feat": // a node arriving on the line
      return (
        <svg {...p}>
          <line x1="0.8" y1="7" x2="3.6" y2="7" />
          <circle cx="8.4" cy="7" r="3.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "fix": // a node being patched
      return (
        <svg {...p}>
          <circle cx="7" cy="7" r="4.3" />
          <line x1="7" y1="4.4" x2="7" y2="9.6" />
        </svg>
      );
    case "docs": // a page
      return (
        <svg {...p}>
          <path d="M2.8 2.4h5.4l3 3v6.2H2.8z" />
          <line x1="4.9" y1="7.4" x2="9.1" y2="7.4" />
          <line x1="4.9" y1="9.4" x2="7.6" y2="9.4" />
        </svg>
      );
    case "refactor": // the line changes route
      return (
        <svg {...p}>
          <circle cx="3.2" cy="3.8" r="1.7" />
          <circle cx="10.8" cy="10.2" r="1.7" />
          <path d="M3.2 5.9v2.2a2 2 0 0 0 2 2h3.5" />
        </svg>
      );
    case "test": // a node confirmed
      return (
        <svg {...p}>
          <circle cx="7" cy="7" r="4.4" />
          <path d="M4.9 7.2l1.6 1.6 2.7-3.2" />
        </svg>
      );
    case "chore": // a plain block of upkeep
      return (
        <svg {...p}>
          <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1" />
        </svg>
      );
    default: // unknown, drawn as an open dashed node
      return (
        <svg {...p}>
          <circle cx="7" cy="7" r="4.4" strokeDasharray="2 1.8" />
        </svg>
      );
  }
}

const SEVERITY_WORD: Record<Alert["kind"], string> = {
  secret: "Secret",
  build_failed: "Build",
  force_push: "Force-push",
  direct_push: "Direct push",
  stale_branch: "Stale",
  inactivity: "Quiet",
};

export function alertKindWord(kind: Alert["kind"]): string {
  return SEVERITY_WORD[kind];
}

/** A node with a warning flag: used for every alert kind, distinguishable by
 *  shape, so two alerts of different severity never read the same. */
export function AlertGlyph({ size = 16 }: GlyphProps) {
  return (
    <svg {...base(size)}>
      <circle cx="7" cy="7" r="4.6" />
      <line x1="7" y1="4.3" x2="7" y2="7.4" />
      <circle cx="7" cy="9.5" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The brand's notification dot, for "new since you last looked". */
export function SignalDot({ size = 8 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <circle cx="4" cy="4" r="4" fill="var(--signal)" />
    </svg>
  );
}
