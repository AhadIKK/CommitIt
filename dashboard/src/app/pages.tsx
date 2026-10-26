/**
 * The operator ledger. Eight routes in the ledger language, all reading the
 * same payload the product reads (`/api/ops`) instead of seed data.
 *
 * Two invariants survive the move to real data:
 *   1. `commitCount` is activity and is never added into points.
 *   2. Where the database does not store a value (a digest's points, a chat's
 *      member count, a finding's path) the cell says so. Nothing is estimated
 *      to make a column look full.
 *
 * The one bold element per screen is always the Goal Track (or, on the settings
 * area, the live message preview). Nothing else is allowed to compete with it.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Entry,
  LedgerTable,
  Segmented,
  Slip,
  Stamp,
  Switch,
  TextInput,
  useToast,
} from "../components/kit.js";
import { PageHeader, PageState } from "./Shell.js";
import {
  repoOf,
  tasksToLedger,
  useOps,
  type LedgerTask,
} from "./data.js";

/* ------------------------------------------------------- the app's track
   Reused from the marketing site so there is exactly one implementation of
   "area is weight, closing order, reopened gives the points back". */

export { GoalTrackSVG as GoalTrack } from "../site/GoalTrackSVG.js";
import { GoalTrackSVG } from "../site/GoalTrackSVG.js";

/** The backend's alert kinds, in the ledger's voice. */
const KIND_LABEL: Record<string, string> = {
  secret: "Secret in a commit",
  build_failed: "Build failed",
  force_push: "Force-push",
  direct_push: "Direct push",
  stale_branch: "Stale branch",
  inactivity: "No activity",
};

const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** "2026-10-18T09:00:00Z" → "10-18", or an em dash when we have nothing. */
const day = (iso: string | null | undefined) => (iso ? iso.slice(5, 10) : "—");

/** A value the database does not keep is stated, not invented. */
function NotRecorded({ what }: { what: string }) {
  return <span className="muted-note">not recorded ({what})</span>;
}

/* ============================================================ /app Overview */

export function Overview() {
  const ops = useOps();
  const [q, setQ] = useState("");
  const repos = ops.data?.repos ?? [];
  const alerts = ops.data?.alerts ?? [];

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Overview"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  const points = repos.reduce((a, r) => a + r.pointsFinished, 0);
  const commits = repos.reduce((a, r) => a + r.commitCount, 0);
  const decisions = repos.reduce((a, r) => a + r.needsDecision, 0);
  const rows = repos.filter((r) => r.fullName.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Overview" lede="Every repository you are watching, and what still needs a decision." section="1" />

      <div className="tally">
        <p className="tally__figure">
          {points}
          <span className="tally__unit">points finished</span>
        </p>
        <p className="tally__activity num">activity: {commits} commits</p>
      </div>

      <div className="split2">
        <div>
          <TextInput label="Filter" value={q} onChange={setQ} placeholder="repository" />
          <LedgerTable
            caption="Repositories, points finished, and health"
            rows={rows}
            rowKey={(r) => r.id}
            onRowActivate={() => undefined}
            columns={[
              {
                key: "repo",
                head: "Repository",
                render: (r) => (
                  <span className="cell-repo">
                    <span className="cell-repo__name">{r.fullName}</span>
                    <span className="cell-repo__branch num">{r.defaultBranch}</span>
                  </span>
                ),
              },
              {
                key: "track",
                head: "Weight",
                width: "132px",
                render: (r) => {
                  // A repository whose webhook never delivered is not "0% done";
                  // it is not connected, and saying so is the whole point.
                  if (!r.connected) return <span className="muted-note">not connected</span>;
                  const weights = [...r.finishedWeights, ...r.openWeights];
                  if (weights.length === 0) return <span className="muted-note">no tasks yet</span>;
                  return (
                    <svg
                      viewBox="0 0 120 22"
                      className="micro-track"
                      role="img"
                      aria-label={`${r.pointsFinished} of ${r.pointsTotal} points finished`}
                    >
                      {weights.map((w, i) => (
                        <circle
                          key={i}
                          cx={6 + i * ((120 - 12) / Math.max(1, weights.length - 1))}
                          cy={11}
                          r={5 * Math.sqrt(w / 5)}
                          className={i < r.finishedWeights.length ? "micro-track__done" : "micro-track__open"}
                        />
                      ))}
                    </svg>
                  );
                },
              },
              {
                key: "points",
                head: "Points",
                numeric: true,
                width: "92px",
                render: (r) => (
                  <span>
                    {r.connected ? (
                      <>
                        {r.pointsFinished} / {r.pointsTotal || "\u2014"}
                      </>
                    ) : (
                      "\u2014"
                    )}
                  </span>
                ),
              },
              {
                key: "decision",
                head: "Decision",
                numeric: true,
                width: "76px",
                render: (r) =>
                  r.needsDecision ? <span className="hatch">{r.needsDecision}</span> : <span className="muted-note">0</span>,
              },
              {
                key: "digest",
                head: "Last digest",
                numeric: true,
                width: "120px",
                render: (r) => <span>{day(r.lastDigestAt)}</span>,
              },
              {
                key: "health",
                head: "Health",
                width: "96px",
                render: (r) => <Stamp tone={r.health === "VERIFIED" ? "ok" : "plain"}>{r.health}</Stamp>,
              },
            ]}
          />
        </div>

        <aside className="side">
          <h2 className="side__title">Recent alerts</h2>
          <p className="side__note">
            {decisions} reopened {decisions === 1 ? "task wants" : "tasks want"} an answer. These are
            the five most recent alerts, whatever their kind.
          </p>
          {alerts.slice(0, 5).map((a) => (
            <Slip key={a.id} title={kindLabel(a.kind)}>
              <p className="slip-line">{a.detail}</p>
              <p className="slip-meta num">
                {repoOf(repos, a.repoId)?.fullName ?? "unknown"} · {day(a.at)}
              </p>
            </Slip>
          ))}
          {alerts.length === 0 ? <p className="muted-note">Nothing has alerted in this window.</p> : null}
        </aside>
      </div>
    </>
  );
}

