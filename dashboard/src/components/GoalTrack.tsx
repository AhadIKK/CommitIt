/**
 * The Goal Track — the one memorable element, and the reason this redesign
 * exists. One node per task, echoing the logo: two nodes joined by a line.
 *
 *   - node size encodes weight (S = 1, M = 3, L = 5)
 *   - a finished task is a solid node in --ink; an open task is a hollow ring
 *   - a task closed since you last looked carries the one teal dot
 *   - the line fills up to the last closed task in closing order, so a reopened
 *     task honestly moves the line back
 *   - the percentage in the sentence beside it comes from the API and is never
 *     computed from commits
 *
 * Desktop is a horizontal track; the same component rotates into a vertical
 * rail with task titles beside the nodes, like `git log --graph`, on mobile.
 */
import { useState, type ReactNode } from "react";
import type { Author, Issue, Milestone } from "../api/types.js";
import { trackFillPercent, trackNodes, weightName, type TrackNodeModel } from "../lib/weight.js";
import { useOncePerSession } from "../lib/useOnce.js";
import { StatePanel } from "./surfaces.js";

export type GoalTrackProps = {
  milestone: Milestone;
  issues: Issue[];
  orientation: "horizontal" | "vertical";
  /** Task numbers closed since the person last looked: shows the teal dot. */
  newSince?: number[];
  authors?: Author[];
  /** Where a node goes when it is opened. Omit on the landing demo. */
  issueHref?: (issue: Issue) => string;
  /** Commits linked to each task number, for the inspector line. */
  linkedCounts?: Record<number, number>;
  caption?: ReactNode;
  /** Invitation shown when the goal has no tasks at all. */
  emptyAction?: ReactNode;
};

function weightText(node: TrackNodeModel): string {
  if (!node.estimated) return "Unestimated, counts as 1 point";
  return `${node.sizeLabel} — ${node.weight} points`;
}

function stateText(node: TrackNodeModel): string {
  if (node.issue.reopenedAt && node.state === "open") return "Reopened";
  return node.state === "closed" ? "Closed" : "Open";
}

export function GoalTrack({
  milestone,
  issues,
  orientation,
  newSince = [],
  authors = [],
  issueHref,
  linkedCounts = {},
  caption,
  emptyAction,
}: GoalTrackProps) {
  const [active, setActive] = useState<TrackNodeModel | null>(null);
  const animate = useOncePerSession(`track-filled:${milestone.id}`);

  if (issues.length === 0) {
    return (
      <StatePanel
        title={`${milestone.title} has no tasks yet.`}
        body="Create issues on GitHub and add them to this milestone. Every task you add appears here as a node."
        action={emptyAction}
      />
    );
  }

  const nodes = trackNodes(issues);
  const fill = trackFillPercent(nodes);
  const authorName = (id?: string | null) => authors.find((a) => a.id === id)?.login ?? "nobody yet";

  const inspector = active ? (
    <div className="track__inspector">
      <p className="track__inspector-title">
        Task {active.issue.number}: {active.issue.title}
      </p>
      <p className="small muted">
        {stateText(active)}. {weightText(active)}. Assigned to {authorName(active.issue.assigneeId)}.
        {linkedCounts[active.issue.number]
          ? ` ${linkedCounts[active.issue.number]} linked commit${
              linkedCounts[active.issue.number] === 1 ? "" : "s"
            }.`
          : " No linked commits yet."}
      </p>
    </div>
  ) : (
    <div className="track__inspector">
      <p className="small muted">
        {orientation === "horizontal"
          ? "Focus or hover a node to see the task."
          : "Each node is one task."}{" "}
        A solid node is finished; a hollow ring is still open.
      </p>
    </div>
  );

  return (
    <div className="goal-track">
      <div className="track-scroll" data-orientation={orientation}>
        <ul
          className="track"
          role="list"
          data-orientation={orientation}
          data-filled={animate ? "true" : "false"}
          style={{ ["--track-fill" as string]: `${fill}%` }}
          aria-label={`${milestone.title} tasks, ${nodes.length} in closing order`}
        >
          <span className="track__rail" aria-hidden="true">
            <span className="track__line" />
            <span className="track__fill" />
          </span>
          {nodes.map((node) => {
          const isNew = newSince.includes(node.issue.number);
          const href = issueHref?.(node.issue);
          const inner = (
            <>
              <span className="track__dot" />
              {orientation === "vertical" ? (
                <span className="track__label">
                  <span className="track__number">{node.issue.number}</span>
                  <span className="track__title">{node.issue.title}</span>
                  <span className="track__weight">{node.sizeLabel ?? "unestimated"}</span>
                  {isNew ? <span className="is-new">New</span> : null}
                </span>
              ) : null}
            </>
          );
          const shared = {
            "data-weight": node.weight,
            "data-state": node.state,
            "data-estimated": node.estimated,
            "data-new": isNew,
            "aria-label": `${node.accessibleName}${isNew ? ", newly closed" : ""}`,
            onFocus: () => setActive(node),
            onMouseEnter: () => setActive(node),
            onMouseLeave: () => setActive(null),
            onBlur: () => setActive(null),
          };
          return (
            <li key={node.issue.number} className="track__item">
              {href ? (
                <a
                  className="track__node"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...shared}
                >
                  {inner}
                </a>
              ) : (
                <button type="button" className="track__node" {...shared}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
        </ul>
      </div>
      {caption ? <div className="track-caption">{caption}</div> : null}
      {inspector}
    </div>
  );
}
