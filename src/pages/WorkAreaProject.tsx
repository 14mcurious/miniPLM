import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";

const WORK_AREAS_ENDPOINT = "/api/my/v1/work-areas";

interface ProjectInfo {
  id: number;
  name: string;
  identifier: string;
  parentId: number | null;
  parentName: string | null;
  level: number;
  isRoot: boolean;
}

/**
 * Work area of a specific project (1-to-1 association).
 *
 * All operations inside this area stay within the scope of the selected
 * project; the backend re-checks the access rights on every request.
 */
const WorkAreaProject = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status, workAreas } = useAuth();

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDenied(false);
    api<{ project: ProjectInfo }>(WORK_AREAS_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ operation: "get", projectId: Number(projectId) }),
    })
      .then((data) => {
        if (cancelled) return;
        setProject(data.project ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        const key = err instanceof ApiError ? err.serverKey : null;
        const translated =
          err instanceof ApiError && err.serverKey
            ? t(err.serverKey, err.serverParams ?? undefined)
            : t("error.requestFailed", { status: "?" });
        if (
          key === "forbidden" ||
          key === "workAreas.error.forbidden" ||
          key === "workAreas.error.projectNotFound"
        ) {
          setDenied(true);
        } else {
          setError(translated);
          toast.error(translated);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  const known = projectId
    ? workAreas.some((area) => String(area.id) === projectId)
    : false;

  return (
    <>
      <BackLink to="/work-area" label={t("workArea.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-3xl">
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("workArea.loading")}
            </p>
          ) : denied || error || !project ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error ?? t("workArea.noAccess")}
            </div>
          ) : (
            <>
              <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
                {project.name}
              </h1>
              <p className="mb-6 text-sm text-muted-foreground">
                {t("workArea.scopeNote", { name: project.name })}
              </p>

              <div className="rounded-lg border bg-card p-6 shadow-sm">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("workArea.project")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {project.name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("workArea.identifier")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {project.identifier}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("workArea.level")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {project.isRoot
                        ? t("workArea.levelRoot")
                        : t("workArea.levelValue", { level: String(project.level) })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("workArea.parent")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {project.parentName ?? t("workArea.parentNone")}
                    </dd>
                  </div>
                </dl>

                <div className="mt-6 border-t pt-4 text-sm text-muted-foreground">
                  {t("workArea.ready", { name: project.name })}
                  {known ? null : (
                    <span className="ml-1">{t("workArea.scopeNote", { name: project.name })}</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
export default WorkAreaProject;
