/**
 * Digests. The settings on the left, the exact message that would go out on the
 * right — rendered by the same function the backend would use, so the preview
 * cannot drift from the real thing. The counter shows the 3 800-character limit
 * a chat imposes.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { DigestMode, QuietHours, Subscription } from "../api/types.js";
import { api } from "../api/index.js";
import { Banner, Bubble, Skeleton, StatePanel } from "../components/surfaces.js";
import { Button, ErrorSummary, Field, SegmentedControl, Switch } from "../components/controls.js";
import { screenState, useDigests, usePeople, useRepoRef } from "../lib/queries.js";
import { DIGEST_MODE_LABEL } from "../lib/digest.js";
import { clockTime } from "../lib/format.js";

type EventKind = "commits" | "pull_requests" | "issues";

const EVENT_LABELS: Record<EventKind, string> = {
  commits: "Commits",
  pull_requests: "Pull requests",
  issues: "Issue changes",
};

const MODE_OPTIONS: Array<{ value: DigestMode; label: string; hint: string }> = [
  { value: "instant", label: DIGEST_MODE_LABEL.instant, hint: "every push, at once" },
  { value: "hourly", label: "Hourly", hint: "one message an hour" },
  { value: "daily", label: "Daily", hint: "one message a day" },
  { value: "weekly", label: "Weekly", hint: "one message a week" },
];

/** "1 842" — the brief's thousands separator. */
function spaced(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

export function Digests() {
  const { ref, repoId } = useRepoRef();
  const repoQuery = `?repo=${encodeURIComponent(ref)}`;

  const [mode, setMode] = useState<DigestMode>("daily");
  const modeTouched = useRef(false);

  const query = useDigests(repoId, mode);
  const people = usePeople(repoId);

  const { data, status, error, retry, refetching } = screenState(
    query,
    (d) => d.subscription === null,
  );

  const subscription = data?.subscription ?? null;

  /* form state, seeded from the server and re-seeded whenever it changes */
  const [quiet, setQuiet] = useState<QuietHours>({ enabled: false, from: "22:00", to: "07:00" });
  const [muted, setMuted] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchDraft, setBranchDraft] = useState("");
  const [authorIds, setAuthorIds] = useState<string[]>([]);
  const [events, setEvents] = useState<EventKind[]>(["commits", "pull_requests", "issues"]);
  const [errors, setErrors] = useState<Array<{ fieldId: string; message: string }>>([]);

  useEffect(() => {
    if (subscription && !modeTouched.current) setMode(subscription.mode);
  }, [subscription]);

  useEffect(() => {
    if (!subscription) return;
    setQuiet(subscription.quietHours);
    setMuted(subscription.muted);
    setBranches(subscription.filters.branches);
    setAuthorIds(subscription.filters.authors === "all" ? [] : subscription.filters.authors);
    setEvents(subscription.filters.events);
  }, [subscription]);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.saveDigest>[1]) => api.saveDigest(repoId, patch),
    onSuccess: () => void query.refetch(),
  });

  const test = useMutation({
    mutationFn: () => api.sendTestDigest(repoId),
  });

  function toggleEvent(kind: EventKind) {
    setEvents((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  }

  function toggleAuthor(id: string) {
    setAuthorIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function onSave() {
    const next: Array<{ fieldId: string; message: string }> = [];
    if (quiet.enabled && quiet.from === quiet.to) {
      next.push({ fieldId: "quiet-from", message: "Quiet hours start and end at the same time." });
    }
    if (events.length === 0) {
      next.push({ fieldId: "events-commits", message: "Choose at least one kind of event to report." });
    }
    setErrors(next);
    if (next.length > 0) {
      document.getElementById("digest-errors")?.focus();
      return;
    }
    save.mutate({
      mode,
      muted,
      quietHours: quiet,
      filters: { branches, authors: authorIds.length === 0 ? "all" : authorIds, events },
    } satisfies Partial<Subscription>);
  }

  if (status === "loading") {
    return (
      <div className="screen split" aria-busy="true">
        <div className="stack">
          <Skeleton variant="line" width="8rem" />
          <Skeleton variant="line-sm" width="60%" />
          <Skeleton variant="line-sm" width="45%" />
        </div>
        <div className="digest-preview">
          <Skeleton variant="line" width="100%" height="10rem" />
        </div>
        <span className="visually-hidden">Loading digest settings.</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen">
        <h1 className="display">Digests</h1>
        <Banner
          severity="danger"
          urgent
          title="We could not load the digest settings"
          detail={error ?? "The API is not answering."}
          actions={<Button onClick={retry} loading={refetching} loadingLabel="Trying again…">Try again</Button>}
        />
      </div>
    );
  }

  if (status === "empty" || !data) {
    return (
      <div className="screen">
        <h1 className="display">No chat connected yet</h1>
        <StatePanel
          title="No repo connected yet."
          body="Connect a repository and link a Telegram chat, and this screen becomes the place you decide how often it speaks."
          action={
            <Link className="btn btn--primary" to={`/connect/github${repoQuery}`}>
              Connect a repository
            </Link>
          }
        />
      </div>
    );
  }

  const overLimit = data.charCount > data.charLimit;
  const collapsed = /^\+\d+ more commits/m.test(data.preview.split("\n").pop() ?? "");
  const authorPool = people.data ?? [];

  return (
    <div className="screen">
      <h1 className="display">Digests</h1>

      <div className="split">
        <div className="stack">
          <SegmentedControl<DigestMode>
            legend="How often should this chat hear from CommitIt?"
            value={mode}
            options={MODE_OPTIONS}
            onChange={(next) => {
              modeTouched.current = true;
              setMode(next);
            }}
          />

          <div className="stack--tight">
            <div className="setting">
              <div className="setting__body">
                <p className="setting__title">Quiet hours</p>
                <p className="setting__detail">
                  Nothing is sent between these times. Anything that arrives is held and included in the
                  next digest.
                </p>
              </div>
              <Switch
                checked={quiet.enabled}
                onChange={(enabled) => setQuiet((q) => ({ ...q, enabled }))}
                label={quiet.enabled ? "On" : "Off"}
              />
            </div>

            {quiet.enabled ? (
              <div className="stack--tight">
                <Field id="quiet-from" label="Quiet from" hint="Times are in your chat's timezone.">
                  {(p) => (
                    <input
                      {...p}
                      className="field__input"
                      type="time"
                      value={quiet.from}
                      onChange={(e) => setQuiet((q) => ({ ...q, from: e.target.value }))}
                    />
                  )}
                </Field>
                <Field id="quiet-to" label="Quiet until">
                  {(p) => (
                    <input
                      {...p}
                      className="field__input"
                      type="time"
                      value={quiet.to}
                      onChange={(e) => setQuiet((q) => ({ ...q, to: e.target.value }))}
                    />
                  )}
                </Field>
              </div>
            ) : null}

            <div className="setting">
              <div className="setting__body">
                <p className="setting__title">Pause this chat</p>
                <p className="setting__detail">
                  Pausing stops every digest for {subscription?.chatTitle ?? "this chat"}. Nothing else
                  changes.
                </p>
              </div>
              <Switch checked={muted} onChange={setMuted} label={muted ? "Paused" : "Sending"} />
            </div>
          </div>

          <div className="stack--tight">
            <div className="section-head">
              <h2 className="section-head__title">Branches</h2>
              <span className="section-head__meta">all branches when empty</span>
            </div>
            {branches.length > 0 ? (
              <ul className="unlinked">
                {branches.map((branch) => (
                  <li className="unlinked__item" key={branch}>
                    <span className="code wrap-anywhere">{branch}</span>
                    <Button
                      variant="inline"
                      onClick={() => setBranches((prev) => prev.filter((b) => b !== branch))}
                      aria-label={`Remove ${branch} from the filter`}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Every branch is included.</p>
            )}
            <Field id="branch-add" label="Add a branch">
              {(p) => (
                <input
                  {...p}
                  className="field__input"
                  value={branchDraft}
                  placeholder="feat/auth"
                  onChange={(e) => setBranchDraft(e.target.value)}
                />
              )}
            </Field>
            <p>
              <Button
                variant="quiet"
                disabled={branchDraft.trim() === ""}
                onClick={() => {
                  const next = branchDraft.trim();
                  if (next && !branches.includes(next)) setBranches((prev) => [...prev, next]);
                  setBranchDraft("");
                }}
              >
                Add branch
              </Button>
            </p>
          </div>

          <div className="stack--tight">
            <div className="section-head">
              <h2 className="section-head__title">People</h2>
              <span className="section-head__meta">
                {authorIds.length === 0 ? "everyone" : `${authorIds.length} chosen`}
              </span>
            </div>
            {authorPool.length === 0 ? (
              <p className="small muted">No authors seen yet. Everyone is included.</p>
            ) : (
              <ul className="stack--tight">
                {authorPool.map((person) => (
                  <li key={person.author.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={authorIds.includes(person.author.id)}
                        onChange={() => toggleAuthor(person.author.id)}
                      />
                      <span>{person.author.login}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="small muted">Left empty, every author is reported.</p>
          </div>

          <div className="stack--tight">
            <div className="section-head">
              <h2 className="section-head__title">What to report</h2>
            </div>
            {(Object.keys(EVENT_LABELS) as EventKind[]).map((kind) => (
              <label className="check" key={kind}>
                <input
                  id={`events-${kind}`}
                  type="checkbox"
                  checked={events.includes(kind)}
                  onChange={() => toggleEvent(kind)}
                />
                <span>{EVENT_LABELS[kind]}</span>
              </label>
            ))}
          </div>

          <ErrorSummary id="digest-errors" errors={errors} />

          <div className="stack--tight">
            <p>
              <Button onClick={onSave} loading={save.isPending} loadingLabel="Saving…">
                Save settings
              </Button>
            </p>
            {save.isError ? (
              <Banner
                severity="danger"
                title="Settings were not saved"
                detail="The change did not reach the server. Your edits are still here, so nothing is lost."
              />
            ) : save.isSuccess ? (
              <p className="small" role="status">
                Settings saved.
              </p>
            ) : null}
          </div>

          <div className="stack--tight">
            <p>
              <Button
                variant="quiet"
                onClick={() => test.mutate()}
                loading={test.isPending}
                loadingLabel="Sending…"
              >
                Send test digest
              </Button>
            </p>
            {test.isSuccess ? (
              <p className="small" role="status">
                {test.data.ok
                  ? `Sent to ${test.data.chatTitle}, delivered ${clockTime(test.data.deliveredAt)}.`
                  : "Test digest not sent. Telegram was unreachable. Try again in a moment."}
              </p>
            ) : test.isError ? (
              <p className="small" role="status">
                Test digest not sent. Telegram was unreachable. Try again in a moment.
              </p>
            ) : null}
          </div>
        </div>

        <div className="digest-preview">
          <h2 className="section-head__title">The next message</h2>
          <p className="digest-preview__caption">
            This is the message itself, not a sketch of it. It goes to{" "}
            {subscription?.chatTitle ?? "your chat"}.
          </p>

          <Bubble
            meta={
              <>
                <span>{ref}</span>
                <span className="muted">·</span>
                <span>{DIGEST_MODE_LABEL[mode]}</span>
              </>
            }
          >
            {data.preview}
          </Bubble>

          <div className={`charcount${overLimit ? " charcount--over" : ""}`}>
            <span className="charcount__bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (data.charCount / data.charLimit) * 100)}%` }} />
            </span>
            <span>
              {spaced(data.charCount)} / {spaced(data.charLimit)} characters
            </span>
            {overLimit ? <span>over the limit: the tail is trimmed</span> : null}
          </div>

          {collapsed ? (
            <p className="small muted">
              The busiest pushes are collapsed into one line, and the tail becomes “+N more commits” with a
              compare link.
            </p>
          ) : null}

          <p className="small muted">
            <Link className="btn btn--inline" to={`/repos${repoQuery}`}>
              Repository settings
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
