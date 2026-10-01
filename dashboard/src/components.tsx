import type { AuthorStat, DigestEntry, IssueRow, MilestoneSnapshot } from "@src/dashboard.js";

const BLUE = "#1F6FEB";
const GREEN = "#1A7F37";
const RED = "#CF222E";
const AMBER = "#9A6700";
const TRACK = "#2A3441";

export function Donut({ m }: { m: MilestoneSnapshot }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const filled = (m.percent / 100) * c;
  return (
    <div className="mile">
      <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${m.title} ${m.percent}%`}>
        <circle cx="48" cy="48" r={r} fill="none" stroke={TRACK} strokeWidth="12" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={BLUE}
          strokeWidth="12"
          strokeDasharray={`${filled} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
        />
        <text x="48" y="54" textAnchor="middle" fill="#fff" fontSize="18" fontFamily="monospace">
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
              <span className={`pill ${i.state}`}>{i.state}</span>
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
          <span className={`pill ${d.status}`}>{d.status}</span>
          <span className="mono muted">[{d.type}]</span>
          <p>{d.body.slice(0, 280)}</p>
        </li>
      ))}
    </ul>
  );
}

export { AMBER, BLUE, GREEN, RED };
