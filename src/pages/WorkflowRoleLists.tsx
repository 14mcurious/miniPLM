import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { Link } from "react-router-dom";
import RoleListsManager from "@/pages/config/RoleListsManager";

/**
 * Dedicated page for the workflow role lists section.
 * Reached from the Workflow configuration page via a dedicated button.
 */
const WorkflowRoleLists = () => {
  const { t } = useI18n();

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
                {t("workflowRoleLists.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("workflowRoleLists.description")}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/administration/configuration/workflow">
                {t("workflowConfig.title")}
              </Link>
            </Button>
          </div>

          <RoleListsManager />
        </div>
      </div>
    </>
  );
};

export default WorkflowRoleLists;
