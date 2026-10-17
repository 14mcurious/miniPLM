import { Button } from "@/components/ui/button";
import BackLink from "@/components/BackLink";
import { useI18n } from "@/i18n";
import { Link } from "react-router-dom";
import CustomTypesManager from "@/pages/config/CustomTypesManager";
import RolesManager from "@/pages/config/RolesManager";
import RoleListsManager from "@/pages/config/RoleListsManager";

/**
 * Separate page for the workflow (progress) custom-type configuration.
 * Reached from the main Configuration page via a dedicated button so the
 * workflow type manager no longer crowds the general settings page.
 */
const WorkflowConfiguration = () => {
  const { t } = useI18n();

  return (
    <>
      <BackLink
        to="/administration/configuration"
        label={t("configuration.title")}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
                {t("workflowConfig.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("workflowConfig.description")}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/administration/configuration">
                {t("configuration.title")}
              </Link>
            </Button>
          </div>

          <RolesManager />
          <RoleListsManager />
          <CustomTypesManager category="workflow" />
        </div>
      </div>
    </>
  );
};

export default WorkflowConfiguration;
