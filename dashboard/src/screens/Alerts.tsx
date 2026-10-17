/**
 * Alerts. Everything CommitIt noticed that a person should decide about.
 *
 * One rule this screen exists to keep: a leaked-secret alert names the file and
 * nothing else. The secret value never reached the client, so it cannot be shown
 * here even by accident.
 */
import { Link } from "react-router-dom";
import type { Alert } from "../api/types.js";
import { Banner, LiveBar, Skeleton, StatePanel } from "../components/surfaces.js";
import { AlertGlyph, alertKindWord } from "../components/glyphs.js";
import { Button } from "../components/controls.js";
import { screenState, useAlerts, useRepoRef } from "../lib/queries.js";
import { useLive } from "../lib/useLive.js";
import { relativeTime } from "../lib/format.js";

const WATCHED = [
  "a key or token that looks committed",
  "a build that failed",
  "a force-push that rewrote history",
  "commits pushed straight to the default branch",
  "a branch that went quiet",
  "a stretch with no commits at all",
];

function AlertItem({ alert, repoFullName }: { alert: Alert; repoFullName: string }) {
  return (
    <article className={`alert alert--${alert.severity}`} aria-labelledby={`alert-${alert.id}`}>
      <div className="alert__head">
        <span className={`mark mark--${alert.severity === "danger" ? "danger" : "warn"}`}>
          <AlertGlyph size={14} />
          {alert.severity === "danger" ? "Action needed" : "Heads up"}
        </span>
        <span className="micro muted">{alertKindWord(alert.kind)}</span>
        <span className="micro muted num">{relativeTime(alert.at)}</span>
      </div>

      <h2 className="alert__title" id={`alert-${alert.id}`}>
        {alert.title}
      </h2>

      <p className="alert__body">{alert.detail}</p>

      {alert.kind === "secret" && alert.file ? (
        <p className="alert__body">
          The file was <span className="code">{alert.file}</span>. The file was skipped before any AI call,
          so its contents were never read, stored or summarised.
        </p>
      ) : null}

      {alert.branch ? (
        <p className="alert__body">
          Branch <span className="code">{alert.branch}</span>
        </p>
      ) : null}

      {alert.advice ? <p className="alert__body">{alert.advice}</p> : null}

      <div className="alert__actions">
        {alert.href ? (
          <a className="btn btn--quiet" href={alert.href} target="_blank" rel="noopener noreferrer">
            {alert.kind === "build_failed" ? "Open the failed run" : "See it on GitHub"}
          </a>
        ) : alert.commitSha ? (
          <a
            className="btn btn--quiet"
            href={`https://github.com/${repoFullName}/commit/${alert.commitSha}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            See the commit
          </a>
        ) : null}
        {alert.commitSha ? <span className="code muted">{alert.commitSha.slice(0, 7)}</span> : null}
      </div>
    </article>
  );
}

export function Alerts() {
  const { ref, repoId } = useRepoRef();
  const query = useAlerts(repoId);
  const live = useLive(repoId);
  const repoQuery = `?repo=${encodeURIComponent(ref)}`;
  const { data, status, error, retry, refetching } = screenState<Alert[]>(
    query,
    (alerts) => alerts.length === 0,
  );

  if (status === "loading") {
    return (
      <div className="screen" aria-busy="true">
        <h1 className="display">Alerts</h1>
        {[0, 1].map((i) => (
          <div className="alert" key={i} aria-hidden="true">
            <Skeleton variant="line-sm" width="8rem" />
            <Skeleton variant="line" width={`${76 - i * 16}%`} />
          </div>
        ))}
        <span className="visually-hidden">Loading alerts.</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen">
        <h1 className="display">Alerts</h1>
        <Banner
          severity="danger"
          urgent
          title="We could not load the alerts"
          detail={error ?? "The API is not answering."}
          actions={<Button onClick={retry} loading={refetching} loadingLabel="Trying again…">Try again</Button>}
        />
      </div>
    );
  }

  if (status === "empty" || !data) {
    return (
      <div className="screen">
        <h1 className="display">Nothing needs attention</h1>
        <StatePanel
          title="Nothing needs attention."
          body={`We keep watching for: ${WATCHED.join(", ")}. When something turns up, it appears here and in your digest.`}
        />
      </div>
    );
  }

  const danger = data.filter((a) => a.severity === "danger");
  const warn = data.filter((a) => a.severity === "warn");

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="display">
          {data.length === 1 ? "One thing needs attention" : `${data.length} things need attention`}
        </h1>
        <p className="screen__lede">
          Every alert names what happened and what to do about it. A secret alert names the file only.
        </p>
      </div>

      <LiveBar status={live.status} lastUpdated={live.lastUpdated} newActivity={live.newActivity} />

      {danger.length > 0 ? (
        <section aria-labelledby="danger-heading">
          <div className="section-head">
            <h2 className="section-head__title" id="danger-heading">
              Action needed
            </h2>
            <span className="section-head__meta num">{danger.length}</span>
          </div>
          {danger.map((alert) => (
            <AlertItem key={alert.id} alert={alert} repoFullName={ref} />
          ))}
        </section>
      ) : null}

      {warn.length > 0 ? (
        <section aria-labelledby="warn-heading">
          <div className="section-head">
            <h2 className="section-head__title" id="warn-heading">
              Worth a look
            </h2>
            <span className="section-head__meta num">{warn.length}</span>
          </div>
          {warn.map((alert) => (
            <AlertItem key={alert.id} alert={alert} repoFullName={ref} />
          ))}
        </section>
      ) : null}

      <p className="small muted">
        <Link className="btn btn--inline" to={`/today${repoQuery}`}>
          Back to today
        </Link>
      </p>
    </div>
  );
}
