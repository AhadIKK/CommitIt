/**
 * Who the connect wizard is for.
 *
 * The wizard is the first-run path: install the GitHub App, pick the
 * repository, link the Telegram chat, choose a rhythm. Every "Connect a repo"
 * button on the marketing pages points at it, so a person who signed in weeks
 * ago and already watches a repository walks the four steps again and reads it
 * as the app having forgotten them. They belong on the dashboard.
 *
 * Two things keep the wizard reachable:
 *
 *  - `?repo=` — the links that mean "this repository, on purpose" carry it
 *    (RepoSettings' "Reconnect GitHub", Digests' empty state). Those stay.
 *  - review mode — the fixtures describe a signed-in account that already has
 *    repositories, so without this neither `?state=…` nor the Playwright suite
 *    could look at the wizard at all.
 */
export type ConnectVisitor = {
  /** `/api/me` said there is a session. */
  signedIn: boolean;
  /** How many repositories that account can see. */
  repoCount: number;
  /** The URL carried `?repo=`, i.e. a deliberate single-repository intent. */
  repoScoped: boolean;
  /** Fixtures are playing the backend (design review, Playwright). */
  reviewMode: boolean;
};

/** True when this visitor still has something to do in the wizard. */
export function needsConnectWizard(visitor: ConnectVisitor): boolean {
  if (visitor.reviewMode) return true;
  if (!visitor.signedIn) return true;
  if (visitor.repoScoped) return true;
  return visitor.repoCount === 0;
}
