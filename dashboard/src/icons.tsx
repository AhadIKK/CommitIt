// Status glyphs (design skill, icon guidance): hand-authored inline SVG,
// currentColor so they inherit pill text color. Decorative (aria-hidden);
// the adjacent state text carries meaning for screen readers.
import type { ReactNode } from "react";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

function CheckGlyph() {
  return (
    <Glyph>
      <path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Glyph>
  );
}

function CrossGlyph() {
  return (
    <Glyph>
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Glyph>
  );
}

function AlertGlyph() {
  return (
    <Glyph>
      <path d="M6 1.5 11 10H1L6 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 4.5v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="8.6" r="0.8" fill="currentColor" />
    </Glyph>
  );
}

function DotGlyph() {
  return (
    <Glyph>
      <circle cx="6" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.8" />
    </Glyph>
  );
}

export function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "closed":
    case "sent":
      return <CheckGlyph />;
    case "failed":
      return <CrossGlyph />;
    case "skipped_quiet_hours":
      return <AlertGlyph />;
    default:
      return <DotGlyph />;
  }
}
