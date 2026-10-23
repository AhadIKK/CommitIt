/**
 * Settings. Ten sections, every one of them <Entry/> rows — there are no cards
 * in this area and there never will be. The left sub-nav carries the § numbers
 * so a control can be quoted in conversation ("turn off § 4.3").
 *
 * The live message preview is the one bold element of this area.
 */
import { useState } from "react";
import {
  Checkbox,
  Entry,
  Notice,
  Segmented,
  Slip,
  Stamp,
  Switch,
  TextInput,
  UnpostedBar,
  useToast,
} from "../components/kit.js";

const SECTIONS = [
  { id: "1", label: "Account" },
  { id: "2", label: "GitHub connection" },
  { id: "3", label: "Telegram" },
  { id: "4", label: "Digests and notifications" },
  { id: "5", label: "Weights and classification" },
  { id: "6", label: "Alerts" },
  { id: "7", label: "Secret scanning and safety" },
  { id: "8", label: "Team" },
  { id: "9", label: "API and webhooks" },
  { id: "10", label: "Danger zone" },
];

export function Settings() {
  const [section, setSection] = useState("1");
  const [dirty, setDirty] = useState(0);
  const toast = useToast();
  const [cadence, setCadence] = useState<"instant" | "hourly" | "daily">("daily");
  const [showActivity, setShowActivity] = useState(true);
  const [moved, setMoved] = useState(true);
  const [decisions, setDecisions] = useState(true);
  const [shortcuts, setShortcuts] = useState(true);
  const [quiet, setQuiet] = useState("22:00 – 07:00");

  function touch() {
    setDirty((d) => d + 1);
  }

  function post() {
    toast(`Posted at ${new Date().toISOString().slice(11, 16)}.`);
    setDirty(0);
  }

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`settings__navitem${section === s.id ? " is-active" : ""}`}
            onClick={() => setSection(s.id)}
          >
            <span className="num">§ {s.id}</span> {s.label}
          </button>
        ))}
      </nav>

      <div className="settings__body">
        {section === "1" ? (
          <>
            <h1 className="page__title">Account</h1>
            <div className="entries">
              <Entry label="Display name" section="1.1" control={<TextInput label="Display name" value="Fizan Rahman" onChange={touch} />} />
              <Entry label="Email" section="1.2" hint="Read-only, from GitHub." control={<TextInput label="Email" value="fizan@pace.edu.in" onChange={() => undefined} />} />
              <Entry label="Timezone" section="1.3" control={<TextInput label="Timezone" value="Asia/Kolkata (UTC+05:30)" onChange={touch} />} />
              <Entry label="Theme" section="1.4" control={<Segmented legend="Theme" value="auto" onChange={touch} options={[{ value: "auto", label: "system" }, { value: "light", label: "light" }, { value: "dark", label: "dark" }]} />} />
              <Entry label="Keyboard shortcuts" section="1.5" control={<Switch checked={shortcuts} label="Keyboard shortcuts" onChange={(v) => { setShortcuts(v); touch(); }} />} />
              <Entry label="Sign out of all sessions" section="1.6" hint="Ends every session, including this one." control={<button type="button" className="void-btn">Void</button>} />
            </div>
          </>
        ) : null}

        {section === "2" ? (
          <>
            <h1 className="page__title">GitHub connection</h1>
            <div className="entries">
              <Entry label="App installation" section="2.1" control={<Stamp>VERIFIED</Stamp>} />
              <Entry label="Installed account" section="2.2" control={<span className="num">AhadIKK</span>} />
              <Entry label="Webhook secret" section="2.3" hint="Only a fingerprint is ever shown. The value is shown once, at creation." control={<span className="num">•••• ···· ···· 7f3a</span>} />
              <Entry label="Last delivery" section="2.4" control={<span className="num">2 minutes ago</span>} />
              <Entry label="Success rate, 24h" section="2.5" control={<span className="num">1841 / 1842</span>} />
            </div>
          </>
        ) : null}

        {section === "3" ? (
          <>
            <h1 className="page__title">Telegram</h1>
            <div className="entries">
              <Entry label="Bot" section="3.1" control={<span className="num">@commitit_progress_bot</span>} />
              <Entry label="Delivery batching window" section="3.2" hint="Batched delivery keeps one burst from becoming ten pings." control={<Segmented legend="Batching" value="2m" onChange={touch} options={[{ value: "off", label: "off" }, { value: "30s", label: "30s" }, { value: "2m", label: "2min" }, { value: "5m", label: "5min" }]} />} />
              <Entry label="Send a test message" section="3.3" control={<button type="button" className="ld-btn ld-btn--mono" onClick={() => toast("Test sent. Delivered 14:02:11.")}>Send test</button>} />
            </div>
          </>
        ) : null}

        {section === "4" ? (
          <div className="settings__split">
            <div>
              <h1 className="page__title">Digests and notifications</h1>
              <div className="entries">
                <Entry label="Default cadence" section="4.1" control={<Segmented legend="Default cadence" value={cadence} onChange={(v) => { setCadence(v); touch(); }} options={[{ value: "instant", label: "instant" }, { value: "hourly", label: "hourly" }, { value: "daily", label: "daily" }]} />} />
                <Entry label="Quiet hours" section="4.2" hint="Quiet hours reschedule. Nothing is dropped." control={<TextInput label="Quiet hours" value={quiet} onChange={(v) => { setQuiet(v); touch(); }} />} />
                <Entry label="Finished" section="4.3.1" hint="Always on. A digest without it would say nothing." control={<Switch checked locked label="Finished" onChange={() => undefined} />} />
                <Entry label="Moved" section="4.3.2" control={<Switch checked={moved} label="Moved" onChange={(v) => { setMoved(v); touch(); }} />} />
                <Entry label="Needs a decision" section="4.3.3" control={<Switch checked={decisions} label="Needs a decision" onChange={(v) => { setDecisions(v); touch(); }} />} />
                <Entry label="Show activity line" section="4.3.4" hint="Labelled as activity, never as progress." control={<Switch checked={showActivity} label="Show activity line" onChange={(v) => { setShowActivity(v); touch(); }} />} />
              </div>
            </div>

            {/* The one bold element of the settings area. */}
            <aside className="settings__preview">
              <h2 className="side__title">Preview</h2>
              <Slip title="syncura · daily digest · 09:00">
                <p className="preview-line">Auth is 34% done: 34 of 60 points, due in 6 days.</p>
                <p className="preview-dl"><span className="num">FINISHED</span> Rate limit the webhook (+1), Requeue orphaned jobs (+3).</p>
                <p className="preview-dl"><span className="num">MOVED</span> {showActivity ? "11 commits, 4 unlinked. Activity, not progress." : "Commits hidden."}</p>
                <p className="preview-dl"><span className="num">DECISION</span> Task 17 was reopened after merge. Worth 5 points.</p>
                <p className="preview-when num">quiet hours {quiet}</p>
              </Slip>
            </aside>
          </div>
        ) : null}

        {section === "5" ? (
          <>
            <h1 className="page__title">Weights and classification</h1>
            <div className="entries">
              <Entry
                label="The scale"
                section="5.1"
                hint="Fixed. A tunable scale is how teams game it."
                control={
                  <div className="wkey">
                    {(["S", "M", "L"] as const).map((w) => (
                      <figure key={w}>
                        <svg width={44} height={44} viewBox="0 0 44 44" aria-hidden="true">
                          <circle cx="22" cy="22" r={20 * Math.sqrt(WEIGHT_PTS[w] / 5)} className="wkey__ring" />
                        </svg>
                        <figcaption className="num">{w} = {WEIGHT_PTS[w]}</figcaption>
                      </figure>
                    ))}
                  </div>
                }
              />
              <Entry label="Reopened tasks lose their points" section="5.4" hint="This is why the track drags backwards." control={<Switch checked locked label="Reopened tasks lose their points" onChange={() => undefined} />} />
              <Entry label="Hold low-confidence classifications" section="5.5" control={<Switch checked label="Hold low-confidence classifications" onChange={touch} />} />
            </div>
          </>
        ) : null}

        {section === "6" ? (
          <>
            <h1 className="page__title">Alerts</h1>
            <div className="entries">
              {["PR opened", "PR merged", "Review requested", "CI failed", "CI recovered", "Stale branch", "Force-push to protected branch"].map((l) => (
                <Entry key={l} label={l} control={<Switch checked={l !== "Review requested"} label={l} onChange={touch} />} />
              ))}
              <Entry label="Stale after" section="6.8" control={<TextInput label="Stale after" value="6 days" onChange={touch} />} />
            </div>
            <Notice kind="check" title="Alerts ignore quiet hours?" detail="Currently off. If you turn this on, an alert will arrive at 3am." />
          </>
        ) : null}

        {section === "7" ? (
          <>
            <h1 className="page__title">Secret scanning and safety</h1>
            <div className="entries">
              <Entry label="Scan before any model call" section="7.1" hint="Locked on. Turning it off would let a credential reach a model." control={<Switch checked locked label="Scan before any model call" onChange={() => undefined} />} />
              <Entry label="Ignore paths" section="7.2" hint="Glob patterns. Matching files are never scanned and never sent." control={<TextInput label="Ignore paths" value="test/fixtures/**, docs/example.env" onChange={touch} />} />
              <Entry label="Retain webhook payloads" section="7.3" control={<Segmented legend="Retention" value="30" onChange={touch} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />} />
              <Entry label="Download my data" section="7.4" control={<button type="button" className="ld-btn ld-btn--mono">Download</button>} />
            </div>
          </>
        ) : null}

        {section === "9" ? (
          <>
            <h1 className="page__title">API and webhooks</h1>
            <div className="entries">
              <Entry label="Webhook endpoint" section="9.1" hint="Read-only. Outbound only; nothing is posted to you." control={<code className="path">https://commitit-five.vercel.app/api/webhook</code>} />
              <Entry label="Personal API tokens" section="9.2" control={<button type="button" className="ld-btn ld-btn--mono">Create token</button>} />
            </div>
          </>
        ) : null}

        {section === "10" ? (
          <>
            <h1 className="page__title">Danger zone</h1>
            <div className="danger">
              {[
                { t: "Void workspace", d: "Deletes every repository link, every digest and every preference. Your GitHub installation is left alone. This cannot be undone." },
                { t: "Revoke the GitHub App", d: "Stops all deliveries immediately. Queued digests will fail rather than send." },
                { t: "Delete all stored data", d: "Removes every row CommitIt holds. Nothing is recoverable afterwards." },
              ].map((d) => (
                <div className="danger__slip" key={d.t}>
                  <h3 className="danger__title">{d.t}</h3>
                  <p className="danger__body">{d.d}</p>
                  <TextInput label={`Type ${d.t.toLowerCase()} to confirm`} value="" onChange={() => undefined} />
                  <button type="button" className="void-btn">Void</button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {section === "8" ? (
          <>
            <h1 className="page__title">Team</h1>
            <div className="entries">
              <Entry label="Members" section="8.1" hint="Roles are Owner, Admin, Member. Anyone can be removed." control={<span className="num">3 members</span>} />
              <Entry label="Invite by GitHub username" section="8.2" control={<TextInput label="Invite" value="" onChange={touch} placeholder="username" />} />
            </div>
          </>
        ) : null}

        <UnpostedBar count={dirty} onDiscard={() => setDirty(0)} onPost={post} />
      </div>
    </div>
  );
}

const WEIGHT_PTS = { S: 1, M: 3, L: 5 } as const;

/* ============================================================== /login */

export function Login() {
  return (
    <div className="public login">
      <div className="page login__inner">
        <h1 className="ld-display">
          Commits are not
          <br />
          progress.
        </h1>
        <p className="ld-lede ld-pencil">
          <em>Finished work, weighted.</em> That is the only number we send.
        </p>
        <p className="login__cta">
          <a className="ld-btn ld-btn--primary" href="/app">
            Continue with GitHub
          </a>
        </p>
        <div className="login__fine num">
          <p>CommitIt requests the minimum an app can ask for, and reads no more than it needs:</p>
          <ul>
            <li>Repository metadata — read</li>
            <li>Contents — read, to scan before summarising</li>
            <li>Pull requests — read</li>
            <li>Checks — read</li>
          </ul>
          <p>It never asks for write access to your code.</p>
        </div>
      </div>
    </div>
  );
}

/* ============================================== /404 and /error */

export function NotFound({ what = "Page" }: { what?: string }) {
  return (
    <div className="public">
      <div className="page">
        <h1 className="ld-display">Not on the books.</h1>
        <p className="struck num">{what}</p>
        <p className="ld-body ld-pencil">
          That address does not match anything we keep. It may have been renamed, or the link may have
          been typed by hand.
        </p>
        <p>
          <a className="ld-btn" href="/app">
            Back to overview
          </a>
        </p>
      </div>
    </div>
  );
}
