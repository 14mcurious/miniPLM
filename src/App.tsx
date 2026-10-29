import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { I18nProvider, useI18n } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import {
  WorkAreaProjectProvider,
  useWorkAreaProject,
} from "@/hooks/useWorkAreaProject";
import { warmWorkAreaActions } from "@/lib/warmup";
import RequireAuth from "@/components/RequireAuth";
import RequireAdmin from "@/components/RequireAdmin";
import Home from "./pages/Home";
import Login from "./pages/Login";
import AdministrationLayout from "./pages/AdministrationLayout";
import WorkArea from "./pages/WorkArea";
import WorkAreaLayout from "./components/WorkAreaLayout";
import WorkAreaWorkspaces from "./pages/WorkAreaWorkspaces";
import WorkAreaWorkspaceDetail from "./pages/WorkAreaWorkspaceDetail";
import WorkAreaContainerDetail from "./pages/WorkAreaContainerDetail";
import WorkAreaInstanceNew from "./pages/WorkAreaInstanceNew";
import WorkAreaInstanceDetail from "./pages/WorkAreaInstanceDetail";
import WorkInstanceTemplates from "./pages/WorkInstanceTemplates";
import WorkAreaSearch from "./pages/WorkAreaSearch";
import UsersList from "./pages/UsersList";
import NewUser from "./pages/NewUser";
import UserEdit from "./pages/UserEdit";
import GroupsList from "./pages/GroupsList";
import NewGroup from "./pages/NewGroup";
import GroupEdit from "./pages/GroupEdit";
import ProjectsList from "./pages/ProjectsList";
import NewProject from "./pages/NewProject";
import ProjectEdit from "./pages/ProjectEdit";
import CustomTypesConfiguration from "./pages/CustomTypesConfiguration";
import WorkflowConfiguration from "./pages/WorkflowConfiguration";
import WorkflowRoles from "./pages/WorkflowRoles";
import WorkflowRoleLists from "./pages/WorkflowRoleLists";
import WorkflowProgressTypes from "./pages/WorkflowProgressTypes";
import WorkflowProgressTypeEdit from "./pages/WorkflowProgressTypeEdit";
import SearchColumnsConfiguration from "./pages/SearchColumnsConfiguration";
import SecuritySettings from "./pages/SecuritySettings";
import ProjectSettings from "./pages/ProjectSettings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * Dedicated work-container history page, lazy loaded: the modification
 * history (and this page's code) is fetched only when the user opens it
 * from the container detail page, keeping the detail page fast.
 */
const WorkAreaContainerHistory = lazy(() =>
  import("./pages/WorkAreaContainerHistory")
);

/** Suspense fallback for lazy-loaded routes (i18n aware). */
const LazyRouteFallback = () => {
  const { t } = useI18n();
  return (
    <p className="px-4 pt-14 text-sm text-muted-foreground">
      {t("wa.loading")}
    </p>
  );
};

/**
 * Fires a best-effort warmup of the work-area actions as soon as a session
 * is active, so the first page the user opens renders against warm
 * OpenServerless instances instead of eating a cold start.
 */
const WorkAreaWarmup = () => {
  const { status } = useAuth();
  useEffect(() => {
    if (status === "authenticated") {
      warmWorkAreaActions();
    }
  }, [status]);
  return null;
};

/**
 * Monochromatic user icon: a single-color outline drawn with currentColor
 * so it inherits the control's text color (no multi-color artwork).
 */
const UserIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-5 w-5"
  >
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
  </svg>
);

/**
 * Monochromatic stylized house icon: a single outline drawn with
 * currentColor so it inherits one color from the surrounding control.
 * Shared home shortcut: this is the single place it is rendered.
 */
const HouseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-5 w-5"
  >
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.2V21h13V9.2" />
    <path d="M10 21v-6h4v6" />
  </svg>
);

/**
 * Monochromatic stylized folder icon: a single outline drawn with
 * currentColor so it inherits one color from the surrounding control.
 */
const ProjectIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-5 w-5"
  >
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

/**
 * Fixed top-right controls, rendered inside the auth provider. The home
 * shortcut is always visible (one click back to the product home, also
 * from the login page); the project and profile shortcuts are shown only
 * while a session is active. Both sit at the left of the language
 * selection box.
 */
