/**
 * Public and legal routes. Same ledger language, same rules: no cards, no
 * icons, signal used at most once. Legal copy is plain and specific rather
 * than defensive — if a clause cannot be explained in a sentence it does not
 * belong here.
 */
import { Link } from "react-router-dom";
import { Entry, Slip, Stamp } from "../components/kit.js";
import { NotFound } from "./Settings.js";

/* ------------------------------------------------------------ /onboarding */

const STEPS = [
  {
    n: "01",
    t: "Connect GitHub",
    b: "Install the CommitIt App. It reads repository metadata, contents (to scan before summarising), pull requests and checks. It never asks for write access to your code.",
  },
  {
    n: "02",
    t: "Pick a Telegram chat",
    b: "Add the bot to a group or DM. The bot verifies its own identity before the first digest. Until then, digests are held, not lost.",
  },
  {
    n: "03",
    t: "Choose what counts",
    b: "Every task carries a size — S, M or L — worth 1, 3 or 5 points. The scale is fixed. A team that can tune its own scale will tune it until the number means nothing.",
  },
  {
    n: "04",
    t: "Watch the track fill",
    b: "The headline is finished points. Commits appear underneath, labelled as activity. If a task reopens after you merged it, the track drags back and the points are returned.",
  },
];

export function Onboarding() {
  return (
    <div className="public">
      <div className="page">
        <h1 className="ld-display">Four steps, then it runs itself.</h1>
        <p className="ld-lede ld-pencil">
          <em>No card to pick a plan. No trial that expires.</em> This is the whole setup.
        </p>

        <ol className="stages" style={{ listStyle: "none" }}>
          {STEPS.map((s) => (
            <li className="stages__item" key={s.n}>
              <span className="stages__tick" style={{ width: "0px" }} aria-hidden="true" />
              <span className="num" style={{ fontSize: "12px", color: "var(--muted)" }}>{s.n}</span>
              <span />
              <span style={{ gridColumn: "2 / -1" }}>
                <strong style={{ display: "block" }}>{s.t}</strong>
                <span style={{ color: "var(--muted)", fontSize: "13.5px" }}>{s.b}</span>
              </span>
            </li>
          ))}
        </ol>

        <p>
          <a className="ld-btn ld-btn--primary" href="/app">
            Start with GitHub
          </a>
        </p>
        <p className="margin-note">
          Already set up? <Link to="/app">Go to the overview.</Link>
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- /terms, /privacy */

export function Terms() {
  return (
    <div className="public">
      <div className="page">
        <h1 className="ld-display">Terms</h1>
        <p className="margin-note num">Last revised 18 October 2026</p>
        <div className="entries">
          <Entry label="What CommitIt does" control={<span>Reports finished, weighted work.</span>} />
          <Entry label="What it reads" control={<span>Repo metadata, contents, PRs, checks — read-only.</span>} />
          <Entry label="What it never asks for" control={<span>Write access to your code.</span>} />
          <Entry label="Uptime" control={<span>Best-effort. Queue retries, no SLA.</span>} />
          <Entry label="Termination" control={<span>Void your workspace at any time. Your GitHub installation is untouched.</span>} />
        </div>
      </div>
    </div>
  );
}

export function Privacy() {
  return (
    <div className="public">
      <div className="page">
        <h1 className="ld-display">Privacy</h1>
        <p className="margin-note num">Last revised 18 October 2026</p>
        <div className="entries">
          <Entry label="What is stored" control={<span>Metadata and short summaries. Never source code.</span>} />
          <Entry label="Secret handling" control={<span>Findings expose path, rule and commit only. The value is never stored or logged.</span>} />
          <Entry label="Who can read your data" control={<span>You, and the owner of the workspace. Nobody else.</span>} />
          <Entry label="Retention" control={<span>Webhook payloads: 30 days by default. Everything else: until you void it.</span>} />
          <Entry label="Deletion" control={<span>Settings → Danger zone. Immediate and irreversible.</span>} />
        </div>
        <p className="margin-note">
          Questions go to <span className="path">privacy@commitit.dev</span>.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- /changelog */

const RELEASES = [
  {
    v: "0.9.0",
    date: "18 Oct 2026",
    items: [
      "Goal Track reveal is now the only GSAP moment in the app.",
      "Reopened tasks retract the track and return their points.",
      "Digests are collapsible and remember their state per chat.",
    ],
  },
  {
    v: "0.8.2",
    date: "02 Oct 2026",
    items: ["Secret findings expose path and rule, never the value.", "Scan now runs before every model call, not after."],
  },
  {
    v: "0.8.0",
    date: "21 Sep 2026",
    items: ["Task weights fixed at S=1, M=3, L=5.", "Milestone progress recomputed from source on reopen."],
  },
];

export function Changelog() {
  return (
    <div className="public">
      <div className="page">
        <h1 className="ld-display">Changelog</h1>
        <p className="ld-lede ld-pencil">
          <em>What changed, and when.</em> Kept short on purpose.
        </p>
        {RELEASES.map((r) => (
          <section key={r.v} className="grouped">
            <h2 className="grouped__title">
              {r.v} <span style={{ color: "var(--muted)" }}>· {r.date}</span>
            </h2>
            <ul className="ticks" style={{ listStyle: "none" }}>
              {r.items.map((i) => (
                <li key={i} style={{ display: "flex", gap: "8px", alignItems: "baseline", padding: "3px 0" }}>
                  <span className="stages__tick" style={{ position: "static" }} aria-hidden="true" />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ /docs */

export function Docs() {
  return (
    <div className="public">
      <div className="page">
        <h1 className="ld-display">Docs</h1>
        <p className="ld-lede ld-pencil">
          <em>How the number is made.</em> Four short pages.
        </p>
        <div className="entries">
          <Entry
            label="The scale"
            control={<span>S=1 · M=3 · L=5. Fixed. Not configurable.</span>}
          />
          <Entry
            label="Why reopened work counts backwards"
            control={<span>A merge that gets reverted was never finished. The track shows that honestly.</span>}
          />
          <Entry
            label="Why commits are called activity"
            control={<span>Commit volume measures typing, not delivery. It is shown, and labelled, never scored.</span>}
          />
          <Entry
            label="Why secrets never reach a model"
            control={<span>Scan runs before summarise. A flagged file is skipped entirely.</span>}
          />
        </div>
        <Slip title="principle">
          <p className="slip-line">
            A progress number is a claim. If it cannot be defended line by line, it is decoration.
          </p>
        </Slip>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ /error (route error) */

export function RouteError({ reset }: { reset?: () => void }) {
  return (
    <div className="public">
      <div className="page">
        <h1 className="ld-display">Something tore.</h1>
        <p className="ld-body ld-pencil">
          <em>This page failed to render.</em> Nothing was changed, and no digest was lost. Your work
          is still on the books.
        </p>
        <p className="row-controls">
          <button type="button" className="ld-btn ld-btn--primary" onClick={() => reset?.()}>
            Try again
          </button>
          <Link className="ld-btn" to="/app">
            Back to overview
          </Link>
        </p>
      </div>
    </div>
  );
}

export { NotFound, Stamp };