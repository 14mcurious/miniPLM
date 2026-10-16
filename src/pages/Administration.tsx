import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import BackLink from "@/components/BackLink";

const Administration = () => {
  const { t } = useI18n();

  return (
    <>
      <BackLink to="/" label={t("home.title")} />
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background">
        <h1 className="text-5xl font-bold tracking-tight text-foreground">
          {t("administration.title")}
        </h1>
        <div className="flex flex-wrap justify-center gap-4">
          <Button asChild size="lg">
            <Link to="/administration/users">{t("administration.users")}</Link>
          </Button>
          <Button asChild size="lg">
            <Link to="/administration/groups">{t("administration.groups")}</Link>
          </Button>
          <Button asChild size="lg">
            <Link to="/administration/projects">
              {t("administration.projects")}
            </Link>
          </Button>
          <Button asChild size="lg">
            <Link to="/administration/configuration">
              {t("administration.configuration")}
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
};

export default Administration;
