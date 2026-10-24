import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { HistoryEntry, UserRef, WorkContainer } from "@/lib/types";

const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

/**
 * Dedicated history page of a work container. The modification history is
 * fetched only here (lazy load on mount), so the container detail page stays
 * fast even when the container carries a long history. A back link returns
 * to the container page.
 */
const WorkAreaContainerHistory = () => {
  const { t } = useI18n();
  const { projectId, containerId } = useParams<{
    projectId: string;
    containerId: string;
  }>();
  const { status } = useAuth();

  const [container, setContainer] = useState<WorkContainer | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
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
      const [listData, historyData] = await Promise.all([
        api<{ workContainers: WorkContainer[] }>(CONTAINERS_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
          }),
        }),
        api<{ history: HistoryEntry[] }>(CONTAINERS_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "history",
            id: Number(containerId),
          }),
        }),
      ]);
      const found =
        listData.workContainers?.find(
          (item) => String(item.id) === String(containerId)
        ) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setContainer(found);
      setHistory(historyData.history ?? []);
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

  const backTo = `/work-area/${projectId}/work-containers/${containerId}`;

  return (
    <>
      <BackLink
        to={backTo}
        label={
          container?.title ||
          container?.identifier ||
          containerId ||
          t("wa.workContainers")
        }
      />
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
                  {t("wa.history")}
                </h1>
                <span className="font-mono text-sm text-muted-foreground">
                  {container.title || container.identifier} ·{" "}
                  {container.identifier}
                </span>
              </div>

              <h2 className="mb-3 text-xl font-semibold text-foreground">
                {t("wa.history")} ({history.length})
              </h2>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("wa.historyEmpty")}
                </p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">{t("wa.historyAction")}</th>
                      <th className="px-2 py-2">{t("wa.historyUser")}</th>
                      <th className="px-2 py-2">{t("wa.historyFields")}</th>
                      <th className="px-2 py-2">{t("wa.historyWhen")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* The API returns entries oldest-first (by id); the
                        dedicated history page shows the latest first. */}
                    {history.slice().reverse().map((entry, index) => (
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
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaContainerHistory;
