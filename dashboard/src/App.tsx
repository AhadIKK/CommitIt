/**
 * The application frame and the routes.
 *
 * Route-level code splitting keeps the first paint small: Today is the landing
 * screen for a signed-in person, so it loads first and the rest arrive on demand.
 * Landing is public and does not use the frame at all — no rail, no tab bar, one
 * column.
 */
import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { Skeleton } from "./components/surfaces.js";
import { useRepoRef, useRepos } from "./lib/queries.js";
import { useLive } from "./lib/useLive.js";
import { currentScenario, scenarioLabel } from "./lib/scenario.js";
import { Today } from "./screens/Today.js";

const Landing = lazy(() => import("./screens/Landing.js").then((m) => ({ default: m.Landing })));
const LedgerSite = lazy(() =>
  import("./site/LedgerSite.js").then((m) => ({ default: m.LedgerSite })),
);
const Onboarding = lazy(() => import("./screens/Onboarding.js").then((m) => ({ default: m.Onboarding })));
const Goals = lazy(() => import("./screens/Goals.js").then((m) => ({ default: m.Goals })));
const Goal = lazy(() => import("./screens/Goal.js").then((m) => ({ default: m.Goal })));
const People = lazy(() => import("./screens/People.js").then((m) => ({ default: m.People })));
const Digests = lazy(() => import("./screens/Digests.js").then((m) => ({ default: m.Digests })));
const Alerts = lazy(() => import("./screens/Alerts.js").then((m) => ({ default: m.Alerts })));
const Settings = lazy(() => import("./screens/Settings.js").then((m) => ({ default: m.Settings })));
const RepoSettings = lazy(() =>
  import("./screens/RepoSettings.js").then((m) => ({ default: m.RepoSettings })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

/** The ?state= switch is a review tool; when it is on, say so plainly. */
function ScenarioNote() {
  const label = scenarioLabel(currentScenario());
  if (!label) return null;
  return (
    <p className="live live--stale" role="status">
      <span aria-hidden="true">◆</span>
      <span>{label}</span>
    </p>
  );
}

function RouteFallback() {
  return (
    <div className="screen" aria-busy="true">
      <Skeleton variant="display" width="60%" />
      <Skeleton variant="line" width="90%" />
      <Skeleton variant="line-sm" width="45%" />
      <span className="visually-hidden">Loading.</span>
    </div>
  );
}

function NotFound() {
  return (
    <div className="screen">
      <h1 className="display">That page is not here</h1>
      <p className="screen__lede">
        The address you followed does not match a screen.{" "}
        <Link className="btn btn--inline" to="/today">
          Go to today
        </Link>
      </p>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Everything behind the rail and the tab bar. */
function Shell() {
  const { ref, repoId, setRef } = useRepoRef();
  const repos = useRepos();
  const live = useLive(repoId);

  return (
    <AppShell
      repoRef={ref}
      repos={repos.data ?? []}
      onRepoChange={setRef}
      hasNew={Boolean(live.newActivity)}
    >
      <ScenarioNote />
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<RouteFallback />}>
                <LedgerSite />
              </Suspense>
            }
          />
          {/* The previous product-first landing, kept reachable for comparison. */}
          <Route
            path="/welcome"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Landing />
              </Suspense>
            }
          />
          <Route element={<Shell />}>
            <Route path="/today" element={<Today />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/goals/:id" element={<Goal />} />
            <Route path="/settings" element={<Settings />} />
            {/* Deep links still resolve: the rail shows Settings, but an old
                bookmark or a Telegram link to a single section keeps working. */}
            <Route path="/people" element={<People />} />
            <Route path="/digests" element={<Digests />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/repos" element={<RepoSettings />} />
            <Route path="/connect/:step" element={<Onboarding />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
