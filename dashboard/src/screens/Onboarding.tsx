/**
 * Onboarding. Five short steps, numbered — the only place in the product where a
 * number marks a position. Each step does exactly one thing, says what will
 * happen, and hands over to the next.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { ConnectStep, DigestMode } from "../api/types.js";
import { api } from "../api/index.js";
import { Banner, Skeleton, StatePanel } from "../components/surfaces.js";
import { Button, SegmentedControl } from "../components/controls.js";
import { useMe, useRepoRef } from "../lib/queries.js";
import { DIGEST_MODE_LABEL } from "../lib/digest.js";

const ORDER: ConnectStep[] = ["github", "repo", "telegram", "digest", "test"];
const POSITION: Record<ConnectStep, number> = { github: 1, repo: 2, telegram: 3, digest: 4, test: 5 };

const COPY: Record<ConnectStep, { title: string; body: string }> = {
  github: {
    title: "Give CommitIt read access to GitHub",
    body: "Install the CommitIt app on the account that owns your repository. It asks for read access to code metadata, pull requests and issues, and nothing else.",
  },
  repo: {
    title: "Choose the repository to watch",
    body: "Pick one repository. You can add more later, and each one gets its own chat.",
  },
  telegram: {
    title: "Link the Telegram chat",
    body: "Open the bot, tap start, and the chat is linked. Everything after this is decided per chat, not per person.",
  },
  digest: {
    title: "Decide how often it speaks",
    body: "Pick a rhythm. It can be changed at any time from Digest settings.",
  },
  test: {
    title: "Send one real digest",
    body: "This sends the next digest now, so you can see what will land in the chat before you rely on it.",
  },
};

const MODE_OPTIONS: Array<{ value: DigestMode; label: string; hint: string }> = [
  { value: "instant", label: DIGEST_MODE_LABEL.instant, hint: "every push, at once" },
  { value: "hourly", label: "Hourly", hint: "one message an hour" },
  { value: "daily", label: "Daily", hint: "one message a day" },
  { value: "weekly", label: "Weekly", hint: "one message a week" },
];

export function Onboarding() {
  const { step: rawStep } = useParams();
  const step: ConnectStep = (ORDER as string[]).includes(rawStep ?? "") ? (rawStep as ConnectStep) : "github";
  const navigate = useNavigate();
  const { ref, repoId } = useRepoRef();
  const me = useMe();

  const [chosenRepo, setChosenRepo] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; deepLink: string; pollToken: string } | null>(null);
  const [linked, setLinked] = useState(false);
  const [mode, setMode] = useState<DigestMode>("daily");
  const [waitingForSeconds, setWaitingForSeconds] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);

  const start = useMutation({ mutationFn: () => api.startGitHub() });
  const choose = useMutation({ mutationFn: (fullName: string) => api.chooseRepo(fullName) });
  const startLink = useMutation({ mutationFn: (repoRef?: string) => api.startTelegramLink(repoRef) });
  const saveMode = useMutation({
    mutationFn: (next: DigestMode) => api.saveOnboardingMode(next, ref),
  });
  const sendTest = useMutation({ mutationFn: () => api.sendTestDigest(repoId) });

  /* the repo list is read again when the step opens: the install may have
     happened in another tab a moment ago */
  useEffect(() => {
    if (step === "repo") void me.refetch();
  }, [step]);

  /* the link step polls until the bot sees the tap, and gives up gracefully */
  useEffect(() => {
    if (step !== "telegram" || !link || linked) return;
    if (startedAt.current === null) startedAt.current = Date.now();
    const poll = setInterval(async () => {
      setWaitingForSeconds(Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000));
      try {
        const result = await api.pollTelegramLink(link.pollToken);
        if (result.linked) setLinked(true);
      } catch {
        /* keep waiting: a failed poll is not a failure of the link */
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [step, link, linked]);

  const steps = (
    <ol className="steps">
      {ORDER.map((key) => {
        const position = POSITION[key];
        const done = position < POSITION[step];
        return (
          <li
            className="step"
            key={key}
            aria-current={key === step ? "step" : undefined}
            data-state={done ? "done" : undefined}
          >
            <span className="step__number" aria-hidden="true">
              {position}
            </span>
            <div>
              <p className="step__title">
                {COPY[key].title}
                {done ? <span className="visually-hidden"> — done</span> : null}
              </p>
              <p className="step__body">{COPY[key].body}</p>

              {key === step ? (
                <div className="step__action">{renderAction()}</div>
              ) : done ? (
                <p className="step__body" role="status">
                  Done.
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );

  function go(next: ConnectStep) {
    navigate(`/connect/${next}?repo=${encodeURIComponent(ref)}`);
  }

  function renderAction() {
    switch (step) {
      case "github":
        return (
          <>
            <Button
              onClick={() =>
                start.mutate(undefined, {
                  onSuccess: (result) => {
                    // The App can only be granted on GitHub. Open it beside this
                    // wizard, then move on: the repo step re-reads the list.
                    window.open(result.url, "_blank", "noopener,noreferrer");
                    go("repo");
                  },
                })
              }
              loading={start.isPending}
              loadingLabel="Opening GitHub…"
            >
              Connect GitHub
            </Button>
            {start.isError ? (
              <span className="small" role="alert">
                GitHub could not be reached. Check your connection and try again.
              </span>
            ) : null}
          </>
        );

      case "repo": {
        const repos = me.data?.repos ?? [];
        if (me.isPending) return <Skeleton variant="line" width="12rem" />;
        if (repos.length === 0) {
          return (
            <StatePanel
              title="No repositories found on this account."
              body="The CommitIt app is installed, but it cannot see any repository yet. Grant access to at least one, then come back."
              action={
                <Button variant="quiet" onClick={() => start.mutate()} loading={start.isPending} loadingLabel="Opening GitHub…">
                  Resend GitHub access
                </Button>
              }
            />
          );
        }
        return (
          <>
            <ul className="stack--tight">
              {repos.map((r) => (
                <li key={r.id}>
                  <label className="check">
                    <input
                      type="radio"
                      name="repo"
                      checked={chosenRepo === r.fullName}
                      onChange={() => setChosenRepo(r.fullName)}
                    />
                    <span className="code">{r.fullName}</span>
                  </label>
                </li>
              ))}
            </ul>
            <Button
              disabled={!chosenRepo || choose.isPending}
              onClick={() =>
                choose.mutate(chosenRepo as string, {
                  onSuccess: () => {
                    if (chosenRepo) navigate(`/connect/telegram?repo=${encodeURIComponent(chosenRepo)}`);
                  },
                })
              }
              loading={choose.isPending}
              loadingLabel="Saving…"
            >
              Watch this repository
            </Button>
          </>
        );
      }

      case "telegram":
        if (linked) {
          return (
            <>
              <p className="small" role="status">
                Chat linked.
              </p>
              <Button onClick={() => go("digest")}>Choose a rhythm</Button>
            </>
          );
        }
        if (!link) {
          return (
            <Button
              onClick={() => startLink.mutate(ref, { onSuccess: (l) => setLink(l) })}
              loading={startLink.isPending}
              loadingLabel="Opening Telegram…"
            >
              Link Telegram
            </Button>
          );
        }
        return (
          <div className="step__panel">
            <p className="small">
              Open the bot and tap start. Or paste this code into the chat:{" "}
              <strong className="code">{link.code}</strong>
            </p>
            <p>
              <a className="btn btn--primary" href={link.deepLink} target="_blank" rel="noopener noreferrer">
                Open Telegram
              </a>
            </p>
            <p className="small muted" role="status">
              {waitingForSeconds >= 60
                ? "Still waiting for Telegram. If nothing happens, paste the code above into the chat by hand."
                : `Waiting for Telegram… ${waitingForSeconds}s`}
            </p>
          </div>
        );

      case "digest":
        return (
          <>
            <SegmentedControl<DigestMode>
              legend="How often should the chat hear from CommitIt?"
              value={mode}
              options={MODE_OPTIONS}
              onChange={setMode}
            />
            <Button
              onClick={() => saveMode.mutate(mode, { onSuccess: () => go("test") })}
              loading={saveMode.isPending}
              loadingLabel="Saving…"
            >
              Save and continue
            </Button>
          </>
        );

      case "test":
        return (
          <>
            {sent ? (
              <>
                <p className="small" role="status">
                  {sent}
                </p>
                <Link className="btn btn--primary" to={`/today?repo=${encodeURIComponent(ref)}`}>
                  Go to today
                </Link>
              </>
            ) : (
              <Button
                onClick={() =>
                  sendTest.mutate(undefined, {
                    onSuccess: (result) =>
                      setSent(
                        result.ok
                          ? `Sent to ${result.chatTitle}. Look for it in the chat.`
                          : "Not sent: Telegram was unreachable. Try again in a moment.",
                      ),
                  })
                }
                loading={sendTest.isPending}
                loadingLabel="Sending…"
              >
                Send a test digest
              </Button>
            )}
          </>
        );
    }
  }

  /* what is known about the account, and what that disables */
  const blocked: string | null = me.isError ? "We could not read your account, so the later steps are held." : null;

  return (
    <div className="screen onboarding">
      <div className="screen__head">
        <h1 className="display">Connect a repository</h1>
        <p className="screen__lede">
          Five steps, in order: each one unlocks when the step above it is done. Nothing is sent to a chat
          until the last one, and the test message is real.
        </p>
      </div>

      {blocked ? (
        <Banner
          severity="warn"
          title="Some steps are held"
          detail={blocked}
          actions={<Button variant="quiet" onClick={() => void me.refetch()}>Try again</Button>}
        />
      ) : null}

      <p className="visually-hidden">
        Step {POSITION[step]} of 5: {COPY[step].title}
      </p>

      {steps}

      <p className="small muted">
        <Link className="btn btn--inline" to="/">
          Back to the front page
        </Link>
      </p>
    </div>
  );
}
