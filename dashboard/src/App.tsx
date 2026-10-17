import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivitySnapshot,
  DigestEntry,
  IssueRow,
  RepoProgress,
} from "@src/dashboard.js";
import { fetchDashboard } from "./api.js";
import { claimInstallSetup } from "./authApi.js";
import { AuthorBars, CommitList, DigestTimeline, Donut, IssuesTable, OverallBand } from "./components.js";
import { Button } from "./components/ui/button.js";
import { GitHubMark, TelegramMark } from "./brandIcons.js";
import NotifyPrefs from "./NotifyPrefs.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { activityToCsv, downloadCsv, downloadDoc, exportFilename, issuesToCsv } from "./export.js";
import Logo from "./Logo.js";
import { buildWeeklySummary, digestToDoc, weekLabel } from "./report.js";
import Review from "./Review.js";
import Connect from "./Connect.js";
import Auth from "./Auth.js";
import Welcome from "./Welcome.js";
import "./styles.css";
import { ThemeSwitch, useTheme } from "./theme.js";

const DEFAULT_REPO = "nope/nothing-here";

// Deep-linkable repo: ?repo=owner/name wins (shareable links, fresh tabs).
function initialRepo(): string {
  if (typeof window === "undefined") return DEFAULT_REPO;
  return new URLSearchParams(window.location.search).get("repo")?.trim() || DEFAULT_REPO;
}

// First load with nothing in the URL: let the server serve the account's first
// repo instead of the placeholder, in the same request. Once a repo is in the
// URL — shared link, typed, or "Load" — the choice is explicit, never overridden.
function preferMine(r: string): boolean {
  if (r !== DEFAULT_REPO) return false;
  return !new URLSearchParams(window.location.search).get("repo");
}

type View = "dashboard" | "review" | "help";

