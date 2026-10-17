/**
 * Today. The screen the whole product is built around: are we on track, and
 * what moved since the last digest.
 *
 * Order is deliberate. A leaked secret interrupts first (role="alert"); then the
 * one display sentence — the progress sentence, whose percentage comes from the
 * API and is never derived from commits; then the Goal Track; then the activity
 * since the last digest, which is quieter and carries no progress device at all.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { Alert, AuthorGroup as AuthorGroupModel, Issue, TodaySnapshot } from "../api/types.js";
import { api } from "../api/index.js";
import { GoalTrack } from "../components/GoalTrack.js";
import { CommitGroup } from "../components/CommitGroup.js";
import { Banner, LiveBar, Skeleton, SkeletonRows, StatePanel } from "../components/surfaces.js";
import { AlertGlyph, alertKindWord } from "../components/glyphs.js";
import { Button } from "../components/controls.js";
import { screenState, useRepoRef, useToday } from "../lib/queries.js";
import { useLive } from "../lib/useLive.js";
import { useMediaQuery } from "../lib/useMedia.js";
import { progressSentence } from "../lib/weight.js";
import { clockTime, relativeTime } from "../lib/format.js";

const TRACK_QUERY = "(min-width: 60rem)";

function repoSuffix(ref: string): string {
  return `?repo=${encodeURIComponent(ref)}`;
}

/** The one alert that interrupts. Never a secret value — the file path only. */
function SecretBanner({ alert, repoQuery }: { alert: Alert; repoQuery: string }) {
  return (
    <Banner
      severity="danger"
      urgent
      title={alert.title}
      detail={`${alert.detail} The file was skipped, so no line of it reached the AI. ${alert.advice ?? ""}`.trim()}
      actions={
        <>
          <Link className="btn btn--quiet" to={`/alerts${repoQuery}`}>
            Open alerts
          </Link>
          {alert.href ? (
            <a className="btn btn--inline" href={alert.href} target="_blank" rel="noopener noreferrer">
              See the commit
            </a>
          ) : null}
        </>
      }
    />
  );
}

function NeedsAttention({ alerts, repoQuery }: { alerts: Alert[]; repoQuery: string }) {
  if (alerts.length === 0) {
    return (
      <p className="small muted">
        Nothing needs your attention. We watch secrets, failed builds, force-pushes, stale branches and
        quiet stretches.
      </p>
    );
  }
  const shown = alerts.slice(0, 3);
  const more = alerts.length - shown.length;
  return (
    <>
      <div className="needs">
        {shown.map((alert) => (
          <p className="needs__item" key={alert.id}>
            <span className={`mark mark--${alert.severity === "danger" ? "danger" : "warn"}`}>
              <AlertGlyph size={14} />
              {alertKindWord(alert.kind)}
            </span>
            <span className="wrap-anywhere">{alert.title}</span>
            <span className="muted">{relativeTime(alert.at)}</span>
          </p>
        ))}
      </div>
      <p style={{ marginTop: "var(--space-3)" }}>
        <Link className="btn btn--inline" to={`/alerts${repoQuery}`}>
          {more > 0 ? `Open alerts, ${more} more` : "Open alerts"}
        </Link>
      </p>
    </>
  );
}

function suggestionsFrom(unlinked: TodaySnapshot["unlinked"]): Record<number, Issue | null> {
  const map: Record<number, Issue | null> = {};
  for (const item of unlinked) {
    if (item.commit.suggestedIssueNumber) map[item.commit.suggestedIssueNumber] = item.suggestion;
  }
  return map;
}

function unlinkedCount(groups: AuthorGroupModel[]): number {
  return groups.reduce(
    (n, g) => n + g.commits.filter((c) => !c.isMerge && !c.issueNumber && !c.secretFlag).length,
    0,
  );
}

