/**
 * The Goal Track.
 *
 * One circle per task on a single baseline, ordered by CLOSING order. Circle
 * radius is proportional to √weight so the AREA is the point value — a 5-point
 * task occupies five times the ink of a 1-point task, which is the entire
 * argument of the product drawn as geometry. Scaling by diameter would make an L
 * look twice as heavy as an M when it is really five thirds.
 *
 * This is the only saturated thing on any screen. Everything else is pencil.
 */
import { useId, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  closingOrder,
  isFinished,
  radiusFor,
  totals,
  WEIGHT_POINTS,
  COMMIT_COUNT,
  TASKS,
  type LedgerTask,
} from "./seed.js";

gsap.registerPlugin(useGSAP);

const VB_W = 1200;
const PAD_X = 34;
const VB_H = 132;
const BASELINE = 82;

function xFor(i: number, n: number): number {
  if (n <= 1) return VB_W / 2;
  return PAD_X + (i * (VB_W - PAD_X * 2)) / (n - 1);
}

function reduced(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function GoalTrackSVG({
  tasks = TASKS,
  commitCount = COMMIT_COUNT,
  replayKey = 0,
}: {
  tasks?: LedgerTask[];
  commitCount?: number;
  /** bump to replay the closing-order reveal */
  replayKey?: number;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<LedgerTask | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ordered = closingOrder(tasks);
  const t = totals(tasks, commitCount);

  const points = ordered.map((task, i) => ({
    task,
    i,
    x: xFor(i, ordered.length),
    r: radiusFor(task.weight),
  }));
  // Two ends for the fill line. The track is drawn as it looked the moment the
  // last task was merged — the reopened task still filled — and then hands its
  // points back. `optimisticX` is where the line starts, `fillX` is where it
  // honestly ends once the reopen is applied.
  const optimisticLast = points.reduce(
    (acc, p, idx) => (p.task.closedAt !== null ? idx : acc),
    -1,
  );
  const lastFinished = points.reduce((acc, p, idx) => (isFinished(p.task) ? idx : acc), -1);
  const optimisticX = optimisticLast >= 0 ? points[optimisticLast]!.x : PAD_X;
  const fillX = lastFinished >= 0 ? points[lastFinished]!.x : PAD_X;

  const reopened = ordered.find((task) => task.reopenedAt);

  useGSAP(
    () => {
      if (reduced()) return;
      const root = scope.current;
      if (!root) return;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // 1. the baseline draws itself across
      const base = root.querySelector<SVGLineElement>(".gt-base");
      if (base) {
        const len = VB_W - PAD_X * 2;
        gsap.set(base, { strokeDasharray: len, strokeDashoffset: len });
        tl.to(base, { strokeDashoffset: 0, duration: 0.9 }, 0);
      }

      // 2. the progress fill extends, stopping at the last finished task
      const fill = root.querySelector<SVGLineElement>(".gt-fill");
      if (fill) {
        const len = Math.max(0, fillX - PAD_X);
        gsap.set(fill, { strokeDasharray: len, strokeDashoffset: len });
        tl.to(fill, { strokeDashoffset: 0, duration: 1.1 }, 0.15);
      }

      // 3. circles arrive in closing order, each settling at the size it means
      tl.from(
        root.querySelectorAll<SVGCircleElement>(".gt-dot"),
        {
          attr: { r: 0 },
          opacity: 0,
          duration: 0.45,
          stagger: 0.06,
        },
        0.2,
      );

      // 4. the point total counts up in step, on tabular figures so it never
      //    shifts the layout while it runs
      const counter = root.querySelector<HTMLElement>("[data-count]");
      if (counter) {
        const state = { v: 0 };
        tl.to(
          state,
          {
            v: t.closedPoints,
            duration: 1.5,
            onUpdate: () => {
              counter.textContent = String(Math.round(state.v));
            },
          },
          0.2,
        );
      }

      // 5. the signature moment: the reopened task un-fills with a heavier,
      //    deliberate ease, and the fill line retracts past it
      if (reopened && reopenedAt(reopened) !== null) {
        const node = root.querySelector<SVGCircleElement>(`[data-task="${reopened.id}"]`);
        const fillLine = root.querySelector<SVGLineElement>(".gt-fill");
        // the ink for an open node comes from the theme, never from a literal
        const openInk =
          getComputedStyle(root).getPropertyValue("--graphite").trim() || "currentColor";
        tl.to(
          node,
          {
            attr: { fill: "none" },
            stroke: openInk,
            strokeWidth: 1.5,
            duration: 0.5,
            ease: "power2.inOut",
          },
          2.1,
        );
        if (fillLine) {
          tl.to(
            fillLine,
            { attr: { x2: fillX }, duration: 0.6, ease: "power2.inOut" },
            2.2,
          );
        }
        const note = root.querySelector<HTMLElement>("[data-reopen-note]");
        if (note) {
          tl.fromTo(note, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.4 }, 2.3);
        }
        // the total gives the points back too, counted down on tabular figures
        const counter = root.querySelector<HTMLElement>("[data-count]");
        if (counter) {
          tl.to(
            counter,
            {
              duration: 0.6,
              ease: "power2.inOut",
              startAt: { textContent: t.closedPoints + WEIGHT_POINTS[reopened.weight] },
              onUpdate() {
                const el = this.targets()[0] as HTMLElement;
                const target = t.closedPoints;
                const from = target + WEIGHT_POINTS[reopened.weight];
                const p = this.progress();
                el.textContent = String(Math.round(from - (from - target) * p));
              },
            },
            2.2,
          );
        }
      }
    },
    { scope, dependencies: [replayKey, lastFinished], revertOnUpdate: true },
  );

  return (
    <div className="gt" ref={scope}>
      <div className="gt__figures">
        <p className="gt__total">
          <span data-count aria-hidden="true">
            {t.closedPoints}
          </span>
          <span className="gt__total-sep"> / </span>
          <span>{t.totalPoints}</span>
          <span className="gt__total-unit">points</span>
        </p>
        {/* The commit count is deliberately small, grey and subordinate: it is
            activity, and it is never allowed to read as progress. */}
        <p className="gt__activity num">
          {commitCount} commits (activity)
          {reopened && reopened.reopenedAt ? (
            <span className="gt__reopen-note" data-reopen-note role="status">
              reopened, −{WEIGHT_POINTS[reopened.weight]} pts
            </span>
          ) : null}
        </p>
      </div>

      <div className="gt__frame">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="gt__svg"
          role="img"
          aria-labelledby={`${uid}-t ${uid}-d`}
          preserveAspectRatio="xMidYMid meet"
        >
          <title id={`${uid}-t`}>Task weight track, in closing order</title>
          <desc id={`${uid}-d`}>
            {t.closedPoints} of {t.totalPoints} points finished across {tasks.length} tasks.
            Circle area is proportional to task weight: S is 1 point, M is 3, L is 5.
            One task was reopened, so the line gives its points back.
          </desc>

          <line className="gt-base" x1={PAD_X} y1={BASELINE} x2={VB_W - PAD_X} y2={BASELINE} />
          <line className="gt-fill" x1={PAD_X} y1={BASELINE} x2={optimisticX} y2={BASELINE} />

          {points.map(({ task, x, r }) => {
            // Drawn as merged, then handed back by the timeline above.
            const done = task.closedAt !== null;
            const reopens = Boolean(task.reopenedAt);
            return (
              <circle
                key={task.id}
                data-task={task.id}
                className={`gt-dot gt-dot--${done ? "done" : "open"}`}
                data-reopened={task.reopenedAt ? "true" : "false"}
                cx={x}
                cy={BASELINE}
                r={r}
                fill={done ? "currentColor" : "none"}
                stroke={done ? "none" : "currentColor"}
                strokeWidth={done ? 0 : 1.5}
                tabIndex={0}
                role="button"
                aria-label={`Task ${task.number}, ${task.title}, size ${task.weight}, ${
                  reopens ? "reopened, open again" : done ? "closed" : "open"
                }${task.pr ? `, PR ${task.pr}` : ""}`}
                onFocus={() => setActive(task)}
                onBlur={() => setActive(null)}
                onMouseEnter={() => setActive(task)}
                onMouseLeave={() => setActive(null)}
              />
            );
          })}
        </svg>

        <p className="visually-hidden" aria-live="polite">
          {t.closedPoints} of {t.totalPoints} points finished. {commitCount} commits, which are
          activity and not progress.
        </p>
      </div>

      <p className="gt__readout" role="status">
        {active ? (
          <>
            <strong>Task {active.number}</strong> — {active.title}. {active.weight},{" "}
            {WEIGHT_POINTS[active.weight]} {WEIGHT_POINTS[active.weight] === 1 ? "point" : "points"}.
            {active.reopenedAt ? " Reopened, so open again." : null}
            {active.pr ? ` PR #${active.pr}.` : ""}
          </>
        ) : (
          <>
            One circle per task. Area is weight: S is 1 point, M is 3, L is 5. The line fills in
            closing order.
          </>
        )}
      </p>
    </div>
  );
}

function reopenedAt(task: LedgerTask): number | null {
  return task.reopenedAt ? Date.parse(task.reopenedAt) : null;
}
