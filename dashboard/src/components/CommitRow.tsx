/**
 * One commit. Commits are activity, and this row never implies otherwise: no
 * percentage, no progress device, no counter of any kind lives here.
 *
 * Rules it keeps (brief §7.1): category shown with a glyph AND a word; an AI
 * summary is the main line, labelled, with feedback, and the original message
 * sits below it; the SHA is monospace and links to GitHub; a linked task is a
 * link, unlinked work offers a suggestion that must be accepted, never applied.
 */
import { useState } from "react";
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
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const commitUrl = `https://github.com/${repoFullName}/commit/${commit.sha}`;
  const issueUrl = commit.issueNumber
    ? `https://github.com/${repoFullName}/issues/${commit.issueNumber}`
    : null;

  return (
    <li className="row">
      <span className="row__cat">
        <CategoryGlyph category={commit.category} />
        {categoryLabel(commit.category)}
      </span>

      <span className="row__subject">
        {commit.secretFlag ? (
          <span className="mark mark--danger">
            Secret flagged, skipped
          </span>
        ) : null}

        {commit.aiSummary ? (
          <>
            <span className="row__ai">{commit.aiSummary}</span>
            <span className="row__feedback">
              <span className="micro muted">AI summary</span>
              <IconButton
                label={feedback === "up" ? "Summary marked helpful" : "Mark this summary helpful"}
                aria-pressed={feedback === "up"}
                onClick={() => setFeedback(feedback === "up" ? null : "up")}
                style={{ width: "2rem", height: "2rem" }}
              >
                <ThumbsUp size={14} strokeWidth={1.6} aria-hidden="true" />
              </IconButton>
              <IconButton
                label={feedback === "down" ? "Summary marked unhelpful" : "Mark this summary unhelpful"}
                aria-pressed={feedback === "down"}
                onClick={() => setFeedback(feedback === "down" ? null : "down")}
                style={{ width: "2rem", height: "2rem" }}
              >
                <ThumbsDown size={14} strokeWidth={1.6} aria-hidden="true" />
              </IconButton>
              {feedback ? (
                <span className="micro muted" role="status">
                  Thanks, noted.
                </span>
              ) : null}
            </span>
            {commit.message.trim() && commit.message.trim() !== commit.aiSummary.trim() ? (
              <span className="row__original">Original: {commit.message}</span>
            ) : null}
          </>
        ) : (
          <>
            <span className="row__ai">{commit.message}</span>
            {commit.isMerge ? <span className="row__original">Merged, no summary written.</span> : null}
          </>
        )}

        {commit.body ? <span className="row__original">{commit.body}</span> : null}
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

      {!issueUrl && !commit.secretFlag ? (
        <span className="row__suggest">
          {suggestion ? (
            <>
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
              <span className="muted">Suggestions are never applied on their own.</span>
            </>
          ) : (
            <span className="muted">No task suggested for this commit yet.</span>
          )}
        </span>
      ) : null}
    </li>
  );
}
