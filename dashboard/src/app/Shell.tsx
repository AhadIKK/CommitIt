/**
 * The app shell. A narrow spine of ledger tabs on the left, a breadcrumb strip
 * across the top, and a persistent pipeline-status line at the foot.
 *
 * No icons: sections are words. The active tab gets a left ink bar and a filled
 * point before its label, which is the same device as the Goal Track and costs
 * no icon set.
 */
import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "../lib/theme.js";

const SECTIONS = [
  { to: "/app", label: "Overview", key: "o" },
  { to: "/app/tasks", label: "Tasks", key: "t" },
  { to: "/app/digests", label: "Digests", key: "d" },
  { to: "/app/alerts", label: "Alerts", key: "a" },
  { to: "/app/chats", label: "Chats", key: "c" },
  { to: "/app/system", label: "Pipeline", key: "y" },
  { to: "/app/security", label: "Safety", key: "f" },
  { to: "/app/settings", label: "Settings", key: "s" },
];

const CRUMB: Record<string, string> = {
  "/app": "Overview",
  "/app/tasks": "Tasks",
  "/app/digests": "Digests",
  "/app/alerts": "Alerts",
  "/app/chats": "Chats",
  "/app/system": "Pipeline",
  "/app/security": "Safety",
  "/app/settings": "Settings",
};

export function AppShell({
  children,
  crumb,
  banner,
}: {
  children: ReactNode;
  crumb?: string;
  banner?: ReactNode;
}) {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();

  // g + key, then "?" for the shortcuts slip.
  useEffect(() => {
    let armed = false;
    let timer: number | undefined;
    function down(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (armed) {
        const hit = SECTIONS.find((s) => s.key === e.key.toLowerCase());
        armed = false;
        window.clearTimeout(timer);
        if (hit) {
          e.preventDefault();
          window.location.assign(hit.to);
        }
        return;
      }
      if (e.key === "g") {
        armed = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => (armed = false), 1200);
      }
    }
    window.addEventListener("keydown", down);
    return () => {
      window.removeEventListener("keydown", down);
      window.clearTimeout(timer);
    };
  }, []);

  const section = CRUMB[pathname] ?? crumb ?? "Workspace";

  return (
    <div className="app-shell">
      <a className="ld-skip" href="#app-main">
        Skip to content
      </a>

      <aside className="spine" aria-label="Sections">
        <NavLink className="spine__mark" to="/" aria-label="CommitIt home">
          Comm<span aria-hidden="true">ı</span>tIt
        </NavLink>
        <nav className="spine__nav">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.to === "/app"}
              className={({ isActive }) => `spine__tab${isActive ? " is-active" : ""}`}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="spine__body">
        <header className="stripbar">
          <span className="stripbar__crumb num">
            Workspace <span className="stripbar__sep">/</span> {section}
          </span>
          <button type="button" className="lookup" onClick={() => window.alert("Look up")}>
            Look up <kbd>⌘K</kbd>
          </button>
          <button
            type="button"
            className="ld-tab"
            onClick={toggle}
            aria-label={`Switch to the ${theme === "night" ? "dark" : "light"} theme`}
          >
            {theme === "night" ? "light" : "dark"}
          </button>
        </header>

        {banner ? <div className="stripbar__banner">{banner}</div> : null}

        <main className="app-main" id="app-main">
          {children}
        </main>

        <footer className="statusline num">
          worker: healthy <span className="statusline__sep">·</span> last digest 14:02{" "}
          <span className="statusline__sep">·</span> queue 0
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------- the four page states */

/** Every route renders these four. A page that skips one is unfinished. */
export function PageState({
  state,
  title,
  error,
  empty,
  onRetry,
}: {
  state: "loading" | "error" | "empty" | "denied" | "ok";
  title: string;
  error?: string | null;
  empty?: { title: string; body: string };
  onRetry?: () => void;
}) {
  if (state === "loading") {
    return (
      <div className="page">
        <h1 className="page__title">{title}</h1>
        <div className="skeleton" role="status" aria-label={`Loading ${title}`}>
          <span className="visually-hidden">Loading {title}.</span>
          {[92, 74, 86, 58, 68].map((w, i) => (
            <span key={i} className="skeleton__row" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="page">
        <h1 className="page__title">{title}</h1>
        <div className="notice notice--err" role="alert">
          <span className="notice__tag num">ERR</span>
          <span className="notice__body">
            <strong className="notice__title">This page did not load.</strong>
            <span className="notice__detail">
              {error ?? "The API did not answer."} Nothing was changed.
            </span>
          </span>
          {onRetry ? (
            <span className="notice__action">
              <button type="button" className="ld-btn ld-btn--primary" onClick={onRetry}>
                Try again
              </button>
            </span>
          ) : null}
        </div>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="page">
        <h1 className="page__title">{title}</h1>
        <div className="notice notice--err" role="alert">
          <span className="notice__tag num">ERR</span>
          <span className="notice__body">
            <strong className="notice__title">Not on your installation.</strong>
            <span className="notice__detail">
              This repository is not in the GitHub App installation for your account, so there is
              nothing to show. Ask an owner to add it.
            </span>
          </span>
        </div>
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="page">
        <h1 className="page__title">{title}</h1>
        <div className="empty">
          <svg className="empty__art" viewBox="0 0 180 24" aria-hidden="true">
            <line x1="4" y1="12" x2="176" y2="12" className="empty__line" />
            <circle cx="18" cy="12" r="4" className="empty__ring" />
            <circle cx="52" cy="12" r="6" className="empty__ring" />
            <circle cx="92" cy="12" r="8.5" className="empty__ring" />
          </svg>
          <p className="empty__title">{empty?.title ?? "Nothing here yet."}</p>
          <p className="empty__body">{empty?.body ?? "It will appear once there is any."}</p>
        </div>
      </div>
    );
  }
  return null;
}

export function PageHeader({
  title,
  lede,
  section,
  children,
}: {
  title: string;
  lede: string;
  section?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      {section ? <p className="margin-note num">§ {section}</p> : null}
      <h1 className="page__title">{title}</h1>
      <p className="page__lede">{lede}</p>
      {children ? <div className="page-head__actions">{children}</div> : null}
    </header>
  );
}
