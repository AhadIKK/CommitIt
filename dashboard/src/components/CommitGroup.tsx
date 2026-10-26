/**
 * An author's commits, between two hairlines. No card, no border: the rule that
 * separates them starts at the node column, so the same line that carries the
 * Goal Track carries the activity list too.
 */
import { useState } from "react";
import type { Author, Commit, Issue } from "../api/types.js";
import { CommitRow } from "./CommitRow.js";
import { Avatar } from "./surfaces.js";
import { Button } from "./controls.js";

const REVEAL_AT = 5;

export function CommitGroup({
  author,
  commits,
  repoFullName,
  suggestions,
  onAcceptSuggestion,
}: {
  author: Author;
  commits: Commit[];
  repoFullName: string;
  suggestions?: Record<number, Issue | null>;
  onAcceptSuggestion?: (commitSha: string, issueNumber: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflows = commits.length > REVEAL_AT + 1;
  const shown = expanded || !overflows ? commits : commits.slice(0, REVEAL_AT);

  return (
    <section className="group" aria-label={`${author.login}, ${commits.length} commits`}>
      <div className="group__head">
        <Avatar name={author.name ?? author.login} />
        <h3 className="group__name">{author.login}</h3>
        <span className="group__count num">
          {commits.length === 1 ? "1 commit" : `${commits.length} commits`}
        </span>
      </div>
      <ul className="commits">
        {shown.map((commit) => (
          <CommitRow
            key={commit.sha}
            commit={commit}
            repoFullName={repoFullName}
            suggestion={suggestions?.[commit.suggestedIssueNumber ?? -1] ?? null}
            onAcceptSuggestion={
              onAcceptSuggestion && commit.suggestedIssueNumber
                ? (n) => onAcceptSuggestion(commit.sha, n)
                : undefined
            }
          />
        ))}
      </ul>
      {overflows && !expanded ? (
        <p style={{ marginTop: "var(--space-3)" }}>
          <Button variant="inline" onClick={() => setExpanded(true)}>
            Show {commits.length - REVEAL_AT} more commits from {author.login}
          </Button>
        </p>
      ) : null}
    </section>
  );
}
