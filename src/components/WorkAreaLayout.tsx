import { Outlet } from "react-router-dom";
import WorkAreaSidebar from "@/components/WorkAreaSidebar";

/**
 * Work area layout: a persistent side panel (current project header and
 * work space tree) on the left and the selected work area page on the
 * right. Replaces the old card-based hub: navigation happens through the
 * side panel and the search.
 */
const WorkAreaLayout = () => {
  return (
    <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
      <div className="grid w-full max-w-[1400px] items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <WorkAreaSidebar />
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default WorkAreaLayout;