export default function App() {
  const [repo, setRepo] = useState(initialRepo);
  const [view, setView] = useState<View>("dashboard");
  const [theme, toggleTheme] = useTheme();
  const [input, setInput] = useState(repo);
  const [progress, setProgress] = useState<RepoProgress | null>(null);
  const [activity, setActivity] = useState<ActivitySnapshot | null>(null);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [digests, setDigests] = useState<DigestEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"auth_required" | "forbidden" | "other" | null>(null);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  // The repo whose data is currently on screen. When the server picks a repo
  // for us (`preferMine`), the setRepo below must not re-load what we just
  // rendered — removing that second round trip is the point of `prefer`.
  const shown = useRef("");

  const load = useCallback(async (r: string, quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
      setErrorKind(null);
    }
    try {
      const d = await fetchDashboard(r, preferMine(r));
      // The account first: it decides which onboarding step Welcome shows,
      // even when the repo itself is denied.
      setLinked(!!d.me);
      if (d.denied) throw new Error(d.denied.status === 401 ? "auth_required" : "forbidden");
      setProgress(d.progress ?? null);
      setActivity(d.activity ?? null);
      setIssues(d.issues ?? []);
      setDigests(d.digests ?? []);
      if (d.repo && d.repo !== r) {
        shown.current = d.repo;
        setRepo(d.repo);
        setInput(d.repo);
      } else {
        shown.current = r;
      }
      if (quiet) {
        setError(null);
        setErrorKind(null);
      }
    } catch (e) {
      if (quiet) return; // keep stale data, no banner flash on background ticks
      const msg = e instanceof Error ? e.message : "load failed";
      setErrorKind(msg === "auth_required" || msg === "forbidden" ? msg : "other");
      setError(
        msg === "auth_required"
          ? "Sign in with GitHub in the GitHub section below, then reload."
          : msg === "forbidden"
            ? "Your account can't access this repo (App not installed or access removed)."
            : msg,
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Live by default: quiet 30s polling while visible + reload on tab refocus.
  // Polling (not push-triggered) is the mechanism — the client can't hear
  // webhooks. Hidden tabs skip ticks entirely so idle tabs cost zero
  // function execution; refocus triggers a single reload instead.
  // Quiet ticks never flash banners or clobber data.
  useEffect(() => {
    const poll = () => {
      if (!document.hidden) void load(repo, true);
    };
    const tick = setInterval(poll, 30_000);
    const onFocus = () => {
      if (!document.hidden) void load(repo, true);
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [repo, load]);

  // Soft landing: first-run states (logged out / repo not accessible) with
  // no data get the Welcome steps instead of the red error wall.
  const showWelcome =
    (errorKind === "auth_required" || errorKind === "forbidden") && !progress && !activity;

  useEffect(() => {
    if (shown.current === repo) return; // already displaying this repo
    void load(repo);
  }, [repo, load]);

  // GitHub App Setup-URL landing (?installation_id=): claim the install once,
  // show the result, then strip the params. setup_claimed=1 comes from the
  // OAuth-during-install bounce (claimed post-login in the callback).
  const [setupNotice, setSetupNotice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get("installation_id");
    if (params.get("setup_claimed") === "1") {
      setSetupNotice("GitHub App installed — syncing repos.");
      params.delete("setup_claimed");
      params.delete("linked");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      return;
    }
    if (!installationId) return;
    claimInstallSetup(installationId)
      .then((d) => {
        setSetupNotice(
          d.repos.length > 0
            ? `App installed on: ${d.repos.join(", ")}.`
            : "App installed. No repos synced yet.",
        );
      })
      .catch(() => {
        setSetupNotice("Install recorded, but claiming needs login — link GitHub first.");
      })
      .finally(() => {
        params.delete("installation_id");
        params.delete("setup_action");
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      });
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo />
            <div className="brand-text">
              <h1 className="brand-name">CommitIt</h1>
              <span className="brand-tag">who did what, how close to done</span>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = input.trim() || DEFAULT_REPO;
              setRepo(next);
              const url = new URL(window.location.href);
              url.searchParams.set("repo", next);
              window.history.replaceState(null, "", url);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="owner/repo"
              aria-label="Repository"
            />
            <Button type="submit">Load</Button>
            <ThemeSwitch theme={theme} onToggle={toggleTheme} />
          </form>
        </div>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {showWelcome ? <Welcome linked={linked} /> : error && <p className="error">Error: {error}</p>}
      {setupNotice && <p className="notice">{setupNotice}</p>}

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList aria-label="Views">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="help">Help</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" forceMount className="tab-panel">
        {!showWelcome && (
          <>
        <Card aria-label="Milestones">
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
          </CardHeader>
          <CardContent>
            {progress?.overall && <OverallBand m={progress.overall} />}
            {progress && progress.milestones.length === 0 && !progress.overall && (
              <p className="muted">No milestones yet.</p>
            )}
            <div className="miles">
              {progress?.milestones.map((m) => <Donut key={m.title} m={m} />)}
            </div>
          </CardContent>
        </Card>

      <section aria-label="Activity">
        <div className="section-head">
          <h2>
            Activity (7d)
            {activity && (
              <span className="muted">
                {" "}
                · {activity.githubMainCommits ?? activity.totalCommitsAllTime}{" "}
                {activity.githubMainCommits != null ? "commits on main" : "commits tracked"},{" "}
                {activity.totalMergedPRsAllTime} merged PRs all-time
              </span>
            )}
          </h2>
          <div className="connect-row">
            <Button type="button" variant="secondary" onClick={() => void load(repo)}>
              Refresh
            </Button>
            {activity && activity.authors.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadCsv(exportFilename(repo, "activity"), activityToCsv(activity.authors))}
              >
                Export CSV
              </Button>
            )}
          </div>
        </div>
        {activity && <AuthorBars authors={activity.authors} />}
      </section>

      <section aria-label="Commits">
        <div className="section-head">
          <h2>
            What each commit is about
            {activity && activity.commits.length > 0 && (
              <span className="muted"> · last {activity.commits.length} in range</span>
            )}
          </h2>
        </div>
        <CommitList commits={activity?.commits ?? []} repo={repo} />
      </section>

      <section aria-label="Issues">
        <div className="section-head">
          <h2>Issues</h2>
          {issues.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadCsv(exportFilename(repo, "issues"), issuesToCsv(issues))}
            >
              Export CSV
            </Button>
          )}
        </div>
        {issues.length === 0 ? (
          <p className="muted">No issues synced.</p>
        ) : (
          <div className="table-wrap">
            <IssuesTable issues={issues} />
          </div>
        )}
      </section>

      <section aria-label="Digests">
        <div className="section-head">
          <h2>Digests</h2>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              downloadDoc(
                exportFilename(repo, "digest").replace(/\.csv$/, ".doc"),
                digestToDoc({
                  repo,
                  weekLabel: weekLabel(),
                  summary: buildWeeklySummary(activity, progress, issues, digests),
                  issues,
                  digests,
                }),
              )
            }
          >
            Export .doc
          </Button>
        </div>
        <div className="summary-3p">
          <p>
            <strong>Progress:</strong> {buildWeeklySummary(activity, progress, issues, digests).progress}
          </p>
          <p>
            <strong>Plans:</strong> {buildWeeklySummary(activity, progress, issues, digests).plans}
          </p>
          <p>
            <strong>Problems:</strong> {buildWeeklySummary(activity, progress, issues, digests).problems}
          </p>
        </div>
        <DigestTimeline digests={digests} />
      </section>
          </>
        )}
      <section aria-label="Telegram" id="section-telegram">
        <div className="section-head">
          <div className="section-title">
            <TelegramMark />
            <h2>Telegram</h2>
          </div>
        </div>
        <Connect repo={repo} />
        <NotifyPrefs repo={repo} />
      </section>
      <section aria-label="GitHub" id="section-github">
        <div className="section-head">
          <div className="section-title">
            <GitHubMark />
            <h2>GitHub</h2>
          </div>
        </div>
        <Auth repo={repo} />
      </section>
        </TabsContent>

        <TabsContent value="review" forceMount className="tab-panel">
          <Review progress={progress} activity={activity} issues={issues} />
        </TabsContent>

        <TabsContent value="help" forceMount className="tab-panel">
          <section aria-label="Help" className="help">
          <h2>How to read this dashboard</h2>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: [
                  {
                    "@type": "Question",
                    name: "What does the overall % mean?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "The weighted share of closed issue points. Commits never count as progress.",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "What are S, M, L?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "Issue size weights worth 1, 3, and 5 points. Unweighted issues count as 1 point.",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "How do I export?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "CSV buttons export issues and activity, Export .doc saves the weekly digest for Word, and printing saves a PDF.",
                    },
                  },
                ],
              }),
            }}
          />
          <dl>
            <dt>What does the overall % mean?</dt>
            <dd>
              The weighted share of closed issue points across milestones.
              Commits never count as progress — only closed issues move the number.
            </dd>
            <dt>What are S, M, L?</dt>
            <dd>
              Issue size weights worth 1, 3, and 5 points. Issues without an
              estimate count as 1 point and are flagged as unestimated.
            </dd>
            <dt>What does a suggested link mean?</dt>
            <dd>
              A heuristic guess linking a commit to an issue. Suggestions are
              never auto-applied — confirm them with /link in Telegram.
            </dd>
            <dt>How do I export?</dt>
            <dd>
              The CSV buttons download issues and activity for Excel. Export
              .doc saves the weekly digest for Word. Printing this page saves
              a PDF via your browser.
            </dd>
          </dl>
        </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
