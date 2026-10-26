import { useEffect, useRef, useState } from "react";

/**
 * True the first time a key is seen in this browser session, false afterwards.
 * The Goal Track's fill is the one orchestrated moment in the product, and it
 * happens once per session — not on every navigation (skill rule 35).
 * sessionStorage only ever holds this boolean; no tokens, no user data.
 */
export function useOncePerSession(key: string): boolean {
  const seen = useRef(false);
  const [first, setFirst] = useState(false);

  useEffect(() => {
    if (seen.current) return;
    seen.current = true;
    let already = false;
    try {
      already = sessionStorage.getItem(key) === "1";
      if (!already) sessionStorage.setItem(key, "1");
    } catch {
      already = false;
    }
    // Reduced motion renders the end state immediately, which is the same mark-up.
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setFirst(!already && !reduced);
  }, [key]);

  return first;
}
