import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { History, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useProjectModes } from "@/hooks/usePermissions";
import { api, ApiError } from "@/lib/api";
import { progressLabel } from "@/lib/workflow-progress";
import FieldValue from "@/components/FieldValue";
import ContainerForm from "@/components/ContainerForm";
import { Button } from "@/components/ui/button";
import {
  UserRef,
  WorkContainer,
  WorkInstance,
} from "@/lib/types";

const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

/**
 * Work container detail: all attributes, the template fields and the work
 * instances linked to the container. Progress (present only when the
 * container template defines it) shows the state value with the workflow
 * label as a hover tooltip. The modification history lives on a dedicated
 * page (lazy loaded on demand) and is reached from the History button.
 */
const WorkAreaContainerDetail = () => {
  const { t } = useI18n();
  const { projectId, containerId } = useParams<{
    projectId: string;
    containerId: string;
  }>();
  const { status } = useAuth();
  const { can } = useProjectModes(projectId);
  const navigate = useNavigate();

  const [container, setContainer] = useState<WorkContainer | null>(null);
  const [instances, setInstances] = useState<WorkInstance[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    if (!projectId || !containerId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const listData = await api<{ workContainers: WorkContainer[] }>(
        CONTAINERS_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
          }),
        }
      );
      const found =
        listData.workContainers?.find(
          (item) => String(item.id) === String(containerId)
        ) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setContainer(found);
      const instancesData = await api<{ workInstances: WorkInstance[] }>(
        INSTANCES_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
            workContainerId: Number(containerId),
          }),
        }
      );
      setInstances(instancesData.workInstances ?? []);
    } catch (err) {
      const key = err instanceof ApiError ? err.serverKey : null;
      if (
        key === "forbidden" ||
        key === "workContainers.error.notFound" ||
        key === "workContainers.error.projectNotFound"
      ) {
        setNotFound(true);
      } else {
        toast.error(translate(err));
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, containerId]);

  useEffect(() => {
    if (status === "authenticated") {
      void load();
    }
  }, [status, load]);

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  return (
    <div className="min-w-0 max-w-4xl">
      {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : notFound || !container ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("wa.containerNotFound")}
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight text-foreground">
                    {container.title || container.identifier}
                  </h1>
                  <span className="font-mono text-sm text-muted-foreground">
                    {container.identifier}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {can("U") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing((value) => !value)}
                    >
                      <Pencil className="h-4 w-4" />
                      {t("wa.edit")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/work-area/${projectId}/work-containers/${containerId}/history`
                      )
                    }
                  >
                    <History className="h-4 w-4" />
                    {t("wa.history")}
                  </Button>
                </div>
              </div>

              {editing && (
                <div className="mb-8">
                  <ContainerForm
                    projectId={Number(projectId)}
                    container={container}
                    onSaved={() => {
                      setEditing(false);
                      void load();
                    }}
                    onCancel={() => setEditing(false)}
                  />
                </div>
              )}

              <div className="mb-8 rounded-lg border bg-card p-5 shadow-sm">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.workspace")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {container.workspaceName ?? t("wa.workspaceProject")}
                    </dd>
                  </div>
                  {container.progressWorkflow && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t("wa.progress")}
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">
                        <span
                          title={progressLabel(
                            container.progressWorkflow,
                            container.progress
                          )}
                        >
                          {container.progress ?? "—"}
                        </span>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.template")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {container.templateName ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.author")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {formatUser(container.author)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.created")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {formatDate(container.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.updated")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {formatDate(container.updatedAt)}
                    </dd>
                  </div>
                </dl>
                {container.description && (
                  <div className="mt-4 border-t pt-4">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.description")}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                      {container.description}
                    </dd>
                  </div>
                )}
                {(container.fields ?? []).length > 0 && (
                  <div className="mt-4 border-t pt-4">
                    <dt className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.fields")}
                    </dt>
                    <dl className="grid gap-4 sm:grid-cols-2">
                      {(container.fields ?? []).map((field) => (
                        <div key={field.name}>
                          <dt className="text-xs text-muted-foreground">
                            {field.name}
                          </dt>
                          <dd className="mt-1 text-sm text-foreground">
                            <FieldValue field={field} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>

              <h2 className="mb-3 text-xl font-semibold text-foreground">
                {t("wa.linkedInstances")} ({instances.length})
              </h2>
              {instances.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("wa.noLinkedInstances")}
                </p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">{t("wa.instanceId")}</th>
                      <th className="px-2 py-2">{t("wa.title")}</th>
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
                            to={`/work-area/${projectId}/work-instances/${instance.id}`}
                            className="hover:underline"
                          >
                            {instance.title}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          <span
                            title={progressLabel(
                              instance.progressWorkflow,
                              instance.progress
                            )}
                          >
                            {instance.progress ?? "—"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {formatDate(instance.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
    </div>
  );
};

export default WorkAreaContainerDetail;
