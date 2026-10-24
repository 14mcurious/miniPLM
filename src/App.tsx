import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { warmWorkAreaActions } from "@/lib/warmup";
import RequireAuth from "@/components/RequireAuth";
import RequireAdmin from "@/components/RequireAdmin";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Administration from "./pages/Administration";
import WorkArea from "./pages/WorkArea";
import WorkAreaProject from "./pages/WorkAreaProject";
import WorkAreaWorkspaces from "./pages/WorkAreaWorkspaces";
import WorkAreaWorkspaceDetail from "./pages/WorkAreaWorkspaceDetail";
import WorkAreaContainerDetail from "./pages/WorkAreaContainerDetail";
import WorkAreaInstanceNew from "./pages/WorkAreaInstanceNew";
import WorkAreaInstanceDetail from "./pages/WorkAreaInstanceDetail";
import WorkInstanceTemplates from "./pages/WorkInstanceTemplates";
import WorkAreaSearch from "./pages/WorkAreaSearch";
import Users from "./pages/Users";
import UsersList from "./pages/UsersList";
import NewUser from "./pages/NewUser";
import UserEdit from "./pages/UserEdit";
import Groups from "./pages/Groups";
import GroupsList from "./pages/GroupsList";
import NewGroup from "./pages/NewGroup";
import GroupEdit from "./pages/GroupEdit";
import Projects from "./pages/Projects";
import ProjectsList from "./pages/ProjectsList";
import NewProject from "./pages/NewProject";
import ProjectEdit from "./pages/ProjectEdit";
import Configuration from "./pages/Configuration";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <AuthProvider>
        <WorkAreaWarmup />
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <div className="fixed right-4 top-3 z-50">
            <LanguageSwitcher />
          </div>
          <HashRouter>
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

              {/* Administration area: SysAdmin members only. */}
              <Route
                path="/administration"
                element={
                  <RequireAdmin>
                    <Administration />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/users"
                element={
                  <RequireAdmin>
                    <Users />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/users/users-list"
                element={
                  <RequireAdmin>
                    <UsersList />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/users/new-user"
                element={
                  <RequireAdmin>
                    <NewUser />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/users/user-edit/:userId"
                element={
                  <RequireAdmin>
                    <UserEdit />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/groups"
                element={
                  <RequireAdmin>
                    <Groups />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/groups/groups-list"
                element={
                  <RequireAdmin>
                    <GroupsList />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/groups/new-group"
                element={
                  <RequireAdmin>
                    <NewGroup />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/groups/group-edit/:groupId"
                element={
                  <RequireAdmin>
                    <GroupEdit />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/projects"
                element={
                  <RequireAdmin>
                    <Projects />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/projects/projects-list"
                element={
                  <RequireAdmin>
                    <ProjectsList />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/projects/new-project"
                element={
                  <RequireAdmin>
                    <NewProject />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/projects/project-edit/:projectId"
                element={
                  <RequireAdmin>
                    <ProjectEdit />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration"
                element={
                  <RequireAdmin>
                    <Configuration />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/workflow"
                element={
                  <RequireAdmin>
                    <WorkflowConfiguration />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/workflow/roles"
                element={
                  <RequireAdmin>
                    <WorkflowRoles />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/workflow/role-lists"
                element={
                  <RequireAdmin>
                    <WorkflowRoleLists />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/workflow/progress-types"
                element={
                  <RequireAdmin>
                    <WorkflowProgressTypes />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/workflow/progress-types/new"
                element={
                  <RequireAdmin>
                    <WorkflowProgressTypeEdit />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/workflow/progress-types/:typeId/edit"
                element={
                  <RequireAdmin>
                    <WorkflowProgressTypeEdit />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/custom-types"
                element={
                  <RequireAdmin>
                    <CustomTypesConfiguration />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/search-columns"
                element={
                  <RequireAdmin>
                    <SearchColumnsConfiguration />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/templates"
                element={
                  <RequireAdmin>
                    <WorkInstanceTemplates />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/security"
                element={
                  <RequireAdmin>
                    <SecuritySettings />
                  </RequireAdmin>
                }
              />
              <Route
                path="/administration/configuration/project"
                element={
                  <RequireAdmin>
                    <ProjectSettings />
                  </RequireAdmin>
                }
              />

              {/* Work Area: session + per-project access enforced. */}
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
                    <WorkAreaProject />
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId/workspaces"
                element={
                  <RequireAuth>
                    <WorkAreaWorkspaces />
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId/workspaces/:workspaceId"
                element={
                  <RequireAuth>
                    <WorkAreaWorkspaceDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId/workspaces/:workspaceId/work-instances/new"
                element={
                  <RequireAuth>
                    <WorkAreaInstanceNew />
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId/work-containers/:containerId"
                element={
                  <RequireAuth>
                    <WorkAreaContainerDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId/work-containers/:containerId/history"
                element={
                  <RequireAuth>
                    <Suspense fallback={<LazyRouteFallback />}>
                      <WorkAreaContainerHistory />
                    </Suspense>
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId/work-instances/:instanceId"
                element={
                  <RequireAuth>
                    <WorkAreaInstanceDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/work-area/:projectId/search"
                element={
                  <RequireAuth>
                    <WorkAreaSearch />
                  </RequireAuth>
                }
              />

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
      </AuthProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
