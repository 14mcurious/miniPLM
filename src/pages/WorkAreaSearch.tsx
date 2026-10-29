import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import WorkAreaSearchView from "@/components/WorkAreaSearchView";

/**
 * Project-level search page (inside the work area layout): full-text
 * search over the elements of the whole project work area. The shared
 * view is reused by the work space pages with a work space scope.
 */
const WorkAreaSearch = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  return <WorkAreaSearchView projectId={Number(projectId)} />;
};

export default WorkAreaSearch;