/* ================================================== /app/repos/:repoId */

export function RepoDetail() {
  const ops = useOps();
  const { repoId } = useParams();
  const [tab, setTab] = useState<"tasks" | "activity" | "digests" | "alerts" | "settings">("tasks");
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const toast = useToast();

  const repo = ops.data ? repoOf(ops.data.repos, repoId) : null;
  const repoTasks = useMemo(
    () => (ops.data ? ops.data.tasks.filter((t) => t.repoId === repoId) : []),
    [ops.data, repoId],
  );
  const ledger = useMemo(() => tasksToLedger(repoTasks), [repoTasks]);

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Repository"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  if (!repo) {
    return (
      <PageState
        state="empty"
        title="Repository"
        empty={{ title: "No such repository.", body: "It was disconnected, or the link is old." }}
      />
    );
  }

  const shown = ledger.filter(
    (r) => filter === "all" || (filter === "closed" ? r.state === "closed" : r.state === "open"),
  );

  const ledgerTasks = repoTasks.map((t) => ({
    id: t.id,
    number: t.number,
    title: t.title,
    // Unestimated tasks count as S (1 point), the same as a dashed ring.
    weight: (t.weight === 3 ? "M" : t.weight === 5 ? "L" : "S") as "S" | "M" | "L",
    closedAt: t.reopenedAt ? null : t.closedAt,
    reopenedAt: t.reopenedAt,
    pr: t.pr,
  }));

  return (
    <>
      <PageHeader
        title={repo.fullName}
        lede={`Progress is finished tasks on ${repo.defaultBranch}, weighted. Commits are activity.`}
        section="2"
      >
        <Link className="ld-btn ld-btn--mono" to="/app/system">
          Reconcile
        </Link>
        <Link className="ld-btn ld-btn--mono" to="/app/settings">
          Repo settings
        </Link>
      </PageHeader>

      {/* THE bold element of this screen, and the only one. */}
      <div className="hero-track">
        <GoalTrackSVG tasks={ledgerTasks} commitCount={repo.commitCount} />
      </div>

      <div className="ledger-seg ledger-seg--wide" role="tablist" aria-label="Repository sections">
        {(["tasks", "activity", "digests", "alerts", "settings"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="ledger-seg__tab"
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "tasks" ? (
        <>
          <div className="row-controls">
            <Segmented
              legend="Filter tasks by state"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "all" },
                { value: "open", label: "open" },
                { value: "closed", label: "closed" },
              ]}
            />
          </div>
          <LedgerTable
            caption="Tasks and their weights"
            rows={shown}
            rowKey={(r) => r.raw.id}
            columns={[
              { key: "n", head: "Task", width: "64px", render: (r) => <span className="num">#{r.n}</span> },
              { key: "title", head: "Title", render: (r) => r.title },
              {
                key: "w",
                head: "Weight",
                width: "96px",
                render: (r) => (
                  <span className="wcell">
                    <Badge>{r.points}</Badge>
                    <span className="num muted-note">{r.weight}</span>
                  </span>
                ),
              },
              {
                key: "state",
                head: "State",
                width: "110px",
                render: (r) =>
                  r.reopenedAt ? (
                    <span className="reopen-tag num">reopened</span>
                  ) : r.state === "closed" ? (
                    <Stamp>FINISHED</Stamp>
                  ) : (
                    <span className="muted-note">open</span>
                  ),
              },
              { key: "closed", head: "Closed", numeric: true, width: "104px", render: (r) => <span>{day(r.closedAt)}</span> },
              { key: "pr", head: "PR", numeric: true, width: "72px", render: (r) => <span>{r.pr ? `#${r.pr}` : "—"}</span> },
            ]}
          />
        </>
      ) : null}

      {tab === "activity" ? (
        <div className="activity">
          <h2 className="activity__title">Activity, not progress</h2>
          <p className="activity__why">
            {repo.commitCount} commits are recorded for this repository. They are never added
            together into a number that claims to be progress — a six-hundred-line refactor and a
            typo both count one. The commits themselves are listed on{" "}
            <Link to="/today">Today</Link>.
          </p>
        </div>
      ) : null}

      {tab === "digests" ? (
        <LedgerTable
          caption="Digests for this repository"
          rows={ops.data.digests.filter((d) => d.repoId === repo.id)}
          rowKey={(d) => d.id}
          columns={[
            { key: "at", head: "Sent", numeric: true, width: "128px", render: (d) => <span>{d.sentAt.slice(0, 10)}</span> },
            { key: "cad", head: "Cadence", width: "96px", render: (d) => <span className="num">{d.cadence}</span> },
            {
              key: "pts",
              head: "Points",
              numeric: true,
              width: "84px",
              render: (d) =>
                d.pointsFinished === null ? <NotRecorded what="per message" /> : <span>{d.pointsFinished}</span>,
            },
            {
              key: "st",
              head: "Status",
              width: "132px",
              render: (d) =>
                d.status === "FAILED" ? (
                  <span className="err-prefix">ERR {d.status}</span>
                ) : (
                  <Stamp tone={d.status === "DELIVERED" ? "ok" : "plain"}>{d.status}</Stamp>
                ),
            },
          ]}
        />
      ) : null}

      {tab === "alerts" ? (
        <LedgerTable
          caption="Alerts for this repository"
          rows={ops.data.alerts.filter((a) => a.repoId === repo.id)}
          rowKey={(a) => a.id}
          columns={[
            { key: "kind", head: "Kind", width: "160px", render: (a) => <span>{kindLabel(a.kind)}</span> },
            { key: "detail", head: "Detail", render: (a) => a.detail },
            { key: "at", head: "At", numeric: true, width: "112px", render: (a) => <span>{day(a.at)}</span> },
          ]}
        />
      ) : null}

      {tab === "settings" ? (
        <div className="entries">
          <Entry label="Digest cadence" section="4.1" hint="How often this chat hears from CommitIt." control={
            <Segmented
              legend="Cadence"
              value="daily"
              onChange={() => toast("Cadence is set per chat × repo.")}
              options={[
                { value: "instant", label: "instant" },
                { value: "hourly", label: "hourly" },
                { value: "daily", label: "daily" },
              ]}
            />
          } />
          <Entry label="Scan before any model call" section="7.1" hint="A file that matches a credential pattern is skipped whole." control={
            <Switch checked label="Scan before any model call" locked onChange={() => undefined} />
          } />
          <Entry label="Reopened tasks lose their points" section="5.4" hint="This is why the track drags backwards." control={
            <Switch checked label="Reopened tasks lose their points" locked onChange={() => undefined} />
          } />
        </div>
      ) : null}
    </>
  );
}

