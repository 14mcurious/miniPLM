import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import BackLink from "@/components/BackLink";
import { useI18n } from "@/i18n";

interface ConfigSection {
  to: string;
  titleKey: string;
  descriptionKey: string;
  openKey: string;
}

const SECTIONS: ConfigSection[] = [
  {
    to: "/administration/configuration/project",
    titleKey: "projectSettings.title",
    descriptionKey: "projectSettings.description",
    openKey: "projectSettings.open",
  },
  {
    to: "/administration/configuration/security",
    titleKey: "securitySettings.title",
    descriptionKey: "securitySettings.description",
    openKey: "securitySettings.open",
  },
  {
    to: "/administration/configuration/custom-types",
    titleKey: "customTypesConfig.title",
    descriptionKey: "customTypesConfig.description",
    openKey: "customTypesConfig.open",
  },
  {
    to: "/administration/configuration/workflow",
    titleKey: "workflowConfig.title",
    descriptionKey: "workflowConfig.description",
    openKey: "workflowConfig.open",
  },
  {
    to: "/administration/configuration/search-columns",
    titleKey: "searchColumnsConfig.title",
    descriptionKey: "searchColumnsConfig.description",
    openKey: "searchColumnsConfig.open",
  },
];

const Configuration = () => {
  const { t } = useI18n();

  // Sort sections alphabetically by translated title so the order adapts to
  // the active language and improves discoverability.
  const sections = useMemo(
    () =>
      [...SECTIONS].sort((a, b) =>
        t(a.titleKey).localeCompare(t(b.titleKey))
      ),
    [t]
  );

  return (
    <>
      <BackLink to="/administration" label={t("administration.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl space-y-6">
          <div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
              {t("configuration.title")}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {t("configuration.description")}
            </p>
          </div>

          {sections.map((section) => (
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

export default Configuration;
