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
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { AppShell as OldAppShell } from "./components/AppShell.js";
import { Skeleton } from "./components/surfaces.js";
import { isReviewMode } from "./api/index.js";
import { needsConnectWizard } from "./lib/connect.js";
import { useMe, useRepoRef, useRepos } from "./lib/queries.js";
import { useLive } from "./lib/useLive.js";
import { currentScenario, scenarioLabel } from "./lib/scenario.js";
import { Today } from "./screens/Today.js";
import { AppShell } from "./app/Shell.js";
import { OpsProvider } from "./app/data.js";
import { ToastHost } from "./components/kit.js";

const Landing = lazy(() => import("./screens/Landing.js").then((m) => ({ default: m.Landing })));
const LedgerSite = lazy(() =>
  import("./site/LedgerSite.js").then((m) => ({ default: m.LedgerSite })),
);
// The new authenticated app (the ledger language). Aliased because the old
// screens above still expose same-named routes for deep links.
const OldOnboarding = lazy(() => import("./screens/Onboarding.js").then((m) => ({ default: m.Onboarding })));
const Goals = lazy(() => import("./screens/Goals.js").then((m) => ({ default: m.Goals })));
const Goal = lazy(() => import("./screens/Goal.js").then((m) => ({ default: m.Goal })));
const People = lazy(() => import("./screens/People.js").then((m) => ({ default: m.People })));
const Digests = lazy(() => import("./screens/Digests.js").then((m) => ({ default: m.Digests })));
const Alerts = lazy(() => import("./screens/Alerts.js").then((m) => ({ default: m.Alerts })));
const OldSettings = lazy(() => import("./screens/Settings.js").then((m) => ({ default: m.Settings })));
const RepoSettings = lazy(() =>
  import("./screens/RepoSettings.js").then((m) => ({ default: m.RepoSettings })),
);

const AppOverview = lazy(() => import("./app/pages.js").then((m) => ({ default: m.Overview })));
const AppRepoDetail = lazy(() => import("./app/pages.js").then((m) => ({ default: m.RepoDetail })));
const AppTasks = lazy(() => import("./app/pages.js").then((m) => ({ default: m.TaskLedger })));
const AppDigests = lazy(() => import("./app/pages.js").then((m) => ({ default: m.DigestLedger })));
const AppAlerts = lazy(() => import("./app/pages.js").then((m) => ({ default: m.AlertFeed })));
const AppChats = lazy(() => import("./app/pages.js").then((m) => ({ default: m.ChatLedger })));
const AppPipeline = lazy(() => import("./app/pages.js").then((m) => ({ default: m.Pipeline })));
const AppSecurity = lazy(() => import("./app/pages.js").then((m) => ({ default: m.Security })));
const AppSettings = lazy(() => import("./app/Settings.js").then((m) => ({ default: m.Settings })));
const DigestDetail = lazy(() => import("./app/details.js").then((m) => ({ default: m.DigestDetail })));
const ChatDetail = lazy(() => import("./app/details.js").then((m) => ({ default: m.ChatDetail })));
const Login = lazy(() => import("./app/Settings.js").then((m) => ({ default: m.Login })));
const AppNotFound = lazy(() => import("./app/Settings.js").then((m) => ({ default: m.NotFound })));
const OnboardingPublic = lazy(() => import("./app/Public.js").then((m) => ({ default: m.Onboarding })));
const Terms = lazy(() => import("./app/Public.js").then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import("./app/Public.js").then((m) => ({ default: m.Privacy })));
const Changelog = lazy(() => import("./app/Public.js").then((m) => ({ default: m.Changelog })));
const Docs = lazy(() => import("./app/Public.js").then((m) => ({ default: m.Docs })));
const RouteErrorPage = lazy(() => import("./app/Public.js").then((m) => ({ default: m.RouteError })));

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

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Everything behind the old rail and tab bar (deep links kept working). */
function OldShell() {
  const { ref, repoId, setRef } = useRepoRef();
  const repos = useRepos();
  const live = useLive(repoId);

  return (
    <OldAppShell
      repoRef={ref}
      repos={repos.data ?? []}
      onRepoChange={setRef}
      hasNew={Boolean(live.newActivity)}
    >
      <ScenarioNote />
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </OldAppShell>
  );
}