/* ============================================================== /app/tasks */

export function TaskLedger() {
  const ops = useOps();
  const [group, setGroup] = useState<"repo" | "week">("repo");

  const all = useMemo(() => (ops.data ? tasksToLedger(ops.data.tasks) : []), [ops.data]);
  const repos = ops.data?.repos ?? [];

  const byRepo = useMemo(() => {
    const m = new Map<string, LedgerTask[]>();
    for (const t of all) {
      const name = repoOf(repos, t.raw.repoId)?.fullName ?? "unknown";
      const list = m.get(name) ?? [];
      list.push(t);
      m.set(name, list);
    }
    return [...m.entries()];
  }, [all, repos]);

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Tasks"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  const groups: Array<[string, LedgerTask[]]> = group === "repo" ? byRepo : [["All tasks", all]];

  return (
    <>
      <PageHeader title="Tasks" lede="Every task across every repository, with the weight it was counted at." section="3">
        <button type="button" className="ld-btn ld-btn--mono">Export CSV</button>
      </PageHeader>

      <div className="row-controls">
        <Segmented
          legend="Group tasks by"
          value={group}
          onChange={setGroup}
          options={[
            { value: "repo", label: "by repo" },
            { value: "week", label: "all tasks" },
          ]}
        />
      </div>

      {groups.length === 0 ? (
        <p className="muted-note">
          No tasks yet. A task is a GitHub issue; add one to a milestone and it appears here.
        </p>
      ) : null}

      {groups.map(([name, rows]) => (
        <section key={name} className="grouped">
          <h2 className="grouped__title">{name}</h2>
          <LedgerTable
            caption={`Tasks in ${name}`}
            rows={rows}
            rowKey={(r) => r.raw.id}
            columns={[
              { key: "n", head: "Task", width: "64px", render: (r) => <span className="num">#{r.n}</span> },
              { key: "t", head: "Title", render: (r) => r.title },
              { key: "w", head: "Weight", width: "84px", render: (r) => <Badge>{r.points}</Badge> },
              { key: "s", head: "State", width: "110px", render: (r) =>
                r.reopenedAt ? (
                  <span className="reopen-tag num">reopened</span>
                ) : r.state === "closed" ? (
                  <Stamp>FINISHED</Stamp>
                ) : (
                  <span className="muted-note">open</span>
                )
              },
              { key: "c", head: "Closed", numeric: true, width: "104px", render: (r) => <span>{day(r.closedAt)}</span> },
            ]}
          />
        </section>
      ))}
    </>
  );
}

/* ============================================================= /app/digests */

export function DigestLedger() {
  const ops = useOps();

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Digests"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  return (
    <>
      <PageHeader title="Digests" lede="Every message that was sent, and what it was allowed to say." section="4" />
      <LedgerTable
        caption="Digest history"
        rows={ops.data.digests}
        rowKey={(d) => d.id}
        columns={[
          { key: "at", head: "Sent", numeric: true, width: "136px", render: (d) => <span>{d.sentAt.slice(0, 16).replace("T", " ")}</span> },
          { key: "repo", head: "Repository", width: "180px", render: (d) => <span>{repoOf(ops.data!.repos, d.repoId)?.fullName ?? "unknown"}</span> },
          { key: "chat", head: "Chat", width: "150px", render: (d) => <span>{d.chatTitle}</span> },
          { key: "cad", head: "Cadence", width: "92px", render: (d) => <span className="num">{d.cadence}</span> },
          {
            key: "pts",
            head: "Points",
            numeric: true,
            width: "80px",
            render: (d) =>
              d.pointsFinished === null ? <NotRecorded what="per message" /> : <span>{d.pointsFinished}</span>,
          },
          { key: "n", head: "Messages", numeric: true, width: "92px", render: (d) => <span>{d.messageCount}</span> },
          { key: "st", head: "Status", width: "136px", render: (d) =>
            d.status === "FAILED" ? (
              <span className="err-prefix">ERR {d.status}</span>
            ) : (
              <Stamp tone={d.status === "DELIVERED" ? "ok" : "plain"}>{d.status}</Stamp>
            )
          },
        ]}
      />
    </>
  );
}

