import { useCallback, useEffect, useState } from "react";
import type {
  ActivitySnapshot,
  DigestEntry,
  IssueRow,
  RepoProgress,
} from "@src/dashboard.js";
import { fetchActivity, fetchDigests, fetchIssues, fetchProgress } from "./api.js";
import { AuthorBars, DigestTimeline, Donut, IssuesTable } from "./components.js";
import "./styles.css";

const DEFAULT_REPO = "AhadIKK/CommitIt";

export default function App() {
  const [repo, setRepo] = useState(DEFAULT_REPO);
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
      <header>
        <h1>CommitIt</h1>
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
          <button type="submit">Load</button>
        </form>
      </header>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">Error: {error}</p>}

      <section>
        <h2>Milestones</h2>
        {progress && progress.milestones.length === 0 && (
          <p className="muted">No milestones yet.</p>
        )}
        <div className="miles">
          {progress?.milestones.map((m) => <Donut key={m.title} m={m} />)}
        </div>
        {progress?.overall && (
          <p>
            Overall: <strong>{progress.overall.percent}%</strong>{" "}
            <span className="muted">{progress.overall.label}</span>
          </p>
        )}
      </section>

      <section>
        <h2>Activity (7d)</h2>
        {activity && <AuthorBars authors={activity.authors} />}
      </section>

      <section>
        <h2>Issues</h2>
        {issues.length === 0 ? (
          <p className="muted">No issues synced.</p>
        ) : (
          <IssuesTable issues={issues} />
        )}
      </section>

      <section>
        <h2>Digests</h2>
        <DigestTimeline digests={digests} />
      </section>
    </div>
  );
}
