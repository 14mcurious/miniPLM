import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useWorkAreaProject } from "@/hooks/useWorkAreaProject";
import { useProjectModes } from "@/hooks/usePermissions";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import WorkspaceFormDialog from "@/components/WorkspaceFormDialog";
import { Workspace } from "@/lib/types";
import { cn } from "@/lib/utils";

const WORKSPACES_ENDPOINT = "/api/my/v1/workspaces";

interface Node {
  workspace: Workspace;
  children: Node[];
}

/**
 * Work area side panel: the current project header (with the project
 * switcher) and the tree of the project work spaces. Every work space can
 * be opened in its own view and offers create-child / edit / delete
 * actions according to the access modes of the user's groups.
 */
const WorkAreaSidebar = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status, workAreas } = useAuth();
  const { openPicker } = useWorkAreaProject();
  const { can } = useProjectModes(projectId);
  const location = useLocation();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [formState, setFormState] = useState<
    | null
    | { mode: "create"; parentId: number | null; parentName: string | null }
    | { mode: "update"; workspace: Workspace }
  >(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    if (!projectId || Number.isNaN(Number(projectId))) return;
    setLoading(true);
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
      setWorkspaces(data.workspaces ?? []);
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

  const project = workAreas.find(
    (area) => String(area.id) === String(projectId)
  );

  const tree = useMemo<Node[]>(() => {
    const byParent: Record<string, Node[]> = {};
    for (const workspace of workspaces) {
      const key = String(workspace.parentId ?? "root");
      (byParent[key] = byParent[key] ?? []).push({
        workspace,
        children: [],
      });
    }
    for (const list of Object.values(byParent)) {
      list.sort((a, b) =>
        a.workspace.name.localeCompare(b.workspace.name)
      );
      for (const node of list) {
        node.children = byParent[String(node.workspace.id)] ?? [];
      }
    }
    return byParent["root"] ?? [];
  }, [workspaces]);

  // Expanded by default; collapsing stores an explicit false.
  const isExpanded = (id: number) => expanded[id] !== false;
  const toggleExpanded = (id: number) =>
    setExpanded((prev) => ({ ...prev, [id]: prev[id] === false }));

  const openCreate = (parentId: number | null, parentName: string | null) =>
    setFormState({ mode: "create", parentId, parentName });

  const openUpdate = (workspace: Workspace) =>
    setFormState({ mode: "update", workspace });

  const deleteWorkspace = async (workspace: Workspace) => {
    if (
      !window.confirm(t("wa.deleteConfirm", { name: workspace.name }))
    ) {
      return;
    }
    try {
      await api(WORKSPACES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "delete", id: workspace.id }),
      });
      toast.success(t("wa.workspaceDeleted"));
      await load();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  const activeWorkspaceId = useMemo(() => {
    const match = location.pathname.match(
      new RegExp(
        `/work-area/${projectId}/workspaces/(\\d+)(?:/|$)`
      )
    );
    return match ? Number(match[1]) : null;
  }, [location.pathname, projectId]);

  const renderNode = (node: Node, depth: number) => {
    const { workspace, children } = node;
    const expandable = children.length > 0;
    const expandedNode = expandable && isExpanded(workspace.id);
    const isActive = activeWorkspaceId === workspace.id;
    return (
      <li key={workspace.id}>
        <div
          className={cn(
            "rounded-md border px-2 py-1.5",
            isActive
              ? "border-primary bg-accent"
              : "border-transparent hover:bg-muted"
          )}
          style={{ marginLeft: depth * 12 }}
        >
          <div className="flex items-center gap-1">
            {expandable ? (
              <button
                type="button"
                onClick={() => toggleExpanded(workspace.id)}
                aria-label={expandedNode ? t("wa.collapse") : t("wa.expand")}
                className="w-5 shrink-0 text-center text-muted-foreground hover:text-foreground"
              >
                {expandedNode ? "▾" : "▸"}
              </button>
            ) : (
              <span className="w-5 shrink-0" aria-hidden="true" />
            )}
            <Link
              to={`/work-area/${projectId}/workspaces/${workspace.id}`}
              className={cn(
                "min-w-0 flex-1 truncate text-sm hover:underline",
                isActive
                  ? "font-semibold text-accent-foreground"
                  : "font-medium text-foreground"
              )}
              title={workspace.title ? `${workspace.name} — ${workspace.title}` : workspace.name}
            >
              {workspace.name}
            </Link>
          </div>
          {(can("C") || can("U") || can("D")) && (
            <div className="mt-1 ml-5 flex flex-wrap gap-1">
              {can("C") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => openCreate(workspace.id, workspace.name)}
                >
                  {t("wa.newChild")}
                </Button>
              )}
              {can("U") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => openUpdate(workspace)}
                >
                  {t("wa.edit")}
                </Button>
              )}
              {can("D") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => void deleteWorkspace(workspace)}
                >
                  {t("wa.delete")}
                </Button>
              )}
            </div>
          )}
        </div>
        {expandedNode && (
          <ul className="mt-1 space-y-0.5">
            {children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      aria-label={t("wa.workspaces")}
      className="w-full shrink-0 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto"
    >
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        {project ? (
          <>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("wa.sidebar.currentProject", { name: project.name })}
            </p>
            <div className="mt-1">
              <h2 className="text-lg font-semibold text-foreground">
                {project.name}
              </h2>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={openPicker}
                aria-label={t("wa.projectPicker.choose")}
              >
                {t("wa.projectPicker.choose")}
              </Button>
              {can("C") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openCreate(null, null)}
                >
                  {t("wa.newWorkspace")}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" role="alert">
            {t("workArea.noAccess")}
          </p>
        )}

        <hr className="my-4 border-border" />

        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("wa.workspaces")}
          </h3>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
        ) : !error && workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("wa.empty")}</p>
        ) : (
          <ul className="space-y-0.5" role="tree" aria-label={t("wa.workspaces")}>
            {tree.map((node) => renderNode(node, 0))}
          </ul>
        )}
      </div>

      <WorkspaceFormDialog
        open={formState !== null}
        onClose={() => setFormState(null)}
        projectId={Number(projectId)}
        mode={formState?.mode ?? "create"}
        parentId={
          formState?.mode === "create" ? formState.parentId : null
        }
        parentName={
          formState?.mode === "create" ? formState.parentName : null
        }
        workspace={
          formState?.mode === "update" ? formState.workspace : null
        }
        onSaved={() => {
          toast.success(t("wa.workspaceSaved"));
          setFormState(null);
          void load();
        }}
      />
    </aside>
  );
};

export default WorkAreaSidebar;
