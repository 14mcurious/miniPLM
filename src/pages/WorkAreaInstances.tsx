import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import {
  INSTANCES_ENDPOINT,
  formatDate,
} from "@/lib/work-instance-form";
import type {
  ProgressOption,
  UserRef,
  WorkInstance,
} from "@/lib/types";

/**
 * Work Instances page: a clean list of work instances with a
 * "New Work Instance" button that navigates to the dedicated create page.
 *
 * Editing, deleting and template management live on separate pages:
 *  - New work instance → /work-area/:projectId/work-instances/new
 *  - Edit/manage      → /work-area/:projectId/work-instances-configuration
 *  - Templates        → /work-area/:projectId/templates
 */
const WorkAreaInstances = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();
  const navigate = useNavigate();

  const [instances, setInstances] = useState<WorkInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        workInstances: WorkInstance[];
        users: UserRef[];
        progressOptions: ProgressOption[] | null;
      }>(INSTANCES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "list",
          projectId: Number(projectId),
        }),
      });
      setInstances(data.workInstances ?? []);
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (status === "authenticated") {
      void load();
    }
  }, [status, load]);

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const base = `/work-area/${projectId}`;

  return (
    <>
      <BackLink
        to={base}
        label={`${t("workArea.title")} — ${t("wa.workInstances")}`}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t("wa.workInstances")}
            </h1>
            <Button
              onClick={() => navigate(`${base}/work-instances/new`)}
            >
              {t("wa.newInstance")}
            </Button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : instances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("wa.emptyInstances")}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2">{t("wa.instanceId")}</th>
                  <th className="px-2 py-2">{t("wa.name")}</th>
                  <th className="px-2 py-2">{t("wa.container")}</th>
                  <th className="px-2 py-2">{t("wa.template")}</th>
                  <th className="px-2 py-2">{t("wa.progress")}</th>
                  <th className="px-2 py-2">{t("wa.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((instance) => (
                  <tr key={instance.id} className="border-b hover:bg-muted/40">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {instance.instanceId}
                    </td>
                    <td className="px-2 py-2 font-medium text-foreground">
                      <Link
                        to={`${base}/work-instances/${instance.id}`}
                        className="hover:underline"
                      >
                        {instance.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {instance.workContainerName}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {instance.templateName ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {instance.progress ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {formatDate(instance.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaInstances;
