import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

const Home = () => {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background">
      <h1 className="text-5xl font-bold tracking-tight text-foreground">
        {t("home.title")}
      </h1>
      <div className="flex gap-4">
        <Button asChild size="lg">
          <Link to="/administration">{t("home.administration")}</Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/work-area">{t("home.workArea")}</Link>
        </Button>
      </div>
    </div>
  );
};

export default Home;
