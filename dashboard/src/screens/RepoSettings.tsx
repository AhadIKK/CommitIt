/**
 * Repository settings. Webhook health first, because a repo whose webhook is
 * failing shows nothing anywhere else and the fix is one copy-paste. Then what
 * CommitIt is allowed to do, then the one destructive action, kept away from
 * everything else.
 */
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { RepoSettings as RepoSettingsModel } from "../api/types.js";
import { api } from "../api/index.js";
import { Banner, LiveBar, Skeleton, StatePanel } from "../components/surfaces.js";
import { Button, Switch } from "../components/controls.js";
import { screenState, useRepoRef, useSettings } from "../lib/queries.js";
import { useLive } from "../lib/useLive.js";
import { relativeTime } from "../lib/format.js";
import { DIGEST_MODE_LABEL } from "../lib/digest.js";

function WebhookRow({ settings, onCopied }: { settings: RepoSettingsModel; onCopied: (ok: boolean) => void }) {
  const { webhook } = settings.repo;
  return (
    <div className="kv">
      <span className="kv__key">Webhook URL</span>
      <span className="kv__value code wrap-anywhere">{webhook.expectedUrl}</span>

      <span className="kv__key">Copy this URL</span>
      <span className="kv__value">
        <Button
          variant="quiet"
          onClick={() => {
            navigator.clipboard?.writeText(webhook.expectedUrl).then(
              () => onCopied(true),
              () => onCopied(false),
            );
          }}
        >
          Copy URL
        </Button>
      </span>

      <span className="kv__key">Last delivery</span>
      <span className="kv__value">
        {webhook.lastDeliveryAt ? (
          <>
            {relativeTime(webhook.lastDeliveryAt)}
            {webhook.lastDeliveryStatus === "failed" ? (
              <span className="mark mark--danger" style={{ marginLeft: "var(--space-3)" }}>
                failed
              </span>
            ) : (
              <span className="mark mark--muted" style={{ marginLeft: "var(--space-3)" }}>
                delivered
              </span>
            )}
          </>
        ) : (
          "nothing yet"
        )}
      </span>
    </div>
  );
}

