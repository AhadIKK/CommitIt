/**
 * The authenticated app. Nine routes, all in the ledger language, all reading
 * from seed data behind a mock adapter so the whole app is readable with no
 * backend and the real API is one interface swap away.
 *
 * The one bold element per screen is always the Goal Track (or, on the settings
 * area, the live message preview). Nothing else on any screen is allowed to
 * compete with it.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Entry,
  LedgerTable,
  Notice,
  Segmented,
  Slip,
  Stamp,
  Switch,
  TextInput,
  Checkbox,
  useToast,
} from "../components/kit.js";
import { PageHeader, PageState } from "./Shell.js";
import {
  ALERTS,
  CHATS,
  DELIVERIES,
  DIGESTS,
  FINDINGS,
  JOBS,
  REPOS,
  STAGES,
  TASKS,
  WEIGHT_POINTS,
  repoById,
  type Task,
  type Weight,
} from "./seed.js";

/* ------------------------------------------------------- the app's track
   Reused from the marketing site so there is exactly one implementation of
   "area is weight, closing order, reopened gives the points back". */

export { GoalTrackSVG as GoalTrack } from "../site/GoalTrackSVG.js";
import { GoalTrackSVG } from "../site/GoalTrackSVG.js";

function tasksToLedger(tasks: Task[]) {
  return tasks.map((t) => ({
    n: t.number,
    title: t.title,
    weight: WEIGHT_POINTS[t.weight],
    state: t.closedAt !== null && t.reopenCount === 0 ? ("closed" as const) : ("open" as const),
    closedAt: t.closedAt,
    reopenCount: t.reopenCount,
    pr: t.pr ?? null,
    overridden: Boolean(t.overridden),
    raw: t,
  }));
}

/* ============================================================ /app Overview */

export function Overview() {
  const [q, setQ] = useState("");
  const points = REPOS.reduce((a, r) => a + r.pointsFinished, 0);
  const commits = REPOS.reduce((a, r) => a + r.commitCount, 0);
  const decisions = REPOS.reduce((a, r) => a + r.needsDecision, 0);

  const rows = REPOS.filter((r) => r.fullName.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Overview" lede="Every repository you are watching, and what still needs a decision." section="1" />

      <div className="tally">
        <p className="tally__figure">
          {points}
          <span className="tally__unit">points finished this week</span>
        </p>
        <p className="tally__activity num">
          activity: {commits} commits
        </p>
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
                render: (r) =>
                  r.weights.length ? (
                    <svg viewBox="0 0 120 22" className="micro-track" role="img" aria-label={`${r.pointsFinished} of ${r.pointsTotal} points finished`}>
                      {r.weights.map((w, i) => (
                        <circle
                          key={i}
                          cx={6 + i * ((120 - 12) / Math.max(1, r.weights.length - 1))}
                          cy={11}
                          r={5 * Math.sqrt(w / 5)}
                          className={
                            i < r.weights.length - r.open.length ? "micro-track__done" : "micro-track__open"
                          }
                        />
                      ))}
                    </svg>
                  ) : (
                    <span className="muted-note">not connected</span>
                  ),
              },
              {
                key: "points",
                head: "Points",
                numeric: true,
                width: "92px",
                render: (r) => (
                  <span>
                    {r.pointsFinished} / {r.pointsTotal || "—"}
                  </span>
                ),
              },
              {
                key: "decision",
                head: "Decision",
                numeric: true,
                width: "76px",
                render: (r) => (r.needsDecision ? <span className="hatch">{r.needsDecision}</span> : <span className="muted-note">0</span>),
              },
              {
                key: "digest",
                head: "Last digest",
                numeric: true,
                width: "120px",
                render: (r) => <span>{r.lastDigest ? r.lastDigest.slice(5, 10) : "—"}</span>,
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
          <h2 className="side__title">Needs a decision</h2>
          <p className="side__note">
            {decisions} open. These are the only things on this screen that want an answer.
          </p>
          {ALERTS.filter((a) => a.kind === "PR opened" || a.kind === "Force-push")
            .slice(0, 5)
            .map((a) => (
              <Slip key={a.id} title={a.kind}>
                <p className="slip-line">{a.detail}</p>
                <p className="slip-meta num">
                  {repoById(a.repoId).fullName} · {a.at.slice(5, 10)}
                </p>
              </Slip>
            ))}
        </aside>
      </div>
    </>
  );
}

