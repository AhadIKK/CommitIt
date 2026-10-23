/**
 * Detail routes that hang off the two ledgers: one digest, one chat.
 * Both re-state the same rule as their parent â€” a digest's headline is a
 * point count, and the activity line under it is explicitly labelled.
 */
import { Link, useParams } from "react-router-dom";
import { Entry, LedgerTable, Notice, Slip, Stamp, Badge } from "../components/kit.js";
import { PageHeader, PageState } from "./Shell.js";
import { CHATS, DIGESTS, REPOS, repoById } from "./seed.js";

export function DigestDetail() {
  const { digestId } = useParams();
  const digest = DIGESTS.find((d) => d.id === digestId);

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

  const repo = REPOS.find((r) => r.id === digest.repoId);

  return (
    <div className="page">
      <PageHeader
        section="Â§ digests"
        title={`${repo?.fullName ?? "repo"} Â· ${digest.cadence} digest`}
        lede="What was sent, exactly as it was sent. Reopening a task gives the points back on the next digest, not this one."
      />

      <div className="split2">
        <div className="tally">
          <p className="tally__figure">
            {digest.pointsFinished}
            <span className="tally__unit">points finished</span>
          </p>
          <p className="tally__activity">
            {digest.messageCount} messages. Activity, not progress.
          </p>
        </div>

        <aside className="side">
          <h2 className="side__title">Delivery</h2>
          <p className="side__note num">{digest.sentAt}</p>
          <p className="side__note">
            {digest.status === "DELIVERED" ? <Stamp>DELIVERED</Stamp> : null}
            {digest.status === "BATCHED" ? <Badge>batched</Badge> : null}
            {digest.status === "RESCHEDULED" ? <Badge>rescheduled</Badge> : null}
            {digest.status === "FAILED" ? <span className="err-prefix">ERR</span> : null}
          </p>
          <p className="side__note">
            <Link to="/app/digests">All digests</Link>
          </p>
        </aside>
      </div>

      <Slip title={`as sent Â· ${digest.chatTitle}`}>
        <p className="slip-line">
          <strong>Finished</strong> â€” Rate limit the webhook (+1), Requeue orphaned jobs (+3).
        </p>
        <p className="slip-line">
          <strong>Moved</strong> â€” {digest.messageCount} messages, 4 unlinked. Activity, not progress.
        </p>
        {digest.needsDecision > 0 ? (
          <p className="slip-line">
            <strong>Decision</strong> â€” Task 17 was reopened after merge. Worth 5 points.
          </p>
        ) : (
          <p className="slip-line">No decisions pending.</p>
        )}
        <p className="slip-meta num">quiet hours reschedule Â· nothing dropped</p>
      </Slip>

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
  const { chatId } = useParams();
  const chat = CHATS.find((c) => c.id === chatId);

  if (!chat) {
    return (
      <PageState
        state="empty"
        title="Chat"
        empty={{ title: "Not on the books.", body: "That chat is not linked to this workspace." }}
      />
    );
  }

  const linked = REPOS.filter((r) => r.connected).slice(0, chat.linkedRepos);

  return (
    <div className="page">
      <PageHeader
        section="Â§ chats"
        title={chat.title}
        lede="Where a digest is sent. Preferences here are scoped to this chat, not to your account â€” the same repo can behave differently in two chats."
      />

      <div className="entries">
        <Entry
          label="Verification"
          control={chat.status === "VERIFIED" ? <Stamp>VERIFIED</Stamp> : <span className="hatch">CHECK</span>}
          hint={chat.status === "VERIFIED" ? "Bot identity confirmed." : "Not confirmed. Digests are held until it is."}
        />
        <Entry label="Kind" control={<span className="num">{chat.kind}</span>} />
        <Entry label="Members" control={<span className="num">{chat.members ?? "â€”"}</span>} />
        <Entry label="Linked repositories" control={<span className="num">{chat.linkedRepos}</span>} />
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

      {chat.lastMessage === null ? (
        <Notice kind="info" title="No message has been sent to this chat yet." detail="The first digest will be the daily one." />
      ) : null}
    </div>
  );
}