export function RepoSettings() {
  const { ref, repoId } = useRepoRef();
  const query = useSettings(repoId);
  const live = useLive(repoId);
  const repoQuery = `?repo=${encodeURIComponent(ref)}`;
  const { data, status, error, retry, refetching } = screenState<RepoSettingsModel>(
    query,
    (settings) => settings.subscription === null,
  );

  const ai = useMutation({
    mutationFn: (enabled: boolean) => api.setAiEnabled(repoId, enabled),
    onSuccess: () => void query.refetch(),
  });
  const disconnect = useMutation({
    mutationFn: () => api.disconnect(repoId),
  });

  if (status === "loading") {
    return (
      <div className="screen" aria-busy="true">
        <h1 className="display">Repository settings</h1>
        <Skeleton variant="line" width="100%" height="9rem" />
        <span className="visually-hidden">Loading repository settings.</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen">
        <h1 className="display">Repository settings</h1>
        <Banner
          severity="danger"
          urgent
          title="We could not load the settings"
          detail={error ?? "The API is not answering."}
          actions={<Button onClick={retry} loading={refetching} loadingLabel="Trying again…">Try again</Button>}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="screen">
        <h1 className="display">Repository settings</h1>
        <StatePanel title="This repository is not here." body="It may have been disconnected." />
      </div>
    );
  }

  const { repo, subscription } = data;

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="display">{repo.fullName}</h1>
        <p className="screen__lede">
          Everything CommitIt knows about this repository and everything you have let it do.
        </p>
      </div>

      {repo.unreadable ? (
        <Banner
          severity="danger"
          urgent
          title="GitHub will not let us read this repository"
          detail="The CommitIt app may have been uninstalled or its access removed. Reconnect it to start receiving work again."
          actions={
            <Link className="btn btn--primary" to={`/connect/github${repoQuery}`}>
              Reconnect GitHub
            </Link>
          }
        />
      ) : null}

      {!repo.webhook.ok ? (
        <Banner
          severity="danger"
          urgent
          title="GitHub could not deliver the last webhook"
          detail={`Add the webhook URL below in this repository's GitHub settings, and set the secret to match. The last attempt ${
            repo.webhook.lastDeliveryAt ? `failed ${relativeTime(repo.webhook.lastDeliveryAt)}` : "never arrived"
          }.`}
        />
      ) : null}

      <LiveBar status={live.status} lastUpdated={live.lastUpdated} newActivity={live.newActivity} />

      <section aria-labelledby="webhook-heading">
        <div className="section-head">
          <h2 className="section-head__title" id="webhook-heading">
            Webhook
          </h2>
          <span className="section-head__meta">
            {repo.webhook.ok ? "delivering" : "needs attention"}
          </span>
        </div>
        <WebhookRow settings={data} onCopied={(ok) => void ok} />
      </section>

      <section aria-labelledby="ai-heading">
        <div className="section-head">
          <h2 className="section-head__title" id="ai-heading">
            AI summaries
          </h2>
        </div>
        <div className="setting">
          <div className="setting__body">
            <p className="setting__title">Summarise commits</p>
            <p className="setting__detail">
              A short summary of each commit, written before it reaches your chat. A possible secret is
              scanned out first: any matching file is skipped entirely, never summarised, never stored, and
              named by path only in the alert.
            </p>
          </div>
          <Switch
            checked={data.aiEnabled}
            disabled={!data.aiAvailable || ai.isPending}
            onChange={(next) => ai.mutate(next)}
            label={ai.isPending ? "Saving…" : data.aiEnabled ? "On" : "Off"}
          />
        </div>
        {!data.aiAvailable ? (
          <p className="small muted">
            No AI provider is configured for this account yet, so summaries stay off. Add one to turn this on.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="chat-heading">
        <div className="section-head">
          <h2 className="section-head__title" id="chat-heading">
            Connected chat
          </h2>
        </div>
        {subscription ? (
          <div className="kv">
            <span className="kv__key">Chat</span>
            <span className="kv__value">{subscription.chatTitle}</span>
            <span className="kv__key">Digest</span>
            <span className="kv__value">
              {DIGEST_MODE_LABEL[subscription.mode]}
              {subscription.muted ? ", paused" : ""}
            </span>
            <span className="kv__key">Change</span>
            <span className="kv__value">
              <Link className="btn btn--inline" to={`/digests${repoQuery}`}>
                Digest settings
              </Link>
            </span>
          </div>
        ) : (
          <StatePanel
            title="No chat connected."
            body="Link a Telegram chat and this repository's work starts arriving there."
            action={
              <Link className="btn btn--primary" to={`/connect/telegram${repoQuery}`}>
                Link a chat
              </Link>
            }
          />
        )}
      </section>

      <section className="danger-zone" aria-labelledby="danger-heading">
        <div className="section-head" style={{ borderTop: 0, paddingTop: 0 }}>
          <h2 className="section-head__title" id="danger-heading">
            Disconnect
          </h2>
        </div>
        <div className="setting" style={{ borderTop: 0 }}>
          <div className="setting__body">
            <p className="setting__title">Stop tracking {repo.fullName}</p>
            <p className="setting__detail">
              CommitIt stops reading this repository and stops sending its digests. The repository on GitHub
              is not touched, and nothing already in your chat changes.
            </p>
          </div>
          <Button
            variant="danger"
            onClick={() => disconnect.mutate()}
            loading={disconnect.isPending}
            loadingLabel="Disconnecting…"
          >
            Disconnect this repository
          </Button>
        </div>
        {disconnect.isSuccess ? (
          <p className="small" role="status">
            {repo.fullName} is disconnected. You can connect it again whenever you like.
          </p>
        ) : null}
        {disconnect.isError ? (
          <p className="small" role="alert">
            Not disconnected. The request did not reach the server. Try again.
          </p>
        ) : null}
      </section>
    </div>
  );
}
