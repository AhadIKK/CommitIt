import { useCallback, useEffect, useState } from "react";
import type {
  ActivitySnapshot,
  IssueRow,
  RepoProgress,
} from "@src/dashboard.js";
import { AuthorBars, Donut, OverallBand } from "./components.js";
import { buildWeeklySummary } from "./report.js";

// Review — HTML slide deck (slides/pptx design rules, dependency-free):
// one idea per slide, varied layouts, no text-only slides, keyboard
// arrows + buttons, dots for position. Print shows all slides stacked.
export default function Review({
  progress,
  activity,
  issues,
}: {
  progress: RepoProgress | null;
  activity: ActivitySnapshot | null;
  issues: IssueRow[];
}) {
  const [slide, setSlide] = useState(0);
  const total = 3;
  const go = useCallback(
    (d: number) => setSlide((s) => (s + d + total) % total),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const summary = buildWeeklySummary(activity, progress, issues, []);
  const topOpen = issues
    .filter((i) => i.state === "open")
    .sort((a, b) => b.weight - a.weight || a.number - b.number)
    .slice(0, 5);

  return (
    <div className="deck">
      <div className="slide-nav">
        <button type="button" className="btn-secondary" onClick={() => go(-1)} aria-label="Previous slide">
          ← Prev
        </button>
        <span className="muted mono" aria-live="polite">
          {slide + 1} / {total}
        </span>
        <button type="button" className="btn-secondary" onClick={() => go(1)} aria-label="Next slide">
          Next →
        </button>
      </div>

      <section className={`slide ${slide === 0 ? "current" : ""}`} aria-label="Slide 1: overall progress">
        <h2>Where we stand</h2>
        {progress?.overall ? (
          <OverallBand m={progress.overall} />
        ) : (
          <p className="muted">No progress data yet.</p>
        )}
        <p className="deck-lead">{summary.progress}</p>
      </section>

      <section className={`slide ${slide === 1 ? "current" : ""}`} aria-label="Slide 2: milestones">
        <h2>Milestones</h2>
        {progress && progress.milestones.length > 0 ? (
          <div className="miles">
            {progress.milestones.map((m) => (
              <Donut key={m.title} m={m} />
            ))}
          </div>
        ) : (
          <p className="muted">No milestones yet.</p>
        )}
      </section>

      <section className={`slide ${slide === 2 ? "current" : ""}`} aria-label="Slide 3: activity and focus">
        <h2>Who did what, what's next</h2>
        {activity && <AuthorBars authors={activity.authors.slice(0, 5)} />}
        <h3>Top focus</h3>
        {topOpen.length === 0 ? (
          <p className="muted">Board is clear.</p>
        ) : (
          <ul className="deck-list">
            {topOpen.map((i) => (
              <li key={i.number}>
                <span className="mono">#{i.number}</span> {i.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
