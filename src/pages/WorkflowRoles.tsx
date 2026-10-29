import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { Link } from "react-router-dom";
import RolesManager from "@/pages/config/RolesManager";

/**
 * Dedicated page for the workflow roles section.
 * Reached from the Workflow configuration page via a dedicated button.
 */
const WorkflowRoles = () => {
  const { t } = useI18n();

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
                {t("workflowRoles.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("workflowRoles.description")}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/administration/configuration/workflow">
                {t("workflowConfig.title")}
              </Link>
            </Button>
          </div>

          <RolesManager />
        </div>
      </div>
    </>
  );
};

export default WorkflowRoles;