export function Today() {
  const { ref, repoId } = useRepoRef();
  const query = useToday(repoId);
  const live = useLive(repoId);
  const wide = useMediaQuery(TRACK_QUERY);
  const repoQuery = repoSuffix(ref);

  // Accepting a suggestion is the only way a commit becomes linked to a task.
  const accept = useMutation({
    mutationFn: ({ sha, issueNumber }: { sha: string; issueNumber: number }) =>
      api.linkCommit(repoId, sha, issueNumber),
    onSuccess: () => void query.refetch(),
  });

  const { data, status, error, retry, refetching } = screenState<TodaySnapshot>(
    query,
    (snapshot) => snapshot.goals.length === 0 && snapshot.groups.length === 0,
    (snapshot) => snapshot.groups.length === 0 && snapshot.alerts.length === 0 && snapshot.goals.length > 0,
  );

  // New activity arrived on the live channel: pull the screen's data again.
  useEffect(() => {
    if (live.tick > 0) void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.tick]);

  const now = new Date();
  const secret = data?.alerts.find((a) => a.kind === "secret") ?? null;
  const otherAlerts = data?.alerts.filter((a) => a.kind !== "secret") ?? [];

  const windowStart = data?.digestWindowStart ?? now.toISOString();
  const newSince =
    data?.focus && data.focusIssues
      ? data.focusIssues
          .filter((i) => i.state === "closed" && i.closedAt && new Date(i.closedAt) > new Date(windowStart))
          .map((i) => i.number)
      : [];

  const linkedCounts: Record<number, number> = {};
  for (const group of data?.groups ?? []) {
    for (const commit of group.commits) {
      if (commit.issueNumber) linkedCounts[commit.issueNumber] = (linkedCounts[commit.issueNumber] ?? 0) + 1;
    }
  }

  if (status === "loading") {
    return (
      <div className="screen today" aria-busy="true">
        <Skeleton variant="display" width="62%" />
        <div className="today__track">
          <Skeleton variant="line-sm" width="30%" />
          <div className="row" aria-hidden="true">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} variant="node" width={i % 3 === 0 ? 24 : 16} height={i % 3 === 0 ? 24 : 16} />
            ))}
          </div>
        </div>
        <span className="visually-hidden">Loading today.</span>
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen today">
        <h1 className="display">Today</h1>
        <Banner
          severity="danger"
          urgent
          title="We could not load this repository"
          detail={error ?? "The API is not answering."}
          actions={<Button onClick={retry} loading={refetching} loadingLabel="Trying again…">Try again</Button>}
        />
      </div>
    );
  }

  if (status === "empty" || !data) {
    return (
      <div className="screen today">
        <h1 className="display">Nothing here yet</h1>
        <StatePanel
          title="No goals yet."
          body="Create a milestone on GitHub and add issues to it. It will appear here as a goal, and every finished task moves its line forward."
          action={
            <a
              className="btn btn--primary"
              href={`https://github.com/${data?.repo.fullName ?? ref}/milestones/new`}
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

  const partial = status === "partial";
  const sentence = data.focus ? progressSentence(data.focus, now) : "No goal is being tracked yet.";

  return (
    <div className="screen today">
      {secret ? <SecretBanner alert={secret} repoQuery={repoQuery} /> : null}

      <div className="today__track">
        <h1 className="display">{sentence}</h1>
        {data.focus ? (
          <GoalTrack
            milestone={data.focus}
            issues={data.focusIssues}
            orientation={wide ? "horizontal" : "vertical"}
            newSince={newSince}
            linkedCounts={linkedCounts}
            issueHref={(issue) =>
              `https://github.com/${data.repo.fullName}/issues/${issue.number}`
            }
            caption={
              <p className="small muted">
                One node per task. Node size is the task's weight:{" "}
                <strong>S</strong> is 1 point, <strong>M</strong> is 3, <strong>L</strong> is 5. A dashed
                ring is an unestimated task and counts as 1 point.{" "}
                <Link className="btn btn--inline" to={`/goals/${data.focus.id}${repoQuery}`}>
                  Open the {data.focus.title} goal
                </Link>
              </p>
            }
          />
        ) : (
          <StatePanel
            title="No goal is being tracked yet."
            body="Create a milestone on GitHub and it will appear here."
          />
        )}
      </div>

      <LiveBar status={live.status} lastUpdated={live.lastUpdated} newActivity={live.newActivity} />

      {partial ? (
        <Banner
          severity="warn"
          title="Activity could not be loaded"
          detail="The goal above is up to date. What moved since your last digest did not arrive, so it is not being shown."
          actions={<Button variant="quiet" onClick={retry} loading={refetching} loadingLabel="Retrying…">Retry</Button>}
        />
      ) : (
        <section className="card-less-section" aria-labelledby="since-heading">
          <div className="section-head">
            <h2 className="section-head__title" id="since-heading">
              Since your last digest, {clockTime(windowStart)}
            </h2>
            <span className="section-head__meta num">
              {unlinkedCount(data.groups) === 0
                ? "all work is linked to a task"
                : `${unlinkedCount(data.groups)} commits are not linked to a task`}
            </span>
          </div>
          {data.groups.length === 0 ? (
            <StatePanel
              title="No commits since your last digest."
              body="When commits land, they appear here grouped by author. They never count as progress."
            />
          ) : (
            <div className="stack--tight">
              {data.groups.map((group) => (
                <CommitGroup
                  key={group.author.id}
                  author={group.author}
                  commits={group.commits}
                  repoFullName={data.repo.fullName}
                  suggestions={suggestionsFrom(data.unlinked)}
                  onAcceptSuggestion={(sha, issueNumber) => accept.mutate({ sha, issueNumber })}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {accept.isError ? (
        <p className="small" role="status">
          That suggestion was not saved. Nothing was changed; try again.
        </p>
      ) : null}

      <section className="card-less-section" aria-labelledby="needs-heading">
        <div className="section-head">
          <h2 className="section-head__title" id="needs-heading">
            Needs attention
          </h2>
        </div>
        <NeedsAttention alerts={otherAlerts} repoQuery={repoQuery} />
      </section>
    </div>
  );
}