/* ============================================================== /app/alerts */

export function AlertFeed() {
  const ops = useOps();
  const [kind, setKind] = useState<string>("all");

  const all = ops.data?.alerts ?? [];
  const rows = kind === "all" ? all : all.filter((a) => a.kind === kind);

  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const a of rows) {
      const d = a.at.slice(0, 10);
      const list = m.get(d) ?? [];
      list.push(a);
      m.set(d, list);
    }
    return [...m.entries()];
  }, [rows]);

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Alerts"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  const kinds = [...new Set(all.map((a) => a.kind))];

  return (
    <>
      <PageHeader title="Alerts" lede="Things that changed in a way somebody should read about." section="5" />
      <div className="split2">
        <div>
          <div className="row-controls">
            <Segmented
              legend="Filter by kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "all" },
                ...kinds.map((k) => ({ value: k, label: kindLabel(k) })),
              ]}
            />
          </div>
          {groups.length === 0 ? (
            <p className="muted-note">No alerts in this window. A quiet repo is not a broken one.</p>
          ) : null}
          {groups.map(([d, items]) => (
            <section key={d} className="grouped">
              <h2 className="grouped__title num">{d}</h2>
              {items.map((a) => (
                <Slip key={a.id} title={kindLabel(a.kind)}>
                  <p className="slip-line">{a.detail}</p>
                  <p className="slip-meta num">
                    {repoOf(ops.data!.repos, a.repoId)?.fullName ?? "unknown"} · {a.at.slice(11, 16)}
                    {a.delivered ? " · delivered" : " · held"}
                  </p>
                </Slip>
              ))}
            </section>
          ))}
        </div>
        <aside className="side">
          <h2 className="side__title">Rules</h2>
          <div className="entries entries--tight">
            <Entry label="Stale branch" hint="No activity for 6 days." control={<span className="num">6d</span>} />
            <Entry label="Force-push" hint="Any push to a protected branch." control={<span className="num">any</span>} />
            <Entry label="CI recovered" hint="Only after a failure was reported." control={<span className="num">on</span>} />
          </div>
          <Link className="ld-btn ld-btn--mono" to="/app/settings?section=6">
            Change thresholds
          </Link>
        </aside>
      </div>
    </>
  );
}

