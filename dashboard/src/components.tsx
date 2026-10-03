import { useEffect, useState } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, type ChartOptions } from "chart.js";
import { animate, motion, useReducedMotion } from "framer-motion";
import { Doughnut } from "react-chartjs-2";
import type { AuthorStat, DigestEntry, IssueRow, MilestoneSnapshot } from "@src/dashboard.js";
import { avatarCells } from "./avatars.js";
import { StatusIcon } from "./icons.js";

ChartJS.register(ArcElement, Tooltip);

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

function doughnutOptions(cutout: string, reduce: boolean): ChartOptions<"doughnut"> {
  return {
    cutout,
    responsive: true,
    maintainAspectRatio: true,
    animation: reduce ? false : { duration: 800 },
    plugins: { legend: { display: false } },
  };
}

function doughnutData(percent: number, accent: string, track: string) {
  return {
    labels: ["Closed", "Open"],
    datasets: [
      {
        data: [percent, Math.max(0, 100 - percent)],
        backgroundColor: [accent, track],
        borderWidth: 0,
        hoverOffset: 0,
      },
    ],
  };
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
  const reduce = useReducedMotion() ?? false;
  const accent = cssVar("--accent", "#1f6feb");
  const track = cssVar("--track", "#2a3441");
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
        <Doughnut data={doughnutData(m.percent, accent, track)} options={doughnutOptions("72%", reduce)} />
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
// redundant encoding (ring + animated number + text label), never color alone.
export function OverallBand({ m }: { m: MilestoneSnapshot }) {
  const reduce = useReducedMotion() ?? false;
  const accent = cssVar("--accent", "#1f6feb");
  const track = cssVar("--track", "#2a3441");
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
        <Doughnut data={doughnutData(m.percent, accent, track)} options={doughnutOptions("70%", reduce)} />
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
