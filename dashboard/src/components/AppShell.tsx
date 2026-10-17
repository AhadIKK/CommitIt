/**
 * The frame. Mobile first: a 56px strip, one column, a 4-item bottom tab bar.
 * From 60rem: a 240px rail whose right edge is the same hairline that runs
 * through the content, and no top bar at all — so on desktop there is nothing
 * sticky that could ever obscure a focused control.
 */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Activity, AlertTriangle, MessageSquare, Moon, Settings2, Sun, Target, Users } from "lucide-react";
import type { Repo } from "../api/types.js";
import { Logo } from "./brand.js";
import { SignalDot } from "./glyphs.js";
import { IconButton } from "./controls.js";
import { useTheme } from "../lib/theme.js";

type NavItem = { to: string; label: string; Icon: typeof Activity };

const NAV: NavItem[] = [
  { to: "/today", label: "Today", Icon: Activity },
  { to: "/goals", label: "Goals", Icon: Target },
  { to: "/people", label: "People", Icon: Users },
  { to: "/digests", label: "Digests", Icon: MessageSquare },
  { to: "/alerts", label: "Alerts", Icon: AlertTriangle },
  { to: "/repos", label: "Repos", Icon: Settings2 },
];

/** Four tabs, never more, each with an icon and a word (skill rule 46). */
const TABS = NAV.slice(0, 4);

function RepoSwitcher({
  repoRef,
  repos,
  onChange,
  compact = false,
}: {
  repoRef: string;
  repos: Repo[];
  onChange: (next: string) => void;
  compact?: boolean;
}) {
  const id = compact ? "repo-strip" : "repo-rail";
  return (
    <div className={compact ? "strip__switcher" : "rail__switcher"}>
      <label className="field__label visually-hidden" htmlFor={id}>
        Repository
      </label>
      <select
        id={id}
        className={compact ? "field__select field__select--strip" : "field__select"}
        value={repoRef}
        onChange={(e) => onChange(e.target.value)}
      >
        {repos.length === 0 ? <option value={repoRef}>{repoRef}</option> : null}
        {repos.map((r) => (
          <option key={r.id} value={r.fullName}>
            {r.fullName}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AppShell({
  children,
  repoRef,
  repos,
  onRepoChange,
  alertCount,
  hasNew,
}: {
  children: ReactNode;
  repoRef: string;
  repos: Repo[];
  onRepoChange: (next: string) => void;
  alertCount: number;
  hasNew: boolean;
}) {
  const { theme, toggle, useSystem, overridden } = useTheme();
  const nextLabel = theme === "night" ? "Switch to the day theme" : "Switch to the night theme";
  const ThemeIcon = theme === "night" ? Moon : Sun;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="strip">
        <span className="strip__brand">
          <Logo size={24} />
          <span className="strip__word">CommitIt</span>
        </span>
        <RepoSwitcher repoRef={repoRef} repos={repos} onChange={onRepoChange} compact />
        <span className="strip__spacer" />
        {hasNew ? (
          <span className="is-new">
            <SignalDot />
            New
          </span>
        ) : null}
        <IconButton label={nextLabel} onClick={toggle}>
          <ThemeIcon size={18} strokeWidth={1.6} aria-hidden="true" />
        </IconButton>
      </header>

      <aside className="rail">
        <div className="rail__brand">
          <Logo size={32} />
          <span className="rail__word">CommitIt</span>
        </div>
        <RepoSwitcher repoRef={repoRef} repos={repos} onChange={onRepoChange} />
        <nav className="rail__nav" aria-label="Repository">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={{ pathname: to, search: `?repo=${encodeURIComponent(repoRef)}` }} className="nav__item">
              <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
              {label}
              {label === "Alerts" && alertCount > 0 ? (
                <span className="nav__count">
                  {alertCount}{" "}
                  <span className="visually-hidden">
                    {alertCount === 1 ? "alert needs attention" : "alerts need attention"}
                  </span>
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="rail__foot">
          <IconButton label={nextLabel} onClick={toggle}>
            <ThemeIcon size={18} strokeWidth={1.6} aria-hidden="true" />
          </IconButton>
          {overridden ? (
            <button type="button" className="btn btn--inline" onClick={useSystem}>
              Follow system
            </button>
          ) : (
            <span className="micro muted">Following system</span>
          )}
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        {children}
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={{ pathname: to, search: `?repo=${encodeURIComponent(repoRef)}` }}
            className="tab"
          >
            <span className="tab__mark" aria-hidden="true" />
            <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
