import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { AuthProvider } from "@/hooks/useAuth";
import RequireAuth from "@/components/RequireAuth";
import RequireAdmin from "@/components/RequireAdmin";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Administration from "./pages/Administration";
import WorkArea from "./pages/WorkArea";
import WorkAreaProject from "./pages/WorkAreaProject";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <AuthProvider>
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