/** The new authenticated shell, wrapped in the toast host. */
function NewShell() {
  return (
    <OpsProvider>
      <AppShell>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </AppShell>
    </OpsProvider>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

/**
 * The connect wizard is the first-run path, and every "Connect a repo" button
 * on the marketing pages points at it. A person who is already signed in and
 * already watches a repository has nothing to do here, so they go to the
 * dashboard instead of walking the four steps again. `?repo=` opts back in —
 * that is how "Reconnect GitHub" asks for one repository on purpose.
 */
function ConnectGate() {
  const me = useMe();
  const [params] = useSearchParams();
  const account = me.data;
  // `?repo=` is how the product asks for one repository on purpose (RepoSettings'
  // "Reconnect GitHub", Digests' empty state). Those links never wait and never
  // bounce: the answer to them cannot be "go to the dashboard".
  const repoScoped = params.has("repo");

  if (!repoScoped) {
    // The route is lazy anyway, so this is the same skeleton the chunk load
    // already shows; it just lasts until the account is known. That is what
    // keeps a returning visitor from seeing — and clicking — a wizard that is
    // about to be taken away.
    if (me.isPending) return <RouteFallback />;

    if (
      account &&
      !needsConnectWizard({
        signedIn: account.signedIn,
        repoCount: account.repos.length,
        repoScoped,
        reviewMode: isReviewMode(),
      })
    ) {
      return <Navigate to="/today" replace />;
    }
  }

  // Signed out, still setting up, or `me` could not be read: the wizard.
  return <OldOnboarding />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}><ToastHost>
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
          {/* Public legal/docs — no shell. */}
          <Route path="/terms" element={<Lazy><Terms /></Lazy>} />
          <Route path="/privacy" element={<Lazy><Privacy /></Lazy>} />
          <Route path="/changelog" element={<Lazy><Changelog /></Lazy>} />
          <Route path="/docs" element={<Lazy><Docs /></Lazy>} />
          <Route path="/login" element={<Lazy><Login /></Lazy>} />
          <Route path="/onboarding" element={<Lazy><OnboardingPublic /></Lazy>} />

          {/* The new authenticated app. */}
          <Route path="/app" element={<NewShell />}>
            <Route index element={<Lazy><AppOverview /></Lazy>} />
            <Route path="repos/:repoId" element={<Lazy><AppRepoDetail /></Lazy>} />
            <Route path="tasks" element={<Lazy><AppTasks /></Lazy>} />
            <Route path="digests" element={<Lazy><AppDigests /></Lazy>} />
            <Route path="digests/:digestId" element={<Lazy><DigestDetail /></Lazy>} />
            <Route path="alerts" element={<Lazy><AppAlerts /></Lazy>} />
            <Route path="chats" element={<Lazy><AppChats /></Lazy>} />
            <Route path="chats/:chatId" element={<Lazy><ChatDetail /></Lazy>} />
            <Route path="system" element={<Lazy><AppPipeline /></Lazy>} />
            <Route path="security" element={<Lazy><AppSecurity /></Lazy>} />
            <Route path="settings" element={<Lazy><AppSettings /></Lazy>} />
          </Route>

          {/* The previous dashboard, kept reachable so old bookmarks and Telegram
              links to single sections keep resolving. */}
          <Route element={<OldShell />}>
            <Route path="/today" element={<Today />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/goals/:id" element={<Goal />} />
            <Route path="/settings" element={<OldSettings />} />
            <Route path="/people" element={<People />} />
            <Route path="/digests" element={<Digests />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/repos" element={<RepoSettings />} />
            <Route path="/connect/:step" element={<ConnectGate />} />
          </Route>
          <Route path="*" element={<Lazy><AppNotFound /></Lazy>} />
        </Routes>
      </BrowserRouter>
    </ToastHost></QueryClientProvider>
  );
}