/* =============================================================== /app/chats */

export function ChatLedger() {
  const ops = useOps();

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Chats"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  return (
    <>
      <PageHeader title="Chats" lede="Where the messages go, and what each one is allowed to say." section="5.1">
        <button type="button" className="ld-btn ld-btn--primary">Link a chat</button>
      </PageHeader>
      <LedgerTable
        caption="Linked Telegram chats"
        rows={ops.data.chats}
        rowKey={(c) => c.id}
        columns={[
          { key: "title", head: "Chat", render: (c) => <span>{c.title}</span> },
          { key: "kind", head: "Type", width: "96px", render: (c) => <span className="num">{c.kind}</span> },
          {
            key: "mem",
            head: "Members",
            numeric: true,
            width: "92px",
            render: (c) =>
              c.members === null ? (
                <span className="num" title="Telegram does not expose a member count for this chat">
                  {"\u2014"}
                </span>
              ) : (
                <span>{c.members}</span>
              ),
          },
          { key: "repos", head: "Repos", numeric: true, width: "84px", render: (c) => <span>{c.linkedRepoIds.length}</span> },
          { key: "last", head: "Last message", numeric: true, width: "132px", render: (c) => <span>{day(c.lastMessageAt)}</span> },
          { key: "st", head: "Status", width: "112px", render: (c) => <Stamp tone={c.status === "VERIFIED" ? "ok" : "plain"}>{c.status}</Stamp> },
        ]}
      />
      <p className="muted-note">
        Member counts are not recorded. Telegram does not expose them here, so the column stays a
        dash rather than a guess.
      </p>
    </>
  );
}

/* ============================================================== /app/system */

