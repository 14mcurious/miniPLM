import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";

const Home = () => {
  const { t } = useI18n();
  const { user, isAdmin, workAreas, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-4">
      <h1 className="text-5xl font-bold tracking-tight text-foreground">
        {t("home.title")}
      </h1>

      {user && (
        <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
          <span className="text-base font-medium text-foreground">
            {user.name} {user.surname}
          </span>
          <span>({user.loginName})</span>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-4">
        {isAdmin && (
          <Button asChild size="lg">
            <Link to="/administration">{t("home.administration")}</Link>
          </Button>
        )}
        <Button asChild size="lg">
          <Link to="/work-area">{t("home.workArea")}</Link>
        </Button>
        <Button size="lg" variant="outline" onClick={logout}>
          {t("home.logout")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("home.workAreasCount", {
          count: String(workAreas.length),
        })}
      </p>
    </div>
  );
};

export default Home;
