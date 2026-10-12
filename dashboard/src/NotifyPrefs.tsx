import { useEffect, useState } from "react";
import { fetchMe } from "./authApi.js";
import { fetchMySubscriptions, linkErrorMessage, setDigestMode } from "./linkApi.js";
import type { MySubscription } from "./linkApi.js";

const MODES = ["instant", "hourly", "daily", "weekly"] as const;

// NotifyPrefs — digest-mode control for the current repo. Login-gated:
// logged-out visitors get a pointer to GitHub linking instead of a dead form.
export default function NotifyPrefs({ repo }: { repo: string }) {
  const [state, setState] = useState<
    | { kind: "checking" }
    | { kind: "logged_out" }
    | { kind: "no_subscription" }
    | { kind: "ready"; sub: MySubscription }
  >({ kind: "checking" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ kind: "checking" });
    setNotice(null);
    fetchMe()
      .then((me) => {
        if (!alive) return;
        if (!me) {
          setState({ kind: "logged_out" });
          return;
        }
        return fetchMySubscriptions().then((subs) => {
          if (!alive) return;
          const sub = subs.find((s) => s.repo === repo);
          setState(sub ? { kind: "ready", sub } : { kind: "no_subscription" });
        });
      })
      .catch(() => alive && setState({ kind: "logged_out" }));
    return () => {
      alive = false;
    };
  }, [repo]);

  const change = async (mode: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await setDigestMode(repo, mode);
      setState((s) =>
        s.kind === "ready" ? { kind: "ready", sub: { ...s.sub, digestMode: mode } } : s,
      );
      setNotice(`Notifications for ${repo} → ${mode}.`);
    } catch (e) {
      setNotice(linkErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (state.kind === "checking") return <p className="muted">Checking notifications…</p>;
  if (state.kind === "logged_out") {
    return <p className="muted">Link your GitHub account above to manage Telegram notifications.</p>;
  }
  if (state.kind === "no_subscription") {
    return <p className="muted">Link this chat above, then pick how often it pings you here.</p>;
  }
  return (
    <div className="notify-row">
      <label htmlFor="digest-mode">Notify me</label>
      <select
        id="digest-mode"
        value={state.sub.digestMode}
        disabled={saving}
        onChange={(e) => void change(e.target.value)}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {state.sub.isMuted && <span className="muted">Muted.</span>}
      {notice && <p className="muted">{notice}</p>}
    </div>
  );
}
