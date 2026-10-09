import { useEffect, useState } from "react";
import { fetchMe, fetchMeta, fetchRepoProfile, logout, type Me, type Meta } from "./authApi.js";
import { Button } from "./components/ui/button.js";

// Auth — GitHub account linking + project profile (App install state).
// No passwords, no tokens in the browser: login is a redirect to
// /api/auth/github, identity comes back as a signed session cookie.
export default function Auth({ repo }: { repo: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="auth">
      {me === undefined ? (
        <p className="muted">Checking GitHub link…</p>
      ) : me ? (
        <>
          <p>
            <strong>Linked as {me.login}.</strong>{" "}
            {me.avatarUrl && (
              <img src={me.avatarUrl} alt="" width={20} height={20} className="avatar" />
            )}{" "}
            <Button type="button" variant="secondary" onClick={doLogout} disabled={busy}>
              Unlink
            </Button>
          </p>
          <p className="muted">
            {me.repos.length > 0
              ? `Your projects: ${me.repos.join(", ")}`
              : "No projects owned yet — install the App on a repo to claim it."}
          </p>
        </>
      ) : (
        <p className="muted">
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
            "GitHub login is not configured yet."
          )}
        </p>
      )}
      <p className="muted">
        {installed === null
          ? "Checking App install…"
          : installed
            ? "GitHub App installed on this repo — events arrive automatically."
            : meta?.installUrl
              ? (
                <>
                  No GitHub App on this repo yet.{" "}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => window.open(meta.installUrl as string, "_blank", "noopener")}
                  >
                    Install GitHub App
                  </Button>
                </>
              )
              : "Manual webhooks only — set the App slug to offer one-click install."}
      </p>
    </div>
  );
}
