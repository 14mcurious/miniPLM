import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { Link } from "react-router-dom";

interface WorkflowSection {
  to: string;
  titleKey: string;
  descriptionKey: string;
  openKey: string;
}

const SECTIONS: WorkflowSection[] = [
  {
    to: "/administration/configuration/workflow/roles",
    titleKey: "workflowRoles.title",
    descriptionKey: "workflowRoles.description",
    openKey: "workflowRoles.open",
  },
  {
    to: "/administration/configuration/workflow/role-lists",
    titleKey: "workflowRoleLists.title",
    descriptionKey: "workflowRoleLists.description",
    openKey: "workflowRoleLists.open",
  },
  {
    to: "/administration/configuration/workflow/progress-types",
    titleKey: "workflowProgressTypes.title",
    descriptionKey: "workflowProgressTypes.description",
    openKey: "workflowProgressTypes.open",
  },
];

/**
 * Hub page for the workflow configuration. The Roles, Role lists and
 * Workflow — progress types sections each live on a dedicated page,
 * reachable from the buttons rendered on this page.
 */
const WorkflowConfiguration = () => {
  const { t } = useI18n();

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl space-y-6">
          <div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
              {t("workflowConfig.title")}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {t("workflowConfig.description")}
            </p>
          </div>

          {SECTIONS.map((section) => (
            <div
              key={section.to}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card p-5 shadow-sm"
            >
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {t(section.titleKey)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(section.descriptionKey)}
                </p>
              </div>
              <Button asChild variant="outline">
                <Link to={section.to}>{t(section.openKey)}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default WorkflowConfiguration;
