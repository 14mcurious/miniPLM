import { Outlet } from "react-router-dom";
import WorkAreaSidebar from "@/components/WorkAreaSidebar";

/**
 * Shell of the work area: the side panel (project header and work space
 * tree) stays on the left with the same design as the administration
 * sidebar while the work area page is rendered by the nested routes
 * (<Outlet />) in the right pane.
 */
const WorkAreaLayout = () => (
  <div className="flex min-h-screen bg-background">
    <WorkAreaSidebar />
    <main className="min-w-0 flex-1 p-4 pt-14">
      <Outlet />
    </main>
  </div>
);

export default WorkAreaLayout;
