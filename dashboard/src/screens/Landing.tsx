/**
 * Landing. Public, no chrome.
 *
 * The hero is not a headline and a paragraph — it is the instrument. The most
 * characteristic thing this product does is turn a milestone into a row of
 * circles whose *area* is each task's weight, and fill that row in closing
 * order. A still image cannot say what a commit count cannot say, so we open
 * with the real thing, built by the real component, from the real fixtures.
 *
 * The second half is the collapse: a day of separate chat notifications
 * becoming one message. It is a working demonstration rather than a screenshot,
 * and switching the rhythm animates the collapse, because the collapse is the
 * product.
 *
 * No testimonials, no logos, no invented statistics.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { DigestMode } from "../api/types.js";
import { Logo } from "../components/brand.js";
import { Bubble } from "../components/surfaces.js";
import { SegmentedControl } from "../components/controls.js";
import { CategoryGlyph } from "../components/glyphs.js";
import { GoalTrack } from "../components/GoalTrack.js";
import { syncuraGroups, milestones, issues, defaultRepo } from "../api/fixtures.js";
import { renderDigest } from "../lib/digest.js";
import { shortSha } from "../lib/format.js";
import { progressSentence } from "../lib/weight.js";

gsap.registerPlugin(useGSAP);

const DEMO_COMMITS = syncuraGroups.flatMap((group) => group.commits);

const MODES: Array<{ value: DigestMode; label: string; hint: string }> = [
  { value: "instant", label: "Instant", hint: "every push, at once" },
  { value: "hourly", label: "Hourly", hint: "one message an hour" },
  { value: "daily", label: "Daily", hint: "one message a day" },
];

function motionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Landing() {
  // Opens on Instant so a first-time visitor sees the problem — eleven separate
  // chat notifications — and can then watch them collapse. Opening on the
  // solution would show an empty column and give away the demonstration.
  const [mode, setMode] = useState<DigestMode>("instant");
  const collapseScope = useRef<HTMLDivElement>(null);

  const milestone = milestones[defaultRepo.id][0] ?? null;
  const milestoneIssues = issues[defaultRepo.id].filter(
    (issue) => issue.milestoneId === milestone?.id,
  );
  const sentence = milestone ? progressSentence(milestone, new Date()) : "";

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

  // The collapse, animated. Switching to a slower rhythm does not swap one
  // panel for another: the notification stack gathers itself into the single
  // message it becomes — and it gives back its height as it goes, because a
  // faded stack that still occupies 300px is not a collapse, it is a void.
  useGSAP(
    () => {
      if (!motionAllowed()) return;
      const wrap = collapseScope.current?.querySelector<HTMLElement>(".demo__notifications");
      const stack = collapseScope.current?.querySelectorAll<HTMLElement>(".demo__notif");
      const bubble = collapseScope.current?.querySelector<HTMLElement>(".demo__digest");
      if (!wrap || !stack || stack.length === 0) return;

      const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });

      if (collapsed) {
        if (bubble) {
          gsap.fromTo(
            bubble,
            { opacity: 0, scale: 0.97 },
            { opacity: 1, scale: 1, duration: 0.4 },
          );
        }
        tl.to(stack, {
          opacity: 0,
          x: -12,
          height: 0,
          paddingTop: 0,
          paddingBottom: 0,
          duration: 0.3,
          stagger: { each: 0.025, from: "end" },
        }).to(wrap, { height: 0, duration: 0.2 }, "-=0.1");
      } else {
        tl.to(wrap, { height: "auto", duration: 0.24 }).to(
          stack,
          {
            opacity: 1,
            x: 0,
            height: "auto",
            paddingTop: "",
            paddingBottom: "",
            duration: 0.24,
            stagger: { each: 0.025, from: "start" },
          },
          "<",
        );
      }
    },
    { scope: collapseScope, dependencies: [mode], revertOnUpdate: true },
  );

  return (
    <div className="public">
      <a className="skip-link" href="#demo">
        Skip to the demonstration
      </a>

      <header className="landing__top page">
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

      <main className="stack--loose page" id="demo">
        {/* The hero is the instrument: the sentence, then the track it describes. */}
        <section className="hero hero--instrument">
          <h1 className="display">{sentence}</h1>

          <GoalTrack
            milestone={milestone!}
            issues={milestoneIssues}
            orientation="horizontal"
            caption={
              <p className="small muted">
                One circle per task, and its area is that task's weight. The line fills in the order
                tasks were finished, so a reopened task pulls it back.
              </p>
            }
          />

          <div className="hero__band">
            <p className="hero__lede">
              CommitIt sends your team one honest message about the repository. Progress is finished
              tasks, weighted. Commits are activity, and they are never counted as progress.
            </p>
            <div className="hero__right">
              <div className="weightkey" aria-label="Task weights">
                {(
                  [
                    { w: "1", label: "S · 1 point" },
                    { w: "3", label: "M · 3 points" },
                    { w: "5", label: "L · 5 points" },
                  ] as const
                ).map((k) => (
                  <span className="weightkey__item" data-weight={k.w} key={k.w}>
                    <span className="weightkey__dot" aria-hidden="true" />
                    <span className="weightkey__label">{k.label}</span>
                  </span>
                ))}
              </div>
              <p className="hero__cta">
                <Link className="btn btn--primary" to="/connect/github">
                  Connect a repo
                </Link>
              </p>
            </div>
          </div>
        </section>

        <section className="demo" aria-labelledby="demo-heading" ref={collapseScope}>
          <h2 className="section-head__title" id="demo-heading">
            A day of commits becomes one message
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

          <div className="demo__stage">
            <div className="demo__col">
              <div className="demo__colhead">
                <strong>Your chat</strong>
                <span>{separate} notifications</span>
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
            </div>

            <div className="demo__col">
              <div className="demo__colhead">
                <strong>CommitIt</strong>
                <span>{collapsed ? "1 message" : "nothing sent yet"}</span>
              </div>
              {collapsed ? (
                <div className="demo__digest">
                  <Bubble>{rendered.text}</Bubble>
                </div>
              ) : (
                <p className="small muted demo__idle">
                  With Instant, each notification above arrives on its own, as it happens. Nothing is
                  grouped, and nothing is summarised.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="facts" aria-label="How CommitIt works">
          <div>
            <h2 className="section-head__title">How it connects</h2>
            <p className="facts__body">
              GitHub webhook: one line of setup, pasted from Repo settings. Telegram bot: one tap to
              link. Each repository gets its own chat, its own rhythm and its own quiet hours.
            </p>
          </div>
          <div>
            <h2 className="section-head__title">What it never does</h2>
            <p className="facts__body">
              It reads metadata and short summaries, and stores neither your source nor your secrets.
              Every commit is scanned for keys before any summary is written, and a matching file is
              skipped entirely — named by path only. It never counts a commit as progress.
            </p>
          </div>
        </section>

        <p>
          <Link className="btn btn--primary" to="/connect/github">
            Connect a repo
          </Link>
        </p>
      </main>

      <footer className="page">
        <p className="small muted">
          CommitIt. Progress measured by finished tasks. A possible secret is scanned out before any AI
          call.
        </p>
      </footer>
    </div>
  );
}
