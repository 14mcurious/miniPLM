import { Navigate } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useWorkAreaProject } from "@/hooks/useWorkAreaProject";
import { Button } from "@/components/ui/button";

/**
 * Work area entry point.
 *
 * With a current project (persisted per user) the user is sent straight
 * to the project search; without one a short notice and a "select
 * project" call to action are shown (D3/D4: the old card page is gone).
 */
const WorkArea = () => {
  const { t } = useI18n();
  const { status } = useAuth();
  const { projectId, openPicker } = useWorkAreaProject();

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  if (projectId != null) {
    return <Navigate to={`/work-area/${projectId}/search`} replace />;
  }

  return (
    <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
      <div className="w-full max-w-2xl">
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
          {t("workArea.title")}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t("workArea.subtitle")}
        </p>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">
            {t("wa.sidebar.noProject")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("wa.sidebar.noProjectHint")}
          </p>
          <div className="mt-4">
            <Button type="button" onClick={openPicker}>
              {t("wa.sidebar.selectProject")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkArea;
