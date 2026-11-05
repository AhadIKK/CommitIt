/**
 * Theme. The value is applied before first paint by the inline script in
 * index.html (which follows prefers-color-scheme and defers to a saved choice),
 * so there is no flash and no layout shift. This module keeps state in sync and
 * writes only one thing to storage: the theme name.
 */
import { useCallback, useEffect, useState } from "react";

export type ThemeName = "night" | "day";
export type ThemeMode = "system" | "day" | "night";

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
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = savedTheme();
    return saved ? saved : "system";
  });
  const [theme, setTheme] = useState<ThemeName>(appliedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // While in system mode, keep following the system media query.
  useEffect(() => {
    if (mode !== "system") return;
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setTheme(mq.matches ? "day" : "night");
    setTheme(mq.matches ? "day" : "night");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const set = useCallback((next: ThemeName) => {
    setMode(next);
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
  }, []);

  const useSystem = useCallback(() => {
    setMode("system");
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
    setTheme(systemTheme());
  }, []);

  // 3-way cycle: system -> day -> night -> system
  const cycle = useCallback(() => {
    if (mode === "system") {
      set("day");
    } else if (mode === "day") {
      set("night");
    } else {
      useSystem();
    }
  }, [mode, set, useSystem]);

  const toggle = cycle;
  const overridden = mode !== "system";

  return { theme, mode, cycle, toggle, set, useSystem, overridden };
}
