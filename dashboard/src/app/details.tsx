/**
 * Detail routes that hang off the two ledgers: one digest, one chat.
 * Both re-state the same rule as their parent — a digest's headline is a
 * point count (or "not recorded"), and the activity line is labelled.
 *
 * They read the same `/api/ops` payload as the ledgers, so a digest that
 * appears in the table opens here with the body the sender actually built.
 */
import { Link, useParams } from "react-router-dom";
import { Entry, LedgerTable, Notice, Slip, Stamp } from "../components/kit.js";
import { PageHeader, PageState } from "./Shell.js";
import { repoOf, useOps } from "./data.js";

export function DigestDetail() {
  const ops = useOps();
  const { digestId } = useParams();

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Digest"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  const digest = ops.data.digests.find((d) => d.id === digestId);
  if (!digest) {
    return (
      <PageState
        state="empty"
        title="Digest"
        empty={{
          title: "Not on the books.",
          body: "That digest id is not in this ledger. It may have been purged after its retention window.",
        }}
      />
    );
  }

  const repo = repoOf(ops.data.repos, digest.repoId);

  return (
    <div className="page">
      <PageHeader
        section="§ digests"
        title={`${repo?.fullName ?? "repo"} · ${digest.cadence} digest`}
        lede="What was sent, exactly as it was sent. Reopening a task gives the points back on the next digest, not this one."
      />

      <div className="split2">
        <div className="tally">
          <p className="tally__figure">
            {digest.pointsFinished === null ? "—" : digest.pointsFinished}
            <span className="tally__unit">points finished</span>
          </p>
          <p className="tally__activity">
            {digest.messageCount} message. Activity, not progress.
          </p>
        </div>

        <aside className="side">
          <h2 className="side__title">Delivery</h2>
          <p className="side__note num">{digest.sentAt}</p>
          <p className="side__note">
            {digest.status === "DELIVERED" ? <Stamp>DELIVERED</Stamp> : null}
            {digest.status === "QUEUED" ? <Stamp tone="plain">QUEUED</Stamp> : null}
            {digest.status === "FAILED" ? <span className="err-prefix">ERR</span> : null}
          </p>
          <p className="side__note">
            <Link to="/app/digests">All digests</Link>
          </p>
        </aside>
      </div>

      <Slip title={`as sent · ${digest.chatTitle}`}>
        <pre className="slip-body">{digest.body}</pre>
      </Slip>

      {digest.pointsFinished === null ? (
        <p className="muted-note">
          The sender does not record how many points a message carried, so this page does not claim
          a number. The message above is the record.
        </p>
      ) : null}

      {digest.status === "FAILED" ? (
        <Notice
          kind="err"
          title="This digest did not reach Telegram."
          detail="It was retried with backoff and is not lost. Nothing was marked finished because of a send failure."
        />
      ) : null}
    </div>
  );
}

export function ChatDetail() {
  const ops = useOps();
  const { chatId } = useParams();

  if (!ops.data) {
    return (
      <PageState
        state={ops.error ? "error" : "loading"}
        title="Chat"
        error={ops.error}
        onRetry={ops.reload}
      />
    );
  }

  const chat = ops.data.chats.find((c) => c.id === chatId);
  if (!chat) {
    return (
      <PageState
        state="empty"
        title="Chat"
        empty={{ title: "Not on the books.", body: "That chat is not linked to this workspace." }}
      />
    );
  }

  const linked = chat.linkedRepoIds
    .map((id) => repoOf(ops.data!.repos, id))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="page">
      <PageHeader
        section="§ chats"
        title={chat.title}
        lede="Where a digest is sent. Preferences here are scoped to this chat, not to your account — the same repo can behave differently in two chats."
      />

      <div className="entries">
        <Entry
          label="Verification"
          control={chat.status === "VERIFIED" ? <Stamp>VERIFIED</Stamp> : <span className="hatch">CHECK</span>}
          hint={chat.status === "VERIFIED" ? "Bot identity confirmed." : "Not confirmed. Digests are held until it is."}
        />
        <Entry label="Kind" control={<span className="num">{chat.kind}</span>} />
        <Entry
          label="Members"
          control={<span className="num">{chat.members ?? "—"}</span>}
          hint="Telegram does not expose a member count for this chat."
        />
        <Entry label="Linked repositories" control={<span className="num">{chat.linkedRepoIds.length}</span>} />
      </div>

      <section>
        <h2 className="grouped__title">Linked repositories</h2>
        <LedgerTable
          caption="Repositories linked to this chat"
          rows={linked}
          rowKey={(r) => r.id}
          columns={[
            { key: "repo", head: "Repo", render: (r) => <Link to={`/app/repos/${r.id}`}>{r.fullName}</Link> },
            {
              key: "pts",
              head: "pts",
              numeric: true,
              render: (r) => `${r.pointsFinished} / ${r.pointsTotal}`,
            },
            {
              key: "needs",
              head: "needs decision",
              numeric: true,
              render: (r) => r.needsDecision,
            },
          ]}
        />
      </section>

      {chat.lastMessageAt === null ? (
        <Notice kind="info" title="No message has been sent to this chat yet." detail="The first digest will be the daily one." />
      ) : null}
    </div>
  );
}
