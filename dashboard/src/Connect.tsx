import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./components/ui/button.js";
import {
  claimLinkCode,
  issueLinkToken,
  linkErrorMessage,
  linkStatus,
  pollLinkToken,
  readProof,
  unlinkSubscription,
  writeProof,
} from "./linkApi.js";

// Connect — website side of Telegram chat linking (no accounts; the chat
// subscription IS the user). Primary: Join deep-link button + claim polling.
// Backup: manual 6-letter /link code form.
export default function Connect({ repo }: { repo: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setWaiting(false);
    setLinked(false);
    setNotice(null);
    setProof(null);
    codeRef.current = null;
    // A stored proof means this browser linked before — a refresh must not
    // forget it. Verify against the server; drop it if it's stale.
    const stored = readProof(repo);
    if (stored) {
      setProof(stored);
      linkStatus(repo, stored).then(
        (res) => {
          if (res.linked) setLinked(true);
          else {
            writeProof(repo, null);
            setProof(null);
          }
        },
        () => {
          // network error: leave the connect UI up, keep the proof
        },
      );
    }
  }, [repo]);

  useEffect(() => {
    if (!waiting || !codeRef.current) return;
    const code = codeRef.current;
    const timer = setInterval(async () => {
      try {
        const res = await pollLinkToken(code);
        if (res.claimed) {
          clearInterval(timer);
          setWaiting(false);
          setLinked(true);
        }
      } catch {
        // keep polling; network blips must not kill the wait
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting]);

  const start = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const token = await issueLinkToken(repo);
      if (!token.url) {
        setNotice("Telegram bot is not configured yet.");
        return;
      }
      codeRef.current = token.code;
      setUrl(token.url);
      setWaiting(true);
      writeProof(repo, token.code);
    } catch (e) {
      setNotice(linkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const claim = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await claimLinkCode(codeInput.trim(), repo);
      writeProof(repo, codeInput.trim().toUpperCase());
      setProof(codeInput.trim().toUpperCase());
      setLinked(true);
    } catch (err) {
      setNotice(linkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!proof) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await unlinkSubscription(repo, proof);
      writeProof(repo, null);
      setProof(null);
      setLinked(false);
      setNotice(res.deleted > 0 ? "Unlinked — this chat won't get updates." : "Already unlinked.");
    } catch (err) {
      setNotice(linkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connect">
      {linked ? (
        <>
          <p>
            <strong>This chat is linked.</strong> New activity for {repo} will
            arrive here in Telegram.
          </p>
          {proof && (
            <Button type="button" variant="secondary" onClick={unlink} disabled={busy}>
              Unlink this chat
            </Button>
          )}
        </>
      ) : waiting && url ? (
        <>
          <p>Tap Join, then tap Start in Telegram. This page notices on its own.</p>
          <Button type="button" onClick={() => window.open(url, "_blank", "noopener")}>
            Join Telegram
          </Button>
          <p className="muted">Waiting for you in Telegram…</p>
        </>
      ) : (
        <>
          <p className="muted">Link this chat to get {repo} updates in Telegram.</p>
          <Button type="button" onClick={start} disabled={busy}>
            {busy ? "…" : "Connect Telegram"}
          </Button>
        </>
      )}
      {!linked && (
        <form onSubmit={claim} className="connect-code">
          <label htmlFor="link-code">Have a /link code instead?</label>
          <div className="connect-row">
            <input
              id="link-code"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              autoComplete="off"
              aria-label="Link code"
            />
            <Button type="submit" variant="secondary" disabled={busy || codeInput.trim().length === 0}>
              Claim
            </Button>
          </div>
        </form>
      )}
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}
