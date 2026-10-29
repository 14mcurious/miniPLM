import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useProjectModes } from "@/hooks/usePermissions";
import { api, ApiError } from "@/lib/api";
import ContainerForm from "@/components/ContainerForm";
import WorkAreaSearchView from "@/components/WorkAreaSearchView";
import { Button } from "@/components/ui/button";
import { Workspace } from "@/lib/types";

const WORKSPACES_ENDPOINT = "/api/my/v1/workspaces";

/**
 * Work space view (D2): the old table page is gone. Elements of the work
 * space are found through the search (scoped to the work space and its
 * sub work spaces); new work containers and work instances are created
 * from here. Editing a container happens on its detail page.
 */
const WorkAreaWorkspaceDetail = () => {
  const { t } = useI18n();
  const { projectId, workspaceId } = useParams<{
    projectId: string;
    workspaceId: string;
  }>();
  const { status } = useAuth();
  const { can } = useProjectModes(projectId);
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingContainer, setCreatingContainer] = useState(false);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    if (!projectId || !workspaceId) return;
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const data = await api<{ workspaces: Workspace[] }>(
        WORKSPACES_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
          }),
        }
      );
      const found =
        data.workspaces?.find(
          (ws) => String(ws.id) === String(workspaceId)
        ) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setWorkspace(found);
    } catch (err) {
      const key = err instanceof ApiError ? err.serverKey : null;
      if (
        key === "forbidden" ||
        key === "workspaces.error.notFound" ||
        key === "workspaces.error.projectNotFound"
      ) {
        setNotFound(true);
      } else {
        setError(translate(err));
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (status === "authenticated") {
      void load();
    }
  }, [status, load]);

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const base = `/work-area/${projectId}`;

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-bold tracking-tight text-foreground">
          {workspace?.name ?? t("wa.loading")}
          {workspace?.title && (
            <span className="ml-3 text-xl font-normal text-muted-foreground">
              — {workspace.title}
            </span>
          )}
        </h1>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("wa.workspaceSearchHint")}
        </p>

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
        ) : notFound || !workspace ? (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {t("wa.empty")}
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-2">
              {can("C") && (
                <Button size="sm" onClick={() => setCreatingContainer(true)}>
                  {t("wa.newContainer")}
                </Button>
              )}
              {can("C") && (
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                >
                  <Link
                    to={`${base}/workspaces/${workspaceId}/work-instances/new`}
                  >
                    {t("wa.newInstance")}
                  </Link>
                </Button>
              )}
            </div>

            {creatingContainer && (
              <div className="mb-6">
                <ContainerForm
                  projectId={Number(projectId)}
                  workspaceId={Number(workspaceId)}
                  onSaved={(id) => {
                    setCreatingContainer(false);
                    navigate(`${base}/work-containers/${id}`);
                  }}
                  onCancel={() => setCreatingContainer(false)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {!loading && !notFound && workspace && (
        <WorkAreaSearchView
          projectId={Number(projectId)}
          workspaceId={Number(workspaceId)}
          scopeName={workspace.name}
          title={t("wa.search")}
        />
      )}
    </div>
  );
};

export default WorkAreaWorkspaceDetail;
