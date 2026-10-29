import { Link, Navigate, useParams } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

/**
 * Legacy work spaces page (D2): the card/tree page is no longer used.
 * Work spaces are listed in the side panel and their elements are found
 * through the search; this page only explains the change and links to
 * the search of the project work area.
 */
const WorkAreaWorkspaces = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  return (
    <div className="min-w-0">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground">
        {t("wa.workspaces")}
      </h1>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          {t("wa.workspacesNotice")}
        </p>
        <div className="mt-4">
          <Button asChild>
            <Link to={`/work-area/${projectId}/search`}>
              {t("wa.workspacesNoticeGo")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WorkAreaWorkspaces;
