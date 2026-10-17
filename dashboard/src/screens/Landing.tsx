/**
 * Landing. Public, no chrome, one screen with one interaction: switch between
 * instant, hourly and daily and watch a day of separate notifications become a
 * single message. The demonstration is real DOM built by the same digest
 * renderer the app uses — not a screenshot.
 *
 * No testimonials, no logos, no statistics. The product's own claim is the demo.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { DigestMode } from "../api/types.js";
import { Logo } from "../components/brand.js";
import { Bubble } from "../components/surfaces.js";
import { SegmentedControl } from "../components/controls.js";
import { CategoryGlyph } from "../components/glyphs.js";
import { syncuraGroups, milestones, defaultRepo } from "../api/fixtures.js";
import { renderDigest, DIGEST_MODE_LABEL } from "../lib/digest.js";
import { shortSha } from "../lib/format.js";
import { progressSentence } from "../lib/weight.js";

const DEMO_COMMITS = syncuraGroups.flatMap((group) => group.commits);

const MODES: Array<{ value: DigestMode; label: string; hint: string }> = [
  { value: "instant", label: "Instant", hint: "every push, at once" },
  { value: "hourly", label: "Hourly", hint: "one message an hour" },
  { value: "daily", label: "Daily", hint: "one message a day" },
];

export function Landing() {
  const [mode, setMode] = useState<DigestMode>("daily");

  const milestone = milestones[defaultRepo.id][0] ?? null;
  const rendered = renderDigest({
    repoFullName: defaultRepo.fullName,
    mode,
    at: new Date(new Date().setHours(9, 0, 0, 0)).toISOString(),
    milestone,
    groups: syncuraGroups,
    compareLink: `https://github.com/${defaultRepo.fullName}/compare/7bd021a...ff00ee1`,
  });

  const separate = DEMO_COMMITS.length;
  const collapsed = mode !== "instant";

  return (
    <div className="public">
      <a className="skip-link" href="#demo">
        Skip to the demonstration
      </a>

      <header className="landing__top">
        <span className="strip__brand">
          <Logo size={28} />
          <span className="strip__word">CommitIt</span>
        </span>
        <span className="landing__top-cta">
          <Link className="btn btn--primary" to="/connect/github">
            Connect a repo
          </Link>
        </span>
      </header>

      <main className="stack--loose" id="demo">
        <div className="hero">
          <h1 className="hero__headline">A day of commits, as one message.</h1>
          <p className="hero__lede">
            CommitIt reads your repository's metadata and sends one honest message to your team's chat:
            what got finished, what moved, and what needs a decision. Progress is finished tasks — never
            commit counts.
          </p>
        </div>

        <section className="demo" aria-labelledby="demo-heading">
          <h2 className="visually-hidden" id="demo-heading">
            How a day of commits becomes one message
          </h2>

          <div className="demo__control">
            <SegmentedControl<DigestMode>
              legend="How often should the chat hear from CommitIt?"
              value={mode}
              options={MODES}
              onChange={setMode}
            />
            <p className="demo__count num" aria-live="polite">
              {mode === "instant"
                ? `${separate} separate notifications, one per commit.`
                : `${separate} separate notifications become 1 message.`}
            </p>
          </div>

          <div className="demo__notifications">
            {DEMO_COMMITS.map((commit) => (
              <div className="demo__notif" key={commit.sha}>
                <CategoryGlyph category={commit.category} />
                <span className="demo__notif-subject">{commit.message}</span>
                <span className="code muted">{shortSha(commit.sha)}</span>
              </div>
            ))}
          </div>

          {collapsed ? (
            <div className="demo__digest">
              <Bubble
                meta={
                  <>
                    <span>{defaultRepo.fullName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{DIGEST_MODE_LABEL[mode]}</span>
                    <span aria-hidden="true">·</span>
                    <span>9:00</span>
                  </>
                }
              >
                {rendered.text}
              </Bubble>
            </div>
          ) : (
            <p className="demo__digest small muted">
              With Instant, each of these arrives on its own, as it happens. Nothing is grouped.
            </p>
          )}
        </section>

        <section className="facts" aria-label="How CommitIt works">
          <div>
            <h2 className="section-head__title">How it connects</h2>
            <p className="facts__body" style={{ marginTop: "var(--space-3)" }}>
              GitHub webhook: one line of setup, pasted from Repo settings. Telegram bot: one tap to link.
              Each repository gets its own chat, its own rhythm and its own quiet hours.
            </p>
          </div>
          <div>
            <h2 className="section-head__title">What it never does</h2>
            <p className="facts__body" style={{ marginTop: "var(--space-3)" }}>
              It reads metadata and short summaries, and stores neither your source nor your secrets. Every
              commit is scanned for keys before any summary is written, and a matching file is skipped
              entirely — named by path only. It never counts a commit as progress.
            </p>
            {milestone ? (
              <p className="facts__body" style={{ marginTop: "var(--space-3)" }}>
                The sentence it reports looks like this: “{progressSentence(milestone, new Date())}”
              </p>
            ) : null}
          </div>
        </section>

        <p>
          <Link className="btn btn--primary" to="/connect/github">
            Connect a repo
          </Link>
        </p>
      </main>

      <footer className="small muted">
        CommitIt. Progress measured by finished tasks. A possible secret is scanned out before any AI call.
      </footer>
    </div>
  );
}
