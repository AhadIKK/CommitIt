/**
 * Theme. The value is applied before first paint by the inline script in
 * index.html (which follows prefers-color-scheme and defers to a saved choice),
 * so there is no flash and no layout shift. This module keeps state in sync and
 * writes only one thing to storage: the theme name.
 */
import { useCallback, useEffect, useState } from "react";

export type ThemeName = "night" | "day";

const KEY = "commitit-theme";

function systemTheme(): ThemeName {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "night";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
}

function savedTheme(): ThemeName | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "night" || v === "day" ? v : null;
  } catch {
    return null;
  }
}

function appliedTheme(): ThemeName {
  const attr = typeof document === "undefined" ? null : document.documentElement.dataset.theme;
  if (attr === "night" || attr === "day") return attr;
  return savedTheme() ?? systemTheme();
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(appliedTheme);
  const [overridden, setOverridden] = useState<boolean>(() => savedTheme() !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // While the person has not made a choice, keep following the system.
  useEffect(() => {
    if (overridden) return;
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setTheme(mq.matches ? "day" : "night");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [overridden]);

  const set = useCallback((next: ThemeName) => {
    setTheme(next);
    setOverridden(true);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
  }, []);

  const toggle = useCallback(() => set(theme === "night" ? "day" : "night"), [theme, set]);

  const useSystem = useCallback(() => {
    setOverridden(false);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
    setTheme(systemTheme());
  }, []);

  return { theme, toggle, set, useSystem, overridden };
}
