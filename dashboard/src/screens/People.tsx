/**
 * People. What each person finished this week, alongside what they committed —
 * with the two kept visibly apart, because commits are activity and finished
 * tasks are progress. Nobody is ranked by commit count.
 */
import type { PersonSummary } from "../api/types.js";
import { Banner, LiveBar, Skeleton, StatePanel, Avatar } from "../components/surfaces.js";
import { Button } from "../components/controls.js";
import { CommitRow } from "../components/CommitRow.js";
import { screenState, usePeople, useRepoRef } from "../lib/queries.js";
import { useLive } from "../lib/useLive.js";
import { dateRange, pluralize } from "../lib/format.js";

function Person({ person, repoFullName }: { person: PersonSummary; repoFullName: string }) {
  const finished = person.closedTasks.length;
  const points = person.weightedPointsClosed;

  return (
    <article className="person">
      <div className="person__head">
        <Avatar name={person.author.name ?? person.author.login} />
        <h2 className="person__name">{person.author.login}</h2>
      </div>

      <p className="person__sentence">
        {finished === 0
          ? `${person.author.login} has no tasks closed yet this week.`
          : `${person.author.login} finished ${pluralize(finished, "task")}, worth ${pluralize(
              points,
              "point",
            )}, and committed ${pluralize(person.commits.length, "commit")}.`}
      </p>

      <div className="person__stats">
        <span className="person__stat">
          <span className="person__stat-legend">Tasks finished</span>
          <span className="person__stat-value">{finished}</span>
        </span>
        <span className="person__stat">
          <span className="person__stat-legend">Points closed</span>
          <span className="person__stat-value">{points}</span>
        </span>
        <span className="person__stat">
          <span className="person__stat-legend">Pull requests merged</span>
          <span className="person__stat-value">{person.mergedPRs}</span>
        </span>
        <span className="person__stat">
          <span className="person__stat-legend">Commits</span>
          <span className="person__stat-value">{person.commits.length}</span>
        </span>
      </div>

      {person.commits.length > 0 ? (
        <>
          <div className="section-head">
            <h3 className="section-head__title">Commits this week</h3>
            <span className="section-head__meta">activity, not progress</span>
          </div>
          <ul className="commits">
            {person.commits.slice(0, 6).map((commit) => (
              <CommitRow key={commit.sha} commit={commit} repoFullName={repoFullName} />
            ))}
          </ul>
          {person.commits.length > 6 ? (
            <p className="small muted" style={{ marginTop: "var(--space-3)" }}>
              {pluralize(person.commits.length - 6, "more commit")} this week, not shown here.
            </p>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export function People() {
  const { ref, repoId } = useRepoRef();
  const query = usePeople(repoId);
  const live = useLive(repoId);
  const { data, status, error, retry, refetching } = screenState<PersonSummary[]>(
    query,
    (people) => people.length === 0,
  );

  if (status === "loading") {
    return (
      <div className="screen" aria-busy="true">
        <h1 className="display">People</h1>
        {[0, 1].map((i) => (
          <div className="person" key={i} aria-hidden="true">
            <Skeleton variant="line" width="10rem" />
            <Skeleton variant="line-sm" width={`${64 - i * 14}%`} />
          </div>
        ))}
        <span className="visually-hidden">Loading people.</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen">
        <h1 className="display">People</h1>
        <Banner
          severity="danger"
          urgent
          title="We could not load this week"
          detail={error ?? "The API is not answering."}
          actions={<Button onClick={retry} loading={refetching} loadingLabel="Trying again…">Try again</Button>}
        />
      </div>
    );
  }

  if (status === "empty" || !data) {
    return (
      <div className="screen">
        <h1 className="display">Nobody moved this week</h1>
        <StatePanel
          title="No activity this week."
          body="When commits land and tasks get finished, the people behind them appear here. This week is quiet so far."
        />
      </div>
    );
  }

  const range = data[0] ? dateRange(data[0].windowStart, data[0].windowEnd) : "";

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="display">People</h1>
        <p className="screen__lede num">{range ? `This week, ${range}.` : "This week."}</p>
      </div>

      <LiveBar status={live.status} lastUpdated={live.lastUpdated} newActivity={live.newActivity} />

      <div>
        {data.map((person) => (
          <Person key={person.author.id} person={person} repoFullName={ref} />
        ))}
      </div>
    </div>
  );
}
