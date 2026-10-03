// Logo — concept 2 "chat" mark (user-designed artwork, 2026-10-03).
// Inline SVG keeps the header crisp at any size with zero requests.
// Do not recolor: brand artwork stays exactly as supplied.
export default function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="CommitIt logo"
      style={{ flexShrink: 0, borderRadius: 8 }}
    >
      <rect x="0" y="0" width="512" height="512" rx="96" fill="#1E293B" />
      <rect x="112" y="128" width="288" height="192" rx="56" fill="none" stroke="#E2E8F0" strokeWidth="32" />
      <polygon points="176,320 144,384 224,320" fill="#E2E8F0" />
      <line x1="192" y1="224" x2="320" y2="224" stroke="#E2E8F0" strokeWidth="20" />
      <circle cx="192" cy="224" r="24" fill="#E2E8F0" />
      <circle cx="320" cy="224" r="24" fill="#E2E8F0" />
      <circle cx="392" cy="88" r="30" fill="#14B8A6" />
    </svg>
  );
}
