import { useEffect, useState } from "react";
import { fetchMe, fetchMeta, fetchRepoProfile, logout, syncMyInstalls, type Me, type Meta } from "./authApi.js";
import { Button } from "./components/ui/button.js";

// Auth — GitHub account linking + project profile (App install state).
// No passwords, no tokens in the browser: login is a redirect to
// /api/auth/github, identity comes back as a signed session cookie.
export default function Auth({ repo }: { repo: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe(null));
    fetchMeta()
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setMeta(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setInstalled(null);
    fetchRepoProfile(repo)
      .then((p) => alive && setInstalled(p.installed))
      .catch(() => alive && setInstalled(false));
    return () => {
      alive = false;
    };
  }, [repo]);

  const doLogout = async () => {
    setBusy(true);
    try {
      await logout();
      setMe(null);
    } catch {
      // cookie clear is best-effort; keep the UI honest on next load
    } finally {
      setBusy(false);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const { synced, status } = await syncMyInstalls();
      const [m, p] = await Promise.all([
        fetchMe().catch(() => null),
        fetchRepoProfile(repo).catch(() => null),
      ]);
      if (m) setMe(m);
      if (p) setInstalled(p.installed);
      setSyncMsg(
        status === "app_not_configured"
          ? "GitHub App isn't configured on the server — check GITHUB_APP_ID / private key env vars."
          : status === "github_error"
            ? "Couldn't reach GitHub or the database — try again soon."
            : synced > 0
              ? `Synced ${synced} install(s) — projects update above.`
              : status === "synced"
                ? "Found your install(s) but couldn't read their repos — try again soon."
                : "No installs found — install the App on a repo first.",
      );
    } catch {
      setSyncMsg("Sync failed — try again soon.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="connect">
      {me === undefined ? (
        <p className="muted">Checking GitHub link…</p>
      ) : me ? (
        <>
          <div className="connect-row">
            {me.avatarUrl && (
              <img src={me.avatarUrl} alt="" width={20} height={20} className="avatar" />
            )}
            <strong>Linked as {me.login}</strong>
            <Button type="button" variant="secondary" onClick={doLogout} disabled={busy} className="row-end">
              Unlink
            </Button>
          </div>
          <p className="muted">
            {me.repos.length > 0
              ? `Your projects: ${me.repos.join(", ")}`
              : "No projects owned yet — install the App on a repo to claim it."}
          </p>
          <div className="connect-row">
            {installed === null ? (
              <span className="muted">Checking App install…</span>
            ) : installed ? (
              <span className="muted">
                GitHub App installed on this repo — events arrive automatically.
              </span>
            ) : meta?.installUrl ? (
              <>
                <span className="muted">No GitHub App on this repo yet.</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.open(meta.installUrl as string, "_blank", "noopener")}
                >
                  Install GitHub App
                </Button>
              </>
            ) : (
              <span className="muted">Manual webhooks only — set the App slug to offer one-click install.</span>
            )}
          </div>
          <div className="connect-row">
            <Button type="button" variant="secondary" onClick={doSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
          {syncMsg && <p className="muted">{syncMsg}</p>}
        </>
      ) : (
        <div className="connect-row">
          {meta?.authEnabled ? (
            <Button
              type="button"
              onClick={() => {
                window.location.href = "/api/auth/login";
              }}
            >
              Link GitHub account
            </Button>
          ) : (
            <span className="muted">GitHub login is not configured yet.</span>
          )}
        </div>
      )}
    </div>
  );
}
