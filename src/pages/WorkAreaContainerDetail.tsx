import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { HistoryEntry, UserRef, WorkContainer, WorkInstance } from "@/lib/types";

const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

/**
 * Work container detail: all attributes, the modification history (who,
 * what, when) and the work instances linked to the container.
 */
const WorkAreaContainerDetail = () => {
  const { t } = useI18n();
  const { projectId, containerId } = useParams<{
    projectId: string;
    containerId: string;
  }>();
  const { status } = useAuth();

  const [container, setContainer] = useState<WorkContainer | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [instances, setInstances] = useState<WorkInstance[]>([]);
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
      const [historyData, instancesData] = await Promise.all([
        api<{ history: HistoryEntry[] }>(CONTAINERS_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "history",
            id: Number(containerId),
          }),
        }),
        api<{ workInstances: WorkInstance[] }>(INSTANCES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
            workContainerId: Number(containerId),
          }),
        }),
      ]);
      setHistory(historyData.history ?? []);
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

  if (status === "unauthenticated") return null;

  const backTo = `/work-area/${projectId}/work-containers`;

  return (
    <>
      <BackLink to={backTo} label={t("wa.workContainers")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-4xl">
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
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  {container.name}
                </h1>
                <span className="font-mono text-sm text-muted-foreground">
                  {container.identifier}
                </span>
              </div>
              {container.title && (
                <p className="mb-6 text-lg text-muted-foreground">
                  {container.title}
                </p>
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
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.progress")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {container.progress ?? "—"}
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
              </div>

              <h2 className="mb-3 text-xl font-semibold text-foreground">
                {t("wa.history")}
              </h2>
              {history.length === 0 ? (
                <p className="mb-8 text-sm text-muted-foreground">
                  {t("wa.historyEmpty")}
                </p>
              ) : (
                <table className="mb-8 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">{t("wa.historyAction")}</th>
                      <th className="px-2 py-2">{t("wa.historyUser")}</th>
                      <th className="px-2 py-2">{t("wa.historyFields")}</th>
                      <th className="px-2 py-2">{t("wa.historyWhen")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry, index) => (
                      <tr key={index} className="border-b">
                        <td className="px-2 py-2 font-medium text-foreground">
                          {entry.action === "created"
                            ? t("wa.historyCreated")
                            : t("wa.historyUpdated")}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {formatUser(entry.user)}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {entry.changedFields.join(", ") || "—"}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {formatDate(entry.at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

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
                      <th className="px-2 py-2">{t("wa.name")}</th>
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
                            {instance.name}
                          </Link>
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
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaContainerDetail;
