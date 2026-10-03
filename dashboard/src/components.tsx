import type { AuthorStat, DigestEntry, IssueRow, MilestoneSnapshot } from "@src/dashboard.js";
import { avatarCells } from "./avatars.js";
import { StatusIcon } from "./icons.js";

// Chart colors resolve through CSS tokens so light/dark themes apply.

export function Donut({ m }: { m: MilestoneSnapshot }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const filled = (m.percent / 100) * c;
  return (
    <div className="mile">
      <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${m.title} ${m.percent}%`}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--track)" strokeWidth="12" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="12"
          strokeDasharray={`${filled} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
        />
        <text x="48" y="54" textAnchor="middle" fill="var(--text)" fontSize="18" fontFamily="monospace">
          {m.percent}%
        </text>
      </svg>
      <div className="mile-meta">
        <strong>{m.title}</strong>
        <span className="muted">{m.label}</span>
      </div>
    </div>
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
          <p>{d.body.slice(0, 280)}</p>
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
// redundant encoding (ring + big number + text label), never color alone.
export function OverallBand({ m }: { m: MilestoneSnapshot }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const filled = (m.percent / 100) * c;
  return (
    <div className="band">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Overall progress ${m.percent}%`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--track)" strokeWidth="14" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="14"
          strokeDasharray={`${filled} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="80" textAnchor="middle" fill="var(--text)" fontSize="30" fontFamily="monospace">
          {m.percent}%
        </text>
      </svg>
      <div className="band-meta">
        <span className="band-label">Overall progress</span>
        <span className="band-points mono">
          {m.closedPoints}/{m.totalPoints} pts · {m.closed} closed · {m.open} open
        </span>
        {m.label !== "no issues yet" && <span className="muted">{m.label}</span>}
      </div>
    </div>
  );
}