/* ================================================== /app/repos/:repoId */

export function RepoDetail() {
  const { repoId = "r_syncura" } = useParams();
  const repo = repoById(repoId);
  const [tab, setTab] = useState<"tasks" | "activity" | "digests" | "alerts" | "settings">("tasks");
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const toast = useToast();

  const repoTasks = TASKS.filter((t) => t.repoId === repo.id);
  const ledger = tasksToLedger(repoTasks);
  const shown = ledger.filter(
    (r) => filter === "all" || (filter === "closed" ? r.state === "closed" : r.state === "open"),
  );

  const ledgerTasks = repoTasks.map((t) => ({
    id: t.id,
    number: t.number,
    title: t.title,
    weight: t.weight,
    closedAt: t.closedAt,
    reopenedAt: t.reopenCount > 0 ? "2026-10-15T08:30:00Z" : null,
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
              { key: "w", head: "Weight", width: "96px", render: (r) => (
                <span className="wcell">
                  <Badge>{r.weight}</Badge>
                  <span className="num muted-note">{r.weight}</span>
                  {r.overridden ? <span className="num overridden">overridden</span> : null}
                </span>
              ) },
              { key: "state", head: "State", width: "110px", render: (r) =>
                r.reopenCount > 0 ? (
                  <span className="reopen-tag num">reopened ×{r.reopenCount}</span>
                ) : r.state === "closed" ? (
                  <Stamp>FINISHED</Stamp>
                ) : (
                  <span className="muted-note">open</span>
                )
              },
              { key: "closed", head: "Closed", numeric: true, width: "104px", render: (r) => <span>{r.closedAt ? r.closedAt.slice(5, 10) : "—"}</span> },
              { key: "pr", head: "PR", numeric: true, width: "72px", render: (r) => <span>{r.pr ? `#${r.pr}` : "—"}</span> },
            ]}
          />
        </>
      ) : null}

      {tab === "activity" ? (
        <div className="activity">
          <h2 className="activity__title">Activity, not progress</h2>
          <p className="activity__why">
            These {repo.commitCount} entries are what happened. They are never added together into a
            number that claims to be progress — a six-hundred-line refactor and a typo both count one.
          </p>
          <ul className="ticks ticks--heavy">
            {Array.from({ length: 14 }, (_, i) => (
              <li key={i} style={{ ["--w" as string]: `${26 + ((i * 41) % 62)}%` }} />
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "digests" ? (
        <LedgerTable
          caption="Digests for this repository"
          rows={DIGESTS.filter((d) => d.repoId === repo.id)}
          rowKey={(d) => d.id}
          columns={[
            { key: "at", head: "Sent", numeric: true, width: "128px", render: (d) => <span>{d.sentAt.slice(0, 10)}</span> },
            { key: "cad", head: "Cadence", width: "96px", render: (d) => <span className="num">{d.cadence}</span> },
            { key: "pts", head: "Points", numeric: true, width: "84px", render: (d) => <span>{d.pointsFinished}</span> },
            { key: "st", head: "Status", width: "132px", render: (d) =>
              d.status === "FAILED" ? (
                <span className="err-prefix">ERR {d.status}</span>
              ) : (
                <Stamp tone={d.status === "DELIVERED" ? "ok" : "plain"}>{d.status}</Stamp>
              )
            },
          ]}
        />
      ) : null}

      {tab === "alerts" ? (
        <LedgerTable
          caption="Alerts for this repository"
          rows={ALERTS.filter((a) => a.repoId === repo.id)}
          rowKey={(a) => a.id}
          columns={[
            { key: "kind", head: "Kind", width: "140px", render: (a) => <span>{a.kind}</span> },
            { key: "detail", head: "Detail", render: (a) => a.detail },
            { key: "actor", head: "Actor", width: "120px", render: (a) => <span className="num">{a.actor}</span> },
            { key: "at", head: "At", numeric: true, width: "112px", render: (a) => <span>{a.at.slice(5, 10)}</span> },
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
  const [group, setGroup] = useState<"repo" | "week">("repo");
  const all = tasksToLedger(TASKS);
  const byRepo = useMemo(() => {
    const m = new Map<string, typeof all>();
    for (const t of all) {
      const repo = repoById(TASKS.find((x) => x.number === t.n && x.title === t.title)!.repoId);
      const list = m.get(repo.fullName) ?? [];
      list.push(t);
      m.set(repo.fullName, list);
    }
    return [...m.entries()];
  }, [all]);

  const groups: Array<[string, typeof all]> =
    group === "repo" ? byRepo : [["All tasks", all]];

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
            { value: "week", label: "by week closed" },
          ]}
        />
      </div>

      {groups.map(([name, rows]) => (
        <section key={name} className="grouped">
          <h2 className="grouped__title">{name}</h2>
          <LedgerTable
            caption={`Tasks in ${name}`}
            rows={rows as typeof all}
            rowKey={(r) => r.raw.id}
            columns={[
              { key: "n", head: "Task", width: "64px", render: (r) => <span className="num">#{r.n}</span> },
              { key: "t", head: "Title", render: (r) => r.title },
              { key: "w", head: "Weight", width: "84px", render: (r) => <Badge>{r.weight}</Badge> },
              { key: "s", head: "State", width: "110px", render: (r) =>
                r.state === "closed" ? <Stamp>FINISHED</Stamp> : <span className="muted-note">open</span>
              },
              { key: "c", head: "Closed", numeric: true, width: "104px", render: (r) => <span>{r.closedAt ? r.closedAt.slice(5, 10) : "—"}</span> },
            ]}
          />
        </section>
      ))}
    </>
  );
}

/* ============================================================= /app/digests */

export function DigestLedger() {
  return (
    <>
      <PageHeader title="Digests" lede="Every message that was sent, and what it was allowed to say." section="4" />
      <LedgerTable
        caption="Digest history"
        rows={DIGESTS}
        rowKey={(d) => d.id}
        columns={[
          { key: "at", head: "Sent", numeric: true, width: "136px", render: (d) => <span>{d.sentAt.slice(0, 16).replace("T", " ")}</span> },
          { key: "repo", head: "Repository", width: "180px", render: (d) => <span>{repoById(d.repoId).fullName}</span> },
          { key: "chat", head: "Chat", width: "150px", render: (d) => <span>{d.chatTitle}</span> },
          { key: "cad", head: "Cadence", width: "92px", render: (d) => <span className="num">{d.cadence}</span> },
          { key: "pts", head: "Points", numeric: true, width: "80px", render: (d) => <span>{d.pointsFinished}</span> },
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
  const [kind, setKind] = useState<string>("all");
  const rows = kind === "all" ? ALERTS : ALERTS.filter((a) => a.kind === kind);
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const a of rows) {
      const day = a.at.slice(0, 10);
      const list = m.get(day) ?? [];
      list.push(a);
      m.set(day, list);
    }
    return [...m.entries()];
  }, [rows]);

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
                { value: "PR merged", label: "PR merged" },
                { value: "CI failed", label: "CI failed" },
                { value: "Stale branch", label: "stale" },
                { value: "Force-push", label: "force-push" },
              ]}
            />
          </div>
          {groups.map(([day, items]) => (
            <section key={day} className="grouped">
              <h2 className="grouped__title num">{day}</h2>
              {items.map((a) => (
                <Slip key={a.id} title={a.kind}>
                  <p className="slip-line">{a.detail}</p>
                  <p className="slip-meta num">
                    {repoById(a.repoId).fullName} · {a.actor} · {a.at.slice(11, 16)}
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
  return (
    <>
      <PageHeader title="Chats" lede="Where the messages go, and what each one is allowed to say." section="5.1">
        <button type="button" className="ld-btn ld-btn--primary">Link a chat</button>
      </PageHeader>
      <LedgerTable
        caption="Linked Telegram chats"
        rows={CHATS}
        rowKey={(c) => c.id}
        columns={[
          { key: "title", head: "Chat", render: (c) => <span>{c.title}</span> },
          { key: "kind", head: "Type", width: "96px", render: (c) => <span className="num">{c.kind}</span> },
          { key: "mem", head: "Members", numeric: true, width: "92px", render: (c) => <span>{c.members ?? "—"}</span> },
          { key: "repos", head: "Repos", numeric: true, width: "84px", render: (c) => <span>{c.linkedRepos}</span> },
          { key: "last", head: "Last message", numeric: true, width: "132px", render: (c) => <span>{c.lastMessage ? c.lastMessage.slice(5, 10) : "—"}</span> },
          { key: "st", head: "Status", width: "112px", render: (c) => <Stamp tone={c.status === "VERIFIED" ? "ok" : "plain"}>{c.status}</Stamp> },
        ]}
      />
    </>
  );
}

/* ============================================================== /app/system */

export function Pipeline() {
  const max = Math.max(...STAGES.map((s) => s.count));
  return (
    <>
      <PageHeader title="Pipeline" lede="The eleven stages, and what each of them did in the last 24 hours." section="6" />

      <ol className="stages">
        {STAGES.map((s) => (
          <li key={s.key} className="stages__item">
            <span className="stages__tick" aria-hidden="true" />
            <span className="stages__label num">{s.key}</span>
            <span className="stages__count num">{s.count}</span>
            <svg className="stages__spark" viewBox="0 0 100 12" aria-hidden="true">
              <line x1="0" y1="6" x2="100" y2="6" className="stages__base" />
              <line
                x1="0"
                y1="6"
                x2={(s.count / max) * 100}
                y2="6"
                className="stages__bar"
              />
            </svg>
            <span className="stages__lat num">
              p50 {s.p50}ms · p95 {s.p95}ms
            </span>
          </li>
        ))}
      </ol>

      <h2 className="grouped__title">Job queue</h2>
      <LedgerTable
        caption="Postgres job queue"
        rows={JOBS}
        rowKey={(j) => j.id}
        columns={[
          { key: "id", head: "Job", width: "80px", render: (j) => <span className="num">{j.id}</span> },
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
        rows={DELIVERIES}
        rowKey={(d) => d.id}
        columns={[
          { key: "id", head: "Delivery", width: "88px", render: (d) => <span className="num">{d.id}</span> },
          { key: "at", head: "At", numeric: true, width: "140px", render: (d) => <span>{d.at.slice(5, 16).replace("T", " ")}</span> },
          { key: "e", head: "Event", width: "120px", render: (d) => <span className="num">{d.event}</span> },
          { key: "s", head: "Signature", width: "112px", render: (d) =>
            d.signature === "VERIFIED" ? <Stamp>VERIFIED</Stamp> : <span className="err-prefix">ERR</span>
          },
          { key: "r", head: "Rate limited", width: "120px", render: (d) => <span className="num">{d.rateLimited ? "yes · 429" : "no"}</span> },
          { key: "k", head: "Key", width: "96px", render: (d) => <span className="num muted-note">{d.key}</span> },
          { key: "o", head: "Outcome", width: "132px", render: (d) => <span className="num">{d.outcome}</span> },
        ]}
      />
    </>
  );
}

/* ============================================================ /app/security */

export function Security() {
  const toast = useToast();
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const skipped = Object.keys(ack).length + FINDINGS.filter((f) => f.status === "ACKNOWLEDGED").length;

  return (
    <>
      <PageHeader title="Safety" lede="Files that were withheld from the model before a summary was ever written." section="7" />

      <p className="security__note">
        <strong>This screen never renders, stores or requests a secret value.</strong> A finding is a
        path, a rule that matched, a commit, and a date. That is the whole record, because the value
        was never read.
      </p>

      <p className="security__tally">
        <span className="num">{FINDINGS.length}</span> files skipped before any model saw them
      </p>

      <LedgerTable
        caption="Secret findings, by path only"
        rows={FINDINGS}
        rowKey={(f) => f.id}
        columns={[
          { key: "p", head: "Path", render: (f) => <code className="path">{f.path}</code> },
          { key: "r", head: "Rule matched", width: "250px", render: (f) => <span>{f.rule}</span> },
          { key: "repo", head: "Repository", width: "150px", render: (f) => <span>{repoById(f.repoId).fullName}</span> },
          { key: "c", head: "Commit", width: "92px", render: (f) => <span className="num">{f.commitSha}</span> },
          { key: "d", head: "Date", numeric: true, width: "104px", render: (f) => <span>{f.at.slice(5, 10)}</span> },
          {
            key: "s",
            head: "Status",
            width: "132px",
            render: (f) =>
              ack[f.id] || f.status === "ACKNOWLEDGED" ? (
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
              ack[f.id] || f.status === "ACKNOWLEDGED" ? null : (
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
      <p className="security__count num">{skipped} acknowledged of {FINDINGS.length}</p>
    </>
  );
}

export { PageState };
export type { Weight };
