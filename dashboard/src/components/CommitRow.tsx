/**
 * One commit. Commits are activity, and this row never implies otherwise: no
 * percentage, no progress device, no counter of any kind lives here.
 *
 * The row is one line: category, subject, sha, task. Everything else — the
 * original message, the summary feedback, a suggested task — is detail, and
 * detail lives behind a toggle. A list of twenty commits used to be sixty
 * lines tall and repeated "Suggestions are never applied on their own." once
 * per row; the sentence that matters now appears once, on the list itself.
 *
 * Rules it keeps (brief §7.1): category shown with a glyph AND a word; a
 * suggested task is a link that must be accepted, never applied; the SHA is
 * monospace and links to GitHub.
 */
import { useId, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { Commit, Issue } from "../api/types.js";
import { CategoryGlyph, categoryLabel } from "./glyphs.js";
import { Button, IconButton } from "./controls.js";
import { shortSha } from "../lib/format.js";

export function CommitRow({
  commit,
  repoFullName,
  suggestion,
  onAcceptSuggestion,
}: {
  commit: Commit;
  repoFullName: string;
  suggestion?: Issue | null;
  onAcceptSuggestion?: (issueNumber: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const detailId = useId();
  const commitUrl = `https://github.com/${repoFullName}/commit/${commit.sha}`;
  const issueUrl = commit.issueNumber
    ? `https://github.com/${repoFullName}/issues/${commit.issueNumber}`
    : null;

  const subject = commit.secretFlag ? "Secret flagged, skipped" : (commit.aiSummary ?? commit.message);
  const hasDetail = Boolean(
    !commit.secretFlag &&
      ((commit.aiSummary && commit.message.trim() !== commit.aiSummary.trim()) ||
        commit.body ||
        (!issueUrl && (suggestion || !commit.secretFlag))),
  );

  return (
    <li className="row" data-expanded={open ? "true" : "false"}>
      <span className="row__cat">
        <CategoryGlyph category={commit.category} />
        {categoryLabel(commit.category)}
      </span>

      <span className="row__subject" data-truncate="true" title={subject}>
        {commit.secretFlag ? <span className="mark mark--danger">{subject}</span> : subject}
      </span>

      <a
        className="code row__sha"
        href={commitUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open commit ${shortSha(commit.sha)} on GitHub`}
      >
        {shortSha(commit.sha)}
      </a>

      {issueUrl ? (
        <a
          className="row__task"
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Task {commit.issueNumber}
        </a>
      ) : (
        <span className="row__task row__task--unlinked">Unlinked</span>
      )}

      {hasDetail ? (
        <button
          type="button"
          className="btn btn--inline row__toggle"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "Details"}
        </button>
      ) : null}

      {open && hasDetail ? (
        <div className="row__detail" id={detailId}>
          {commit.isMerge ? (
            <p className="small muted">Merged, no summary was written for this one.</p>
          ) : null}

          {commit.aiSummary && commit.message.trim() !== commit.aiSummary.trim() ? (
            <p className="row__original">
              <span className="micro muted">Commit message</span>
              <br />
              {commit.message}
            </p>
          ) : null}

          {commit.body ? <p className="row__original">{commit.body}</p> : null}

          {commit.aiSummary ? (
            <p className="row__feedback">
              <span className="micro muted">AI summary</span>
              <IconButton
                label={feedback === "up" ? "Summary marked helpful" : "Mark this summary helpful"}
                aria-pressed={feedback === "up"}
                onClick={() => setFeedback(feedback === "up" ? null : "up")}
              >
                <ThumbsUp size={14} strokeWidth={1.6} aria-hidden="true" />
              </IconButton>
              <IconButton
                label={feedback === "down" ? "Summary marked unhelpful" : "Mark this summary unhelpful"}
                aria-pressed={feedback === "down"}
                onClick={() => setFeedback(feedback === "down" ? null : "down")}
              >
                <ThumbsDown size={14} strokeWidth={1.6} aria-hidden="true" />
              </IconButton>
              {feedback ? (
                <span className="micro muted" role="status">
                  Thanks, noted.
                </span>
              ) : null}
            </p>
          ) : null}

          {!issueUrl ? (
            suggestion ? (
              <p className="row__suggest">
                <span>
                  Suggested task: <strong>Task {suggestion.number}</strong> {suggestion.title}
                </span>
                <Button
                  variant="quiet"
                  onClick={() => onAcceptSuggestion?.(suggestion.number)}
                  disabled={!onAcceptSuggestion}
                >
                  Accept
                </Button>
              </p>
            ) : (
              <p className="small muted">No task is suggested for this commit yet.</p>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
