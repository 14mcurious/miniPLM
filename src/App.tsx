import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Home from "./pages/Home";
import Administration from "./pages/Administration";
import WorkArea from "./pages/WorkArea";
import Users from "./pages/Users";
import UsersList from "./pages/UsersList";
import NewUser from "./pages/NewUser";
import Groups from "./pages/Groups";
import GroupsList from "./pages/GroupsList";
import NewGroup from "./pages/NewGroup";
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
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <div className="fixed right-4 top-3 z-50">
          <LanguageSwitcher />
        </div>
        <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/administration" element={<Administration />} />
          <Route path="/administration/users" element={<Users />} />
          <Route path="/administration/users/users-list" element={<UsersList />} />
          <Route path="/administration/users/new-user" element={<NewUser />} />
          <Route path="/administration/groups" element={<Groups />} />
          <Route
            path="/administration/groups/groups-list"
            element={<GroupsList />}
          />
          <Route
            path="/administration/groups/new-group"
            element={<NewGroup />}
          />
          <Route path="/administration/projects" element={<Projects />} />
          <Route
            path="/administration/projects/projects-list"
            element={<ProjectsList />}
          />
          <Route
            path="/administration/projects/new-project"
            element={<NewProject />}
          />
          <Route
            path="/administration/projects/project-edit/:projectId"
            element={<ProjectEdit />}
          />
          <Route path="/administration/configuration" element={<Configuration />} />
          <Route path="/work-area" element={<WorkArea />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </HashRouter>
      </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
