import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import type {
  AuthorStat,
  CommitRow,
  DigestEntry,
  IssueRow,
  MilestoneSnapshot,
} from "@src/dashboard.js";
import { avatarCells } from "./avatars.js";
import { StatusIcon } from "./icons.js";
import { parseTelegramHtml, trimSpans } from "./telegramHtml.js";

// The rings are the only chart.js consumers in the app. Loading that module on
// demand keeps the ~138KB chart chunk off first paint — the page paints, then
// the rings swap in. The placeholder is the same size and the track colour, so
// nothing shifts when they arrive.
const LazyRing = lazy(() => import("./ring.js"));

function Ring({ percent, cutout, size }: { percent: number; cutout: string; size: number }) {
  return (
    <Suspense
      fallback={
        <div
          aria-hidden="true"
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "var(--track, #2a3441)",
          }}
        />
      }
    >
      <LazyRing percent={percent} cutout={cutout} />
    </Suspense>
  );
}

// Animated figure to go with the ring (redundant encoding, never color alone).
function CountUp({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <>
      {display}
      {suffix}
    </>
  );
}

export function Donut({ m }: { m: MilestoneSnapshot }) {
  return (
    <motion.div
      className="mile"
      role="img"
      aria-label={`${m.title} ${m.percent}%`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div style={{ width: 96, height: 96 }}>
        <Ring percent={m.percent} cutout="72%" size={96} />
      </div>
      <div className="mile-meta">
        <strong>{m.title}</strong>
        <span className="mono">
          <CountUp value={m.percent} />
        </span>
        <span className="muted">{m.label}</span>
      </div>
    </motion.div>
  );
}

export function AuthorBars({ authors }: { authors: AuthorStat[] }) {
  const max = Math.max(1, ...authors.map((a) => a.commits + a.mergedPRs));
  return (
    <div className="bars">
      {authors.map((a) => (
        <div key={a.login} className="bar-row">
          <Avatar login={a.login} />
          <span className="bar-login">{a.login}</span>
          <div className="bar-track">
            <div className="bar-fill commits" style={{ width: `${(a.commits / max) * 100}%` }} />
            <div className="bar-fill prs" style={{ width: `${(a.mergedPRs / max) * 100}%` }} />
          </div>
          <span className="bar-nums mono">
            {a.commits}c / {a.mergedPRs}pr
          </span>
        </div>
      ))}
      <div className="bars-legend" aria-hidden="true">
        <span className="swatch commits"></span> commits
        <span className="swatch prs"></span> merged PRs
      </div>
      {authors.length === 0 && <p className="muted">No activity in range.</p>}
    </div>
  );
}

// CommitList — "what each commit is about". One row per commit: sha, author,
// date, the subject line, and (when the worker produced one) the short AI
// summary. Metadata only — diffs and file contents are never stored or shown.
export function CommitList({ commits, repo }: { commits: CommitRow[]; repo: string }) {
  if (commits.length === 0) return <p className="muted">No commits in range.</p>;
  return (
    <ul className="commits">
      {commits.map((c) => (
        <li key={c.sha}>
          <div className="commit-head">
            <a
              className="mono commit-sha"
              href={`https://github.com/${repo}/commit/${c.sha}`}
              target="_blank"
              rel="noreferrer"
            >
              {c.shortSha}
            </a>
            <Avatar login={c.author} size={20} />
            <span className="commit-author">{c.author}</span>
            {c.committedAt && (
              <time className="mono muted" dateTime={c.committedAt}>
                {new Date(c.committedAt).toLocaleDateString()}
              </time>
            )}
            {c.branch && <span className="mono muted commit-branch">{c.branch}</span>}
            {c.category && <span className="badge">{c.category}</span>}
            {c.isMerge && <span className="badge">merge</span>}
            {c.issueNumber != null && <span className="badge">#{c.issueNumber}</span>}
            {c.secretFlag && <span className="pill warn">secret flagged</span>}
          </div>
          <p className="commit-subject">{c.subject}</p>
          {c.aiSummary && <p className="commit-ai">{c.aiSummary}</p>}
        </li>
      ))}
    </ul>
  );
}

function weightBadge(w: number): string {
  if (w >= 5) return "L";
  if (w >= 3) return "M";
  return "S";
}

export function IssuesTable({ issues }: { issues: IssueRow[] }) {
  return (
    <table className="issues">
      <thead>
        <tr>
          <th>#</th>
          <th>Title</th>
          <th>Size</th>
          <th>State</th>
          <th>Milestone</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((i) => (
          <tr key={i.number}>
            <td className="mono">#{i.number}</td>
            <td>{i.title}</td>
            <td>
              <span className="badge">{weightBadge(i.weight)}</span>
            </td>
            <td>
              <span className={`pill ${i.state}`}>
                <StatusIcon status={i.state} />
                {i.state}
              </span>
            </td>
            <td>{i.milestone ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Digest bodies are Telegram parse-mode HTML (see telegramHtml.ts). Rendering
 * one as a text child printed literal "<b>repo</b>"; rendering it as HTML
 * would need dangerouslySetInnerHTML on stored content. Map the safe subset to
 * React nodes instead — no injected markup, nothing to sanitise later.
 */
function TgBody({ body, max }: { body: string; max: number }) {
  return (
    <>
      {trimSpans(parseTelegramHtml(body), max).map((s, i) => {
        let node: ReactNode = s.text;
        if (s.code) node = <code>{node}</code>;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong>{node}</strong>;
        if (s.href && /^https?:\/\//i.test(s.href)) {
          node = (
            <a href={s.href} target="_blank" rel="noreferrer">
              {node}
            </a>
          );
        }
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

export function DigestTimeline({ digests }: { digests: DigestEntry[] }) {
  if (digests.length === 0) return <p className="muted">No digests yet.</p>;
  return (
    <ul className="timeline">
      {digests.map((d) => (
        <li key={d.id}>
          <span className="mono muted">{new Date(d.createdAt).toLocaleString()}</span>
          <span className={`pill ${d.status}`}>
            <StatusIcon status={d.status} />
            {d.status}
          </span>
          <span className="mono muted">[{d.type}]</span>
          <p className="digest-body">
            <TgBody body={d.body} max={280} />
          </p>
        </li>
      ))}
    </ul>
  );
}

// Avatar — seeded identicon for an author login. Decorative (aria-hidden);
// the adjacent login text carries the identity for screen readers.
export function Avatar({ login, size = 28 }: { login: string; size?: number }) {
  const cells = avatarCells(login);
  const n = 5;
  const u = 100 / n;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="avatar"
    >
      <rect width="100" height="100" fill="var(--track)" />
      {cells.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={(i % n) * u}
            y={Math.floor(i / n) * u}
            width={u}
            height={u}
            fill="var(--accent)"
          />
        ) : null,
      )}
    </svg>
  );
}

// OverallBand — the memorable element: one large progress figure with
// redundant encoding (ring + animated number + text label), never color alone.
export function OverallBand({ m }: { m: MilestoneSnapshot }) {
  return (
    <motion.div
      className="band"
      role="img"
      aria-label={`Overall progress ${m.percent}%`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
    >
      <div style={{ width: 140, height: 140 }}>
        <Ring percent={m.percent} cutout="70%" size={140} />
      </div>
      <div className="band-meta">
        <span className="band-label">Overall progress</span>
        <span className="band-points mono">
          <CountUp value={m.percent} /> · {m.closedPoints}/{m.totalPoints} pts · {m.closed} closed · {m.open} open
        </span>
        {m.label !== "no issues yet" && <span className="muted">{m.label}</span>}
      </div>
    </motion.div>
  );
}