const TopControls = () => {
  const { t } = useI18n();
  const { status } = useAuth();
  const { openPicker } = useWorkAreaProject();
  return (
    <div className="fixed right-4 top-3 z-50 flex items-center gap-2">
      {status === "authenticated" && (
        <button
          type="button"
          onClick={openPicker}
          aria-label={t("wa.projectPicker.choose")}
          title={t("wa.projectPicker.choose")}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ProjectIcon />
        </button>
      )}
      <Link
        to="/"
        aria-label={t("administration.homeButton")}
        title={t("administration.homeButton")}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HouseIcon />
      </Link>
      {status === "authenticated" && (
        <Link
          to="/profile"
          aria-label={t("profile.open")}
          title={t("profile.open")}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <UserIcon />
        </Link>
      )}
      <LanguageSwitcher />
    </div>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <WorkAreaProjectProvider>
          <WorkAreaWarmup />
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <HashRouter>
              <TopControls />
            <Routes>
              {/* Public: login flow (the only public entry). */}
              <Route path="/login" element={<Login />} />

              {/* Protected: everything else requires a valid session. */}
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <Home />
                  </RequireAuth>
                }
              />

              <Route
                path="/profile"
                element={
                  <RequireAuth>
                    <Profile />
                  </RequireAuth>
                }
              />

              {/* Administration area: SysAdmin members only. The layout
                  owns the expandable left menu; each nested route renders
                  the selected page in the right pane. */}
              <Route
                path="/administration"
                element={
                  <RequireAdmin>
                    <AdministrationLayout />
                  </RequireAdmin>
                }
              >
                <Route
                  index
                  element={
                    <Navigate to="/administration/users/users-list" replace />
                  }
                />
                <Route
                  path="users/users-list"
                  element={<UsersList />}
                />
                <Route path="users/new-user" element={<NewUser />} />
                <Route
                  path="users/user-edit/:userId"
                  element={<UserEdit />}
                />
                <Route
                  path="groups/groups-list"
                  element={<GroupsList />}
                />
                <Route path="groups/new-group" element={<NewGroup />} />
                <Route
                  path="groups/group-edit/:groupId"
                  element={<GroupEdit />}
                />
                <Route
                  path="projects/projects-list"
                  element={<ProjectsList />}
                />
                <Route
                  path="projects/new-project"
                  element={<NewProject />}
                />
                <Route
                  path="projects/project-edit/:projectId"
                  element={<ProjectEdit />}
                />
                <Route
                  path="projects/project-settings"
                  element={<ProjectSettings />}
                />
                <Route
                  path="configuration/workflow"
                  element={<WorkflowConfiguration />}
                />
                <Route
                  path="configuration/workflow/roles"
                  element={<WorkflowRoles />}
                />
                <Route
                  path="configuration/workflow/role-lists"
                  element={<WorkflowRoleLists />}
                />
                <Route
                  path="configuration/workflow/progress-types"
                  element={<WorkflowProgressTypes />}
                />
                <Route
                  path="configuration/workflow/progress-types/new"
                  element={<WorkflowProgressTypeEdit />}
                />
                <Route
                  path="configuration/workflow/progress-types/:typeId/edit"
                  element={<WorkflowProgressTypeEdit />}
                />
                <Route
                  path="configuration/custom-types"
                  element={<CustomTypesConfiguration />}
                />
                <Route
                  path="configuration/search-columns"
                  element={<SearchColumnsConfiguration />}
                />
                <Route
                  path="configuration/templates"
                  element={<WorkInstanceTemplates />}
                />
                <Route
                  path="configuration/security"
                  element={<SecuritySettings />}
                />
                {/* Legacy URL: project settings moved under Projects. */}
                <Route
                  path="configuration/project"
                  element={
                    <Navigate
                      to="/administration/projects/project-settings"
                      replace
                    />
                  }
                />
              </Route>

              {/* Work Area: session + per-project access enforced. The
                  layout provides the side panel (project header and
                  work space tree); the index route redirects to the
                  project search (compatibility with the old hub). */}
              <Route
                path="/work-area"
                element={
                  <RequireAuth>
                    <WorkArea />
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId"
                element={
                  <RequireAuth>
                    <WorkAreaLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<Navigate to="search" replace />} />
                <Route path="search" element={<WorkAreaSearch />} />
                <Route path="workspaces" element={<WorkAreaWorkspaces />} />
                <Route
                  path="workspaces/:workspaceId"
                  element={<WorkAreaWorkspaceDetail />}
                />
                <Route
                  path="workspaces/:workspaceId/work-instances/new"
                  element={<WorkAreaInstanceNew />}
                />
                <Route
                  path="work-containers/:containerId"
                  element={<WorkAreaContainerDetail />}
                />
                <Route
                  path="work-containers/:containerId/history"
                  element={
                    <Suspense fallback={<LazyRouteFallback />}>
                      <WorkAreaContainerHistory />
                    </Suspense>
                  }
                />
                <Route
                  path="work-instances/:instanceId"
                  element={<WorkAreaInstanceDetail />}
                />
              </Route>

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route
                path="*"
                element={
                  <RequireAuth>
                    <NotFound />
                  </RequireAuth>
                }
              />
            </Routes>
          </HashRouter>
        </TooltipProvider>
      </WorkAreaProjectProvider>
      </AuthProvider>
    </I18nProvider>
  </QueryClientProvider>
  );
};

export default App;
