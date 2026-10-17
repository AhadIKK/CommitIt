/**
 * Brand artwork. The logo is fixed by brief section 3: a chat bubble holding two
 * commit nodes joined by a line, with a small teal dot on the bubble's corner.
 * The geometry below is the supplied master drawing, unmodified — do not
 * recolour, re-proportion or "improve" it.
 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="CommitIt"
      style={{ flexShrink: 0, borderRadius: size * 0.1875 }}
    >
      <rect x="0" y="0" width="512" height="512" rx="96" fill="#1E293B" />
      <rect
        x="112"
        y="128"
        width="288"
        height="192"
        rx="56"
        fill="none"
        stroke="#E2E8F0"
        strokeWidth="32"
      />
      <polygon points="176,320 144,384 224,320" fill="#E2E8F0" />
      <line x1="192" y1="224" x2="320" y2="224" stroke="#E2E8F0" strokeWidth="20" />
      <circle cx="192" cy="224" r="24" fill="#E2E8F0" />
      <circle cx="320" cy="224" r="24" fill="#E2E8F0" />
      <circle cx="392" cy="88" r="30" fill="#14B8A6" />
    </svg>
  );
}

/** The wordmark: CommitIt, Poppins 700, exactly that capitalisation. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={className ?? "rail__word"}>CommitIt</span>;
}

export function BrandLockup({ size = 32, wordClass }: { size?: number; wordClass?: string }) {
  return (
    <>
      <Logo size={size} />
      <Wordmark className={wordClass} />
    </>
  );
}
