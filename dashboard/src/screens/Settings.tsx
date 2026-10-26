/**
 * Settings. One screen for everything you configure about a repository:
 * how it talks to you, what it tells you about, who it thinks you are, and
 * which repositories are connected.
 *
 * These used to be four destinations in the rail. They are all configuration,
 * not places you browse, and a lead opens them once and then rarely again —
 * so they are sections here, switched by a row of tabs. Each keeps its own
 * heading, so only one screen's worth of structure is on the page at a time.
 */
import { useState } from "react";
import { Digests } from "./Digests.js";
import { Alerts } from "./Alerts.js";
import { People } from "./People.js";
import { RepoSettings } from "./RepoSettings.js";

const SECTIONS = [
  { id: "delivery", label: "Delivery" },
  { id: "alerts", label: "Alerts" },
  { id: "people", label: "People" },
  { id: "repositories", label: "Repositories" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function Settings() {
  const [section, setSection] = useState<SectionId>("delivery");

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="display">Settings</h1>
        <p className="screen__lede">How this repository reports to you, and who it thinks you are.</p>
      </div>

      <div className="segmented segmented--boxed" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`settings-tab-${s.id}`}
            aria-selected={section === s.id}
            aria-controls={`settings-panel-${s.id}`}
            className="segmented__item"
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`settings-panel-${section}`}
        aria-labelledby={`settings-tab-${section}`}
        className="settings__panel"
      >
        {section === "delivery" ? <Digests /> : null}
        {section === "alerts" ? <Alerts /> : null}
        {section === "people" ? <People /> : null}
        {section === "repositories" ? <RepoSettings /> : null}
      </div>
    </div>
  );
}
