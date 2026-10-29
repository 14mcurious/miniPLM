import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { Link } from "react-router-dom";
import CustomTypesManager from "@/pages/config/CustomTypesManager";

/**
 * Dedicated page for the workflow progress types section.
 * Reached from the Workflow configuration page via a dedicated button.
 */
const WorkflowProgressTypes = () => {
  const { t } = useI18n();

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
                {t("workflowProgressTypes.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("workflowProgressTypes.description")}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/administration/configuration/workflow">
                {t("workflowConfig.title")}
              </Link>
            </Button>
          </div>

          <CustomTypesManager
            category="workflow"
            editorRoutes={{
              new: "/administration/configuration/workflow/progress-types/new",
              edit: (id) =>
                `/administration/configuration/workflow/progress-types/${id}/edit`,
            }}
          />
        </div>
      </div>
    </>
  );
};

export default WorkflowProgressTypes;
