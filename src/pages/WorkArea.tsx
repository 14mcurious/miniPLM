import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import BackLink from "@/components/BackLink";

/**
 * Work Area: lists the work areas accessible to the current user.
 *
 * A work area is associated 1-to-1 with a project and carries the project's
 * own name; access is derived from the (enabled) groups the user belongs to.
 * Selecting a project enters the work area of that project.
 */
const WorkArea = () => {
  const { t } = useI18n();
  const { workAreas } = useAuth();

  return (
    <>
      <BackLink to="/" label={t("home.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-3xl">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
            {t("workArea.title")}
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {t("workArea.subtitle")}
          </p>

          {workAreas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("workArea.empty")}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {workAreas.map((area) => (
                <li key={area.id}>
                  <Link
                    to={`/work-area/${area.id}`}
                    className="flex min-h-24 items-center justify-between rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-muted"
                  >
                    <span className="font-medium text-foreground">
                      {area.name}
                    </span>
                    <span className="text-sm text-primary">
                      {t("workArea.enter")} →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkArea;
