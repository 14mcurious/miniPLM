import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import BackLink from "@/components/BackLink";

const Users = () => {
  const { t } = useI18n();

  return (
    <>
      <BackLink to="/administration" label={t("administration.title")} />
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          {t("users.title")}
        </h1>
        <div className="flex flex-wrap justify-center gap-4">
          <Button asChild size="lg">
            <Link to="/administration/users/users-list">
              {t("users.usersList")}
            </Link>
          </Button>
          <Button asChild size="lg">
            <Link to="/administration/users/new-user">
              {t("users.newUser")}
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
};

export default Users;
