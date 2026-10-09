import { useCallback, useEffect, useState } from "react";
import type {
  ActivitySnapshot,
  DigestEntry,
  IssueRow,
  RepoProgress,
} from "@src/dashboard.js";
import { fetchActivity, fetchDigests, fetchIssues, fetchProgress } from "./api.js";
import { AuthorBars, DigestTimeline, Donut, IssuesTable, OverallBand } from "./components.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { activityToCsv, downloadCsv, downloadDoc, exportFilename, issuesToCsv } from "./export.js";
import Logo from "./Logo.js";
import { buildWeeklySummary, digestToDoc, weekLabel } from "./report.js";
import Review from "./Review.js";
import Connect from "./Connect.js";
import Auth from "./Auth.js";
import "./styles.css";
import { ThemeSwitch, useTheme } from "./theme.js";

const DEFAULT_REPO = "AhadIKK/CommitIt";

type View = "dashboard" | "review" | "help";

export default function App() {
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [view, setView] = useState<View>("dashboard");
  const [theme, toggleTheme] = useTheme();
  const [input, setInput] = useState(DEFAULT_REPO);
  const [progress, setProgress] = useState<RepoProgress | null>(null);
  const [activity, setActivity] = useState<ActivitySnapshot | null>(null);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [digests, setDigests] = useState<DigestEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (r: string) => {
    setLoading(true);
    setError(null);
    try {
      const [p, a, i, d] = await Promise.all([
        fetchProgress(r),
        fetchActivity(r),
        fetchIssues(r),
        fetchDigests(r),
      ]);
      setProgress(p);
      setActivity(a);
      setIssues(i);
      setDigests(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(repo);
  }, [repo, load]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo />
            <h1 className="brand-name">CommitIt</h1>
            <span className="brand-tag">who did what, how close to done</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRepo(input.trim() || DEFAULT_REPO);
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
      {error && <p className="error">Error: {error}</p>}

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList aria-label="Views">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="help">Help</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" forceMount className="tab-panel">
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
          <h2>Activity (7d)</h2>
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
        {activity && <AuthorBars authors={activity.authors} />}
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
      <section aria-label="Telegram">
        <div className="section-head">
          <h2>Telegram</h2>
        </div>
        <Connect repo={repo} />
      </section>
      <section aria-label="GitHub">
        <div className="section-head">
          <h2>GitHub</h2>
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
