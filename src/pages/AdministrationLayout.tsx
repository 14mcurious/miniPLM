import { Outlet } from "react-router-dom";
import AdminSidebar from "@/components/AdminSidebar";

/**
 * Shell of the administration area: the expandable navigation menu stays
 * on the left while the page selected in the right pane is rendered by
 * the nested routes (<Outlet />).
 */
const AdministrationLayout = () => (
  <div className="flex min-h-screen bg-background">
    <AdminSidebar />
    <main className="min-w-0 flex-1">
      <Outlet />
    </main>
  </div>
);

export default AdministrationLayout;
