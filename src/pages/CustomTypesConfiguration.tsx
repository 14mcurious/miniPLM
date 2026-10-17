import { Button } from "@/components/ui/button";
import BackLink from "@/components/BackLink";
import { useI18n } from "@/i18n";
import { Link } from "react-router-dom";
import CustomTypesManager from "@/pages/config/CustomTypesManager";

/**
 * Separate page for the standard custom-type configuration.
 * Reached from the main Configuration page via a dedicated button so the
 * standard type manager no longer crowds the general settings page.
 */
const CustomTypesConfiguration = () => {
  const { t } = useI18n();

  return (
    <>
      <BackLink
        to="/administration/configuration"
        label={t("configuration.title")}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
                {t("customTypesConfig.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("customTypesConfig.description")}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/administration/configuration">
                {t("configuration.title")}
              </Link>
            </Button>
          </div>

          <CustomTypesManager category="standard" />
        </div>
      </div>
    </>
  );
};

export default CustomTypesConfiguration;
