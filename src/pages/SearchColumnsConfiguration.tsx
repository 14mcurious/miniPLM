import { Button } from "@/components/ui/button";
import BackLink from "@/components/BackLink";
import { useI18n } from "@/i18n";
import { Link } from "react-router-dom";
import SearchColumnsSection from "@/pages/config/SearchColumnsSection";

/**
 * Separate page for the search results columns configuration.
 * Reached from the main Configuration page via a dedicated button so the
 * columns manager no longer crowds the general settings page.
 */
const SearchColumnsConfiguration = () => {
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
                {t("searchColumnsConfig.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("searchColumnsConfig.description")}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/administration/configuration">
                {t("configuration.title")}
              </Link>
            </Button>
          </div>

          <SearchColumnsSection />
        </div>
      </div>
    </>
  );
};

export default SearchColumnsConfiguration;
