/**
 * One goal. The track at full size, then the tasks it is made of, then the work
 * that points at those tasks and the work that points at nothing.
 *
 * A reopened task is drawn open again, so the filled line moves back. That is the
 * honest behaviour and the reason the track exists.
 */
import { Link, useParams } from "react-router-dom";
import type { GoalDetail, Issue } from "../api/types.js";
import { GoalTrack } from "../components/GoalTrack.js";
import { CommitGroup } from "../components/CommitGroup.js";
import { Banner, LiveBar, Skeleton, StatePanel } from "../components/surfaces.js";
import { Button } from "../components/controls.js";
import { Avatar } from "../components/surfaces.js";
import { screenState, useGoal, useRepoRef } from "../lib/queries.js";
import { useLive } from "../lib/useLive.js";
import { useMediaQuery } from "../lib/useMedia.js";
import { progressSentence, sizeLabel, weightOf } from "../lib/weight.js";
import { relativeTime } from "../lib/format.js";

const TRACK_QUERY = "(min-width: 60rem)";

function taskOwner(detail: GoalDetail, issue: Issue): string {
  const found = detail.authors.find((a) => a.id === issue.assigneeId);
  return found?.name ?? found?.login ?? "unassigned";
}

export function Goal() {
  const { id = "" } = useParams();
  const { ref, repoId } = useRepoRef();
  const query = useGoal(repoId, id);
  const live = useLive(repoId);
  const wide = useMediaQuery(TRACK_QUERY);
  const repoQuery = `?repo=${encodeURIComponent(ref)}`;

  const { data, status, error, retry, refetching } = screenState<GoalDetail>(
    query,
    (detail) => detail.issues.length === 0,
    (detail) => detail.issues.length > 0 && detail.commits.length === 0 && detail.unlinked.length > 0,
  );

  if (status === "loading") {
    return (
      <div className="screen" aria-busy="true">
        <Skeleton variant="line-sm" width="6rem" />
        <Skeleton variant="display" width="58%" />
        <Skeleton variant="line" width="100%" height="3rem" />
        <span className="visually-hidden">Loading the goal.</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen">
        <h1 className="display">Goal</h1>
        <Banner
          severity="danger"
          urgent
          title="We could not load this goal"
          detail={error ?? "The API is not answering."}
          actions={<Button onClick={retry} loading={refetching} loadingLabel="Trying again…">Try again</Button>}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="screen">
        <h1 className="display">Goal</h1>
        <StatePanel title="This goal is not here." body="It may have been closed or removed on GitHub." />
      </div>
    );
  }

  const { milestone } = data;
  const now = new Date();
  const linkedCounts: Record<number, number> = {};
  for (const commit of data.commits) {
    if (commit.issueNumber) linkedCounts[commit.issueNumber] = (linkedCounts[commit.issueNumber] ?? 0) + 1;
  }

  return (
    <div className="screen">
      <p className="small">
        <Link className="btn btn--inline" to={`/goals${repoQuery}`}>
          All goals
        </Link>
      </p>

      <div className="screen__head">
        <h1 className="display">{progressSentence(milestone, now)}</h1>
        <p className="screen__lede">
          {milestone.title}. {milestone.closedCount} of {milestone.issueCount} tasks finished.
          {milestone.dueDate ? ` Due ${new Date(milestone.dueDate).toDateString()}.` : " No due date."}
        </p>
      </div>

      <GoalTrack
        milestone={milestone}
        issues={data.issues}
        orientation={wide ? "horizontal" : "vertical"}
        authors={data.authors}
        linkedCounts={linkedCounts}
        issueHref={(issue) => `https://github.com/${ref}/issues/${issue.number}`}
        emptyAction={
          <a
            className="btn btn--primary"
            href={`https://github.com/${ref}/milestone/${milestone.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Add issues on GitHub
          </a>
        }
        caption={
          <p className="small muted">
            The line fills to the last task finished. Close a task and it moves forward; reopen one and it
            moves back.
          </p>
        }
      />

      <LiveBar status={live.status} lastUpdated={live.lastUpdated} newActivity={live.newActivity} />

      {data.issues.length > 0 ? (
        <section className="card-less-section" aria-labelledby="tasks-heading">
          <div className="section-head">
            <h2 className="section-head__title" id="tasks-heading">
              Tasks
            </h2>
            <span className="section-head__meta num">{data.issues.length}</span>
          </div>
          <ul className="tasks">
            {data.issues.map((issue) => {
              const label = sizeLabel(issue.sizeWeight);
              return (
                <li className="task" key={issue.number} data-state={issue.state}>
                  <span className="task__number">#{issue.number}</span>
                  <a
                    className="task__title"
                    href={`https://github.com/${ref}/issues/${issue.number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {issue.title}
                  </a>
                  <span className="task__meta">
                    <span>
                      {label ? `${label}, ${weightOf(issue)} points` : "unestimated, counts as 1 point"}
                    </span>
                    <span className="task__owner">
                      <Avatar name={taskOwner(data, issue)} />
                      {taskOwner(data, issue)}
                    </span>
                    <span>
                      {issue.state === "closed"
                        ? `finished${issue.closedAt ? ` ${relativeTime(issue.closedAt)}` : ""}`
                        : issue.reopenedAt
                          ? `reopened ${relativeTime(issue.reopenedAt)}`
                          : "open"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {status === "partial" ? (
        <Banner
          severity="warn"
          title="Linked commits could not be loaded"
          detail="The unlinked work below did arrive. Commits that point at a task are not being shown."
          actions={<Button variant="quiet" onClick={retry} loading={refetching} loadingLabel="Retrying…">Retry</Button>}
        />
      ) : data.commits.length > 0 ? (
        <section className="card-less-section" aria-labelledby="linked-heading">
          <div className="section-head">
            <h2 className="section-head__title" id="linked-heading">
              Commits linked to this goal
            </h2>
            <span className="section-head__meta num">{data.commits.length}</span>
          </div>
          <ul className="commits">
            {data.commits.map((commit) => (
              <li className="unlinked__item" key={commit.sha}>
                <span className="row__cat">{commit.category}</span>
                <span className="wrap-anywhere">{commit.message}</span>
                <span className="code muted">{commit.sha.slice(0, 7)}</span>
                {commit.issueNumber ? <span className="small">Task {commit.issueNumber}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.unlinked.length > 0 ? (
        <section className="card-less-section" aria-labelledby="unlinked-heading">
          <div className="section-head">
            <h2 className="section-head__title" id="unlinked-heading">
              Unlinked work
            </h2>
            <span className="section-head__meta">suggestions are never applied on their own</span>
          </div>
          <div className="unlinked">
            {data.unlinked.map(({ commit, suggestion }) => (
              <p className="unlinked__item" key={commit.sha}>
                <span className="row__cat">{commit.category}</span>
                <span className="wrap-anywhere">{commit.message}</span>
                <span className="code muted">{commit.sha.slice(0, 7)}</span>
                {suggestion ? (
                  <span className="small muted">
                    Suggested task: <strong>#{suggestion.number}</strong> {suggestion.title}
                  </span>
                ) : (
                  <span className="small muted">No task suggested.</span>
                )}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
