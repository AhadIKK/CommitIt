/**
 * Surfaces. Regions separate by a tonal step plus one hairline; there are no
 * cards and no drop shadows anywhere in the product.
 */
import type { ReactNode } from "react";
import { initials, relativeTime } from "../lib/format.js";
import type { LiveStatus } from "../api/client.js";
import { AlertGlyph } from "./glyphs.js";

/* ---------------------------------------------------------------- banner */

export function Banner({
  severity = "info",
  title,
  detail,
  urgent = false,
  actions,
}: {
  severity?: "danger" | "warn" | "info";
  title: string;
  detail?: string;
  /** Only the leaked-secret alert and hard failures interrupt. */
  urgent?: boolean;
  actions?: ReactNode;
}) {
  return (
    <section
      className={`banner banner--${severity}`}
      role={urgent ? "alert" : undefined}
      aria-label={title}
    >
      <span className={`mark mark--${severity === "info" ? "muted" : severity}`}>
        <AlertGlyph size={16} />
        {severity === "danger" ? "Action needed" : severity === "warn" ? "Heads up" : "Note"}
      </span>
      <div className="banner__body">
        <h2 className="banner__title">{title}</h2>
        {detail ? <p className="banner__detail">{detail}</p> : null}
      </div>
      {actions ? <div className="banner__actions">{actions}</div> : null}
    </section>
  );
}

/* ----------------------------------------------------------- state panel */

export function StatePanel({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <p className="state__title">{title}</p>
      {body ? <p className="state__body">{body}</p> : null}
      {action ? <div className="state__action">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- skeleton */

export function Skeleton({
  variant = "line",
  width,
  height,
}: {
  variant?: "line" | "line-sm" | "node" | "display";
  width?: number | string;
  height?: number | string;
}) {
  return (
    <span
      className={`skeleton skeleton--${variant}`}
      aria-hidden="true"
      style={{ width, height, display: "block" }}
    />
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="row" key={i}>
          <Skeleton variant="line-sm" />
          <Skeleton variant="line" width={`${70 - i * 8}%`} />
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- bubble */

export function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="bubble">
      <div className="bubble__body">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- avatar */

export function Avatar({ name, title }: { name: string; title?: string }) {
  return (
    <span className="avatar" title={title ?? name} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/* --------------------------------------------------------------- live bar */

const STATUS_TEXT: Record<LiveStatus, string> = {
  live: "Live",
  polling: "Checking every 30 seconds",
  stale: "Connection dropped, showing the last load",
  offline: "Offline, showing the last load",
};

export function LiveBar({
  status,
  lastUpdated,
  note,
  newActivity,
}: {
  status: LiveStatus;
  lastUpdated: Date;
  note?: string | null;
  newActivity?: string | null;
}) {
  const stale = status === "stale" || status === "offline" || status === "polling";
  const updated = relativeTime(lastUpdated.toISOString());
  return (
    <p className={`live${stale ? " live--stale" : ""}`} role="status">
      <span aria-hidden="true">{stale ? "●" : "○"}</span>
      <span>{newActivity ?? (status === "live" ? `Updated ${updated}` : STATUS_TEXT[status])}</span>
      {note ? <span className="muted">{note}</span> : null}
    </p>
  );
}