export function Pipeline() {
  const ops = useOps();

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Pipeline"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  const jobs = ops.data.jobs;
  const byStatus = new Map<string, number>();
  for (const j of jobs) byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);

  return (
    <>
      <PageHeader title="Pipeline" lede="What the webhook, the queue and the sender actually recorded." section="6" />

      <div className="tally">
        <p className="tally__figure">
          {ops.data.deliveries.length}
          <span className="tally__unit">deliveries recorded</span>
        </p>
        <p className="tally__activity num">
          jobs:{" "}
          {[...byStatus.entries()].map(([s, n]) => `${n} ${s}`).join(" · ") || "none yet"}
        </p>
      </div>

      {/*
        The eleven-stage timing chart this page used to draw was seed data:
        nothing records per-stage latency, so it could only ever be invented.
        The counts below are the rows the queue really holds.
      */}
      <p className="muted-note">
        Stage timings are not recorded. The queue and the delivery log are.
      </p>

      <h2 className="grouped__title">Job queue</h2>
      <LedgerTable
        caption="Postgres job queue"
        rows={jobs}
        rowKey={(j) => j.id}
        columns={[
          { key: "id", head: "Job", width: "96px", render: (j) => <span className="num">{j.id}</span> },
          { key: "k", head: "Kind", render: (j) => <span className="num">{j.kind}</span> },
          { key: "s", head: "Status", width: "112px", render: (j) =>
            j.status === "dead" ? <span className="err-prefix">ERR {j.status}</span> : <span className="num">{j.status}</span>
          },
          { key: "a", head: "Attempts", numeric: true, width: "96px", render: (j) => <span>{j.attempts}</span> },
        ]}
      />

      <h2 className="grouped__title">Webhook deliveries</h2>
      <LedgerTable
        caption="Webhook delivery log"
        rows={ops.data.deliveries}
        rowKey={(d) => d.id}
        columns={[
          { key: "id", head: "Delivery", width: "88px", render: (d) => <span className="num">{d.key}</span> },
          { key: "at", head: "At", numeric: true, width: "140px", render: (d) => <span>{d.at.slice(5, 16).replace("T", " ")}</span> },
          { key: "e", head: "Event", width: "120px", render: (d) => <span className="num">{d.event}</span> },
          { key: "s", head: "Signature", width: "112px", render: (d) =>
            d.signature === "VERIFIED" ? <Stamp>VERIFIED</Stamp> : <span className="err-prefix">ERR</span>
          },
          { key: "r", head: "Rate limited", width: "120px", render: (d) => <span className="num">{d.rateLimited ? "yes · 429" : "no"}</span> },
          { key: "o", head: "Outcome", width: "132px", render: (d) => <span className="num">{d.outcome}</span> },
        ]}
      />
    </>
  );
}

/* ============================================================ /app/security */

export function Security() {
  const ops = useOps();
  const toast = useToast();
  const [ack, setAck] = useState<Record<string, boolean>>({});

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Safety"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  const findings = ops.data.findings;
  const skipped = Object.keys(ack).length;

  return (
    <>
      <PageHeader title="Safety" lede="Files that were withheld from the model before a summary was ever written." section="7" />

      <p className="security__note">
        <strong>This screen never renders, stores or requests a secret value.</strong> A finding is a
        commit, the rule that matched, and a date. That is the whole record, because the value was
        never read.
      </p>

      <p className="security__tally">
        <span className="num">{findings.length}</span> files skipped before any model saw them
      </p>

      <LedgerTable
        caption="Secret findings, by commit"
        rows={findings}
        rowKey={(f) => f.id}
        columns={[
          {
            key: "p",
            head: "Path",
            render: (f) =>
              f.path === null ? <NotRecorded what="the path is not stored" /> : <code className="path">{f.path}</code>,
          },
          { key: "r", head: "Rule matched", width: "250px", render: (f) => <span>{f.rule}</span> },
          { key: "repo", head: "Repository", width: "150px", render: (f) => <span>{repoOf(ops.data!.repos, f.repoId)?.fullName ?? "unknown"}</span> },
          { key: "c", head: "Commit", width: "92px", render: (f) => <span className="num">{f.commitSha}</span> },
          { key: "d", head: "Date", numeric: true, width: "104px", render: (f) => <span>{day(f.at)}</span> },
          {
            key: "s",
            head: "Status",
            width: "132px",
            render: (f) =>
              ack[f.id] ? (
                <Stamp tone="plain">ACKNOWLEDGED</Stamp>
              ) : (
                <Stamp>SKIPPED</Stamp>
              ),
          },
          {
            key: "a",
            head: "",
            width: "128px",
            render: (f) =>
              ack[f.id] ? null : (
                <button
                  type="button"
                  className="ld-btn ld-btn--mono"
                  onClick={() => {
                    setAck((a) => ({ ...a, [f.id]: true }));
                    toast("Acknowledged.");
                  }}
                >
                  Acknowledge
                </button>
              ),
          },
        ]}
      />

      {findings.length === 0 ? (
        <p className="muted-note">No file has matched a credential pattern in this workspace.</p>
      ) : null}

      <div className="entries">
        <Entry
          label="Scan before any model call"
          hint="Locked on. A file that matches is skipped whole, before trim, before classify."
          control={<Switch checked locked label="Scan before any model call" onChange={() => undefined} />}
        />
        <Entry
          label="Ignore paths"
          hint="Glob patterns. Files matching these are never scanned, and never sent."
          control={<TextInput label="Ignore paths" value="test/fixtures/**, docs/example.env" onChange={() => undefined} />}
        />
      </div>
      <p className="security__count num">{skipped} acknowledged of {findings.length}</p>
    </>
  );
}

export { PageState };
