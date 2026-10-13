import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";

// Welcome — soft landing for first-run states (logged out, or the current
// repo isn't accessible). Shown INSTEAD of the red forbidden/auth error so
// new users get steps, not a wall. The Telegram/GitHub sections below hold
// the real action buttons; these jump straight to them.
export default function Welcome({ linked }: { linked: boolean }) {
  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Card aria-label="Welcome">
      <CardHeader>
        <CardTitle>Get your repo reporting in Telegram</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="muted">
          CommitIt turns GitHub activity into goal-based progress reports in chat —
          who did what, which goal it moves, how close to done. Three steps:
        </p>
        <ol className="welcome-steps">
          <li>
            <div>
              <strong>{linked ? "Link your GitHub account ✓" : "Link your GitHub account"}</strong>
              {!linked && (
                <Button type="button" variant="secondary" onClick={() => go("section-github")}>
                  Link account
                </Button>
              )}
            </div>
            {!linked && (
              <span className="muted">One click, no password — we only read what you grant.</span>
            )}
          </li>
          <li>
            <div>
              <strong>Install the App on your repo</strong>
              <Button type="button" variant="secondary" onClick={() => go("section-github")}>
                Install App
              </Button>
            </div>
            <span className="muted">Events then arrive automatically — no webhooks to wire.</span>
          </li>
          <li>
            <div>
              <strong>Connect Telegram</strong>
              <Button type="button" variant="secondary" onClick={() => go("section-telegram")}>
                Connect chat
              </Button>
            </div>
            <span className="muted">Daily digests land in your chat, not your inbox.</span>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
