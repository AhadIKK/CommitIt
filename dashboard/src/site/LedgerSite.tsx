/**
 * The marketing site. One scroll, an auditor's ledger, and a live Goal Track.
 *
 * The voice is the product's: deadpan, specific, concrete numbers over
 * adjectives. Every figure on this page is computed from seed.ts. Commits are
 * labelled "activity" everywhere they appear, and never once rendered as a
 * measure of progress.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { GoalTrackSVG } from "./GoalTrackSVG.js";
import {
  COMMIT_COUNT,
  PIPELINE,
  RAW_COMMITS,
  TASKS,
  WEIGHT_POINTS,
  closingOrder,
  radiusFor,
  totals,
  type Weight,
} from "./seed.js";

gsap.registerPlugin(useGSAP);

const STATION_COPY: Record<string, string> = {
  webhook: "GitHub posts the event. We read the raw bytes and nothing else yet.",
  "hmac verify": "X-Hub-Signature-256 is checked against the shared secret before anything is parsed. A mismatch is a 401 and no work.",
  "rate limit": "The endpoint is rate limited per address, so a burst of deliveries cannot become a burst of work.",
  "idempotent enqueue": "The delivery id is inserted before processing. The same delivery twice is the same row twice, never two jobs.",
  worker: "A Postgres-backed queue, claimed with SKIP LOCKED. No Redis, because nobody measured a need for it.",
  scan: "Every commit is scanned for credentials before any model is asked to summarise it. This runs first, always.",
  trim: "The diff is capped at 8KB and 200 lines. Lockfiles, binaries and vendor directories are skipped outright.",
  classify: "A conventional-commit prefix if there is one, a keyword heuristic if there is not.",
  summarize: "A short summary, cached by commit SHA. On timeout it degrades to the raw message rather than blocking.",
  link: "Closes #N wins, then #N or the branch, then the PR, then a suggestion that is never applied on its own.",
  telegram: "One message per digest, per subscription, honouring the cadence and the quiet hours.",
};

const SLIPS = [
  { h: "PR merged", p: "squura/chore: drop the old route · merged, PR #50", code: "" },
  { h: "CI failed", p: "build #1142 failed on main · 2 hours ago", code: "" },
  { h: "Stale branch", p: "feat/session-store, no activity 11d", code: "" },
  { h: "Force-push", p: "main rewritten · excluded from activity", code: "" },
];

const CADENCES = [
  { id: "instant", label: "instant", n: "11 messages" },
  { id: "hourly", label: "hourly", n: "3 messages" },
  { id: "daily", label: "daily", n: "1 message" },
] as const;

function reduced(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function LedgerSite() {
  const [scheme, setScheme] = useState<"auto" | "light" | "dark">("auto");
  const [station, setStation] = useState(PIPELINE[0]!.label);
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]["id"]>("daily");
  const [replay, setReplay] = useState(0);
  const collapse = useRef<HTMLDivElement>(null);
  const t = totals(TASKS, COMMIT_COUNT);
  const ordered = closingOrder(TASKS);

  useGSAP(
    () => {
      if (reduced()) return;
      const root = collapse.current;
      if (!root) return;
      const list = root.querySelector<HTMLElement>("[data-raw]");
      const bubble = root.querySelector<HTMLElement>("[data-bubble]");
      if (!list || !bubble) return;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: "top 78%",
          end: "bottom 62%",
          scrub: 0.6,
        },
        defaults: { ease: "none" },
      });
      // The noise physically compresses into the signal: the raw list is
      // squeezed and faded out as the message it becomes takes its place.
      tl.fromTo(list, { height: "auto", opacity: 1 }, { height: 34, opacity: 0.25, duration: 1 }, 0);
      tl.fromTo(bubble, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 1 }, 0.15);
    },
    { scope: collapse },
  );

  const resolved = scheme === "auto" ? undefined : scheme;

  return (
    <div className="ledger" data-scheme={resolved}>
      <a className="ld-skip" href="#main">
        Skip to content
      </a>

      <header className="ld-header">
        <div className="ld-header__inner">
          <a className="ld-wordmark" href="#top" aria-label="CommitIt">
            <span aria-hidden="true">
              CommıtIt
            </span>
          </a>
          <nav className="ld-nav" aria-label="Sections">
            <a href="#argument">Argument</a>
            <a href="#how">How it works</a>
            <a href="#digest">Digests</a>
            <a href="#safety">Safety</a>
            <a href="#demo">Live demo</a>
          </nav>
          <button
            type="button"
            className="ld-tab"
            onClick={() =>
              setScheme(scheme === "dark" ? "light" : scheme === "light" ? "auto" : "dark")
            }
          >
            {scheme === "auto" ? "auto" : scheme}
          </button>
          <span className="ld-header__cta">
            <Link className="ld-btn ld-btn--primary" to="/connect/github">
              Connect a repo
            </Link>
          </span>
        </div>
      </header>

      <div className="ledger__grid" id="top">
        <div />

        <div className="ledger__main" id="main">
          {/* 1 — HERO ------------------------------------------------------ */}
          <section>
            <p className="margin-note">fig. 1</p>
            <h1 className="ld-display">
              Commits are not{" "}
              <br />
              progress.
            </h1>
            <p className="ld-lede ld-pencil">
              <em>Finished work, weighted.</em> That is the only number we send.
            </p>

            <GoalTrackSVG tasks={TASKS} commitCount={COMMIT_COUNT} replayKey={replay} />

            <p className="ld-body ld-pencil">
              A six-hundred-line refactor is one commit and finishes nothing. Ten typo fixes are ten
              commits and are worth zero points. The track counts the second kind of thing only, and
              it recomputes from source whenever a task closes, reopens or merges.
            </p>
            <p>
              <button type="button" className="ld-btn ld-btn--mono" onClick={() => setReplay(replay + 1)}>
                ▶ replay closing order
              </button>
            </p>
          </section>

          {/* 2 — THE ARGUMENT --------------------------------------------- */}
          <section id="argument">
            <p className="margin-note">§ 1</p>
            <h2 className="ld-h2">Two numbers, and they disagree.</h2>
            <p className="ld-body">
              Activity and progress are different quantities, and a commit count is an activity
              measurement wearing a progress costume. A six-hundred-line refactor lands as one commit
              and finishes nothing. Ten typo fixes land as ten commits and are worth zero points. Only
              the second column is a measure of the work.
            </p>

            <div className="vs">
              <div className="vs__col vs__col--activity">
                <h3>Activity</h3>
                <p className="vs__big num">{COMMIT_COUNT}</p>
                <p className="vs__note">commits since the milestone opened. Last touched 2h ago.</p>
                <ul className="ticks ticks--heavy" aria-hidden="true">
                  {RAW_COMMITS.slice(0, 9).map((line, i) => (
                    <li key={i} style={{ ["--w" as string]: `${28 + ((i * 37) % 58)}%` }} />
                  ))}
                </ul>
              </div>

              <div className="vs__col vs__col--progress">
                <h3>Progress</h3>
                <p className="vs__big num">
                  {t.closedPoints} / {t.totalPoints}
                </p>
                <p className="vs__note">
                  points, from finished tasks only. Weighted, and recomputed from source on every close,
                  reopen and merge.
                </p>
                <WeightKey />
              </div>
            </div>
          </section>

          {/* 3 — HOW IT WORKS --------------------------------------------- */}
          <section id="how">
            <p className="margin-note">§ 3</p>
            <h2 className="ld-h2">Eleven stations, in order, every time.</h2>
            <ol className="lineup">
              {PIPELINE.map((p) => (
                <li key={p.label} data-note={p.note}>
                  <button
                    type="button"
                    aria-current={station === p.label}
                    onMouseEnter={() => setStation(p.label)}
                    onFocus={() => setStation(p.label)}
                    onClick={() => setStation(p.label)}
                  >
                    {p.label}
                  </button>
                </li>
              ))}
            </ol>
            <p className="lineup__say">{STATION_COPY[station]}</p>
          </section>

          {/* 4 — THE DIGEST ------------------------------------------------ */}
          <section id="digest">
            <p className="margin-note">§ 4</p>
            <h2 className="ld-h2">Forty lines become three.</h2>
            <p className="ld-body">
              A day of raw commits, and the one message they collapse into. Scroll, or read it: the
              message says what was finished, what moved, and what needs a decision. Nothing else.
            </p>

            <div ref={collapse} className="ld-digestwrap">
              <div className="rawlist" data-raw>
                <ul>
                  {RAW_COMMITS.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="demo__digest" data-bubble>
                <div className="bubble-l">
                  <header>
                    syncurateam/syncura · daily digest · 09:00
                  </header>
                  <p>
                    Auth is 62% done: 8 of 13 points, due in 6 days.
                  </p>
                  <dl>
                    <dt>Finished</dt>
                    <dd>Rate limit the webhook (+1), Refresh tokens without a silent logout (+3).</dd>
                    <dt>Moved</dt>
                    <dd>
                      11 commits, 4 of them unlinked to a task. Activity, not progress.
                    </dd>
                    <dt>Needs a decision</dt>
                    <dd>
                      Task 17 was reopened after merge. It is worth 5 points and is now open again.
                    </dd>
                  </dl>
                  <p>
                    <span className="stamp">finished</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="slips">
              {SLIPS.map((s) => (
                <article className="slip" key={s.h}>
                  <h4>{s.h}</h4>
                  <p>{s.p}</p>
                </article>
              ))}
            </div>
          </section>

          {/* 5 — NOISE CONTROL --------------------------------------------- */}
          <section id="noise">
            <p className="margin-note">§ 5</p>
            <h2 className="ld-h2">Loud by default is a choice, not a setting.</h2>

            <div className="specimens">
              <div className="specimen">
                <h4>Digest cadence</h4>
                <div className="ld-btnrow">
                  {CADENCES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="ld-btn ld-btn--mono"
                      aria-pressed={cadence === c.id}
                      onClick={() => setCadence(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="vs__note">
                  {CADENCES.find((c) => c.id === cadence)?.n} per day, per subscribed chat.
                </p>
              </div>

              <div className="specimen">
                <h4>Quiet hours</h4>
                <div className="qstrip">
                  <span className="qstrip__window" aria-hidden="true" />
                  <span className="qstrip__tick" style={{ left: "58%" }} aria-hidden="true" />
                </div>
                <div className="qstrip__axis">
                  <span>00:00</span>
                  <span>12:00</span>
                  <span>23:00</span>
                </div>
                <p className="vs__note">
                  The tick falls inside the window and is held until it opens. Rescheduled, never
                  dropped.
                </p>
              </div>

              <div className="specimen">
                <h4>Per chat × repo</h4>
                <div className="prefgrid" role="img" aria-label="Preferences are stored per chat and repository">
                  <span>syncura · team</span>
                  <span className="on" />
                  <span className="off" />
                  <span>syncura · dm</span>
                  <span className="off" />
                  <span className="on" />
                  <span>other · team</span>
                  <span className="off" />
                  <span className="off" />
                </div>
                <p className="vs__note">
                  Cadence, quiet hours and filters live on the subscription, not on the person. A group
                  and a direct message can want different things.
                </p>
              </div>
            </div>
          </section>

          {/* 6 — SAFETY ---------------------------------------------------- */}
          <section id="safety">
            <p className="margin-note">§ 7</p>
            <h2 className="ld-h2">The file is named. The value is not shown.</h2>
            <p className="ld-body">
              Every commit is scanned for credentials before any summary is written. A file that
              matches is skipped from the model entirely and reported by path, with the value replaced
              by a solid bar — not shortened, not redacted character by character, not hinted at.
            </p>

            <div className="diff" role="img" aria-label="A commit that touched one file, flagged, with its value withheld">
              <div className="h">commit 4b7a22e — chore: wire up config</div>
              <div className="a"> src/config/keys.ts | 1 +</div>
              <div className="a">
                {"+ export const key = "}
                <span className="redact" aria-hidden="true" />
                <span className="visually-hidden">value withheld</span>;
              </div>
              <div className="flag">flagged: credential pattern — file skipped before any model call</div>
            </div>

            <p className="ld-body ld-pencil">
              HMAC signature verified on every delivery, before parsing.
              <br />
              Webhook endpoint rate limited per address.
              <br />
              Delivery id inserted before processing, so a redelivery is a no-op.
            </p>
          </section>

          {/* 7 — LIVE DEMO -------------------------------------------------- */}
          <section id="demo">
            <p className="margin-note">§ 8</p>
            <h2 className="ld-h2">The same screen your team will actually use.</h2>
            <p className="ld-body">
              The track is the only saturated element on the screen. Everything else — the ledger,
              the digest history, the settings — is graphite and pencil, because a page with two bold
              things has two things fighting.
            </p>

            <div className="preview">
              <div className="preview__bar">
                <span>syncura</span>
                <span>·</span>
                <span>auth</span>
                <span>·</span>
                <span>8 of 13 points</span>
              </div>
              <div className="preview__body">
                <GoalTrackSVG tasks={TASKS} commitCount={COMMIT_COUNT} replayKey={replay + 100} />
              </div>
            </div>

            <p>
              <Link className="ld-btn" to="/today">
                Open the dashboard
              </Link>
            </p>
          </section>
        </div>
      </div>

      {/* 8 — COLOPHON ------------------------------------------------------- */}
      <div className="ledger__grid">
        <div />
        <div className="ledger__main">
          <footer className="colophon">
            <p>
              Built on Fastify, Prisma, Postgres, React 19 and Vite. Two GSAP moments and no others.
              API on Vercel, worker on Render.{" "}
              <a href="https://commitit-five.vercel.app">commitit-five.vercel.app</a>
            </p>
            <p>No Redis was harmed.</p>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** The three weights, drawn at the correct relative areas. */
function WeightKey() {
  const sizes: Weight[] = ["S", "M", "L"];
  return (
    <div className="wkey">
      {sizes.map((w) => {
        const r = radiusFor(w);
        return (
          <figure key={w}>
            <svg width={r * 2 + 8} height={r * 2 + 8} viewBox={`0 0 ${r * 2 + 8} ${r * 2 + 8}`} aria-hidden="true">
              <circle cx={r + 4} cy={r + 4} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <figcaption>
              {w} · {WEIGHT_POINTS[w]}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
