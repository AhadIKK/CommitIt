/**
 * Goals. Every goal with the same sentence Today uses, so the number a person
 * reads here is the number they read there. Progress is finished tasks, weighted;
 * nothing on this screen can see a commit.
 */
import { Link } from "react-router-dom";
import type { Milestone } from "../api/types.js";
import { Banner, LiveBar, Skeleton, StatePanel } from "../components/surfaces.js";
import { Button } from "../components/controls.js";
import { screenState, useGoals, useRepoRef } from "../lib/queries.js";
import { useLive } from "../lib/useLive.js";
import { dueState, progressClause, progressPercent, progressSentence } from "../lib/weight.js";

function GoalRow({ goal, repoQuery }: { goal: Milestone; repoQuery: string }) {
  const now = new Date();
  const due = dueState(goal.dueDate, now);
  const pct = progressPercent(goal.weightedClosed, goal.weightedTotal);
  const overdue = due !== null && due.days < 0;

  return (
    <article className="goal-row">
      <div className="goal-row__head">
        <h2 className="goal-row__title">
          <Link to={`/goals/${goal.id}${repoQuery}`}>{goal.title}</Link>
        </h2>
        {due?.phrase ? (
          <span className={`goal-row__due${overdue ? " mark mark--danger" : " muted"}`}>
            {overdue ? (
              <>
                <span aria-hidden="true">●</span> {due.phrase}
              </>
            ) : (
              due.phrase
            )}
          </span>
        ) : (
          <span className="small muted">no due date</span>
        )}
      </div>

      <p className="goal-row__sentence">{progressSentence(goal, now)}</p>

      <p className="small muted num">
        {pct === null
          ? "no issues yet"
          : `${goal.closedCount} of ${goal.issueCount} tasks finished, ${progressClause(goal)}`}
      </p>

      <p className="goal-row__tasks">
        <Link className="btn btn--inline" to={`/goals/${goal.id}${repoQuery}`}>
          Open {goal.title}
        </Link>
      </p>
    </article>
  );
}

export function Goals() {
  const { ref, repoId } = useRepoRef();
  const query = useGoals(repoId);
  const live = useLive(repoId);
  const repoQuery = `?repo=${encodeURIComponent(ref)}`;
  const { data, status, error, retry, refetching } = screenState<Milestone[]>(
    query,
    (goals) => goals.length === 0,
  );

  if (status === "loading") {
    return (
      <div className="screen" aria-busy="true">
        <h1 className="display">Goals</h1>
        {[0, 1, 2].map((i) => (
          <div className="goal-row" key={i} aria-hidden="true">
            <Skeleton variant="line" width="12rem" />
            <Skeleton variant="line-sm" width={`${70 - i * 12}%`} />
          </div>
        ))}
        <span className="visually-hidden">Loading goals.</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen">
        <h1 className="display">Goals</h1>
        <Banner
          severity="danger"
          urgent
          title="We could not load the goals"
          detail={error ?? "The API is not answering."}
          actions={<Button onClick={retry} loading={refetching} loadingLabel="Trying again…">Try again</Button>}
        />
      </div>
    );
  }

  if (status === "empty" || !data) {
    return (
      <div className="screen">
        <h1 className="display">No goals yet</h1>
        <StatePanel
          title="No milestones on this repository."
          body="A goal here is a GitHub milestone. Create one, add issues to it, and each finished issue moves the goal forward."
          action={
            <a
              className="btn btn--primary"
              href={`https://github.com/${ref}/milestones/new`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Create a milestone on GitHub
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="display">Goals</h1>
        <p className="screen__lede">
          Each percentage counts finished tasks by their size: small 1, medium 3, large 5. Commits are
          never counted.
        </p>
      </div>

      <LiveBar status={live.status} lastUpdated={live.lastUpdated} newActivity={live.newActivity} />

      <div>
        {data.map((goal) => (
          <GoalRow key={goal.id} goal={goal} repoQuery={repoQuery} />
        ))}
      </div>
    </div>
  );
}
