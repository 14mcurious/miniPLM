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
 * Rotating chevron indicating whether a section / branch is expanded
 * (same indicator as the administration sidebar).
 */
const Chevron = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    aria-hidden="true"
    className={cn(
      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
      open && "rotate-90"
    )}
  >
    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Work area side panel, with the same design as the administration
 * sidebar: a full-height navigation column (bordered, muted background)
 * with a header block for the current project (name link plus the project
 * switcher / new work space actions) and an expandable "Work Spaces"
 * section holding the work space tree. Every work space can be opened in
 * its own view and offers create-child / edit / delete actions according
 * to the access modes of the user's groups.
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
  const [sectionOpen, setSectionOpen] = useState(true);
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

  // Active when the project-wide (global) search page is shown: no work
  // space is selected and the search route of the current project is open.
  const isGlobalSearchActive =
    activeWorkspaceId === null &&
    location.pathname === `/work-area/${projectId}/search`;

  const renderNode = (node: Node) => {
    const { workspace, children } = node;
    const expandable = children.length > 0;
    const expandedNode = expandable && isExpanded(workspace.id);
    const isActive = activeWorkspaceId === workspace.id;
    return (
      <li key={workspace.id}>
        <div
          className={cn(
            "flex items-center gap-1 rounded-md transition-colors",
            isActive ? "bg-accent" : "hover:bg-accent"
          )}
        >
          {expandable ? (
            <button
              type="button"
              onClick={() => toggleExpanded(workspace.id)}
              aria-label={expandedNode ? t("wa.collapse") : t("wa.expand")}
              aria-expanded={expandedNode}
              className="flex h-7 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <Chevron open={expandedNode} />
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}
          <Link
            to={`/work-area/${projectId}/workspaces/${workspace.id}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:text-accent-foreground",
              isActive && "font-medium text-accent-foreground"
            )}
            title={
              workspace.title
                ? `${workspace.name} — ${workspace.title}`
                : workspace.name
            }
          >
            {workspace.name}
          </Link>
        </div>

        {(can("C") || can("U") || can("D")) && (
          <div className="ml-5 flex flex-wrap gap-1 pb-1">
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

        {expandedNode && (
          <ul className="mt-1 space-y-0.5 border-l pl-2 ml-4">
            {children.map((child) => renderNode(child))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav
      aria-label={t("workArea.title")}
      className="sticky top-0 flex h-screen w-72 shrink-0 flex-col overflow-y-auto border-r bg-muted/30"
    >
      <div className="border-b px-4 py-4">
        {project ? (
          <>
            <Link
              to={`/work-area/${projectId}/search`}
              className="block text-lg font-semibold tracking-tight text-foreground hover:underline"
              title={t("wa.projectPicker.choose")}
            >
              {project.name}
            </Link>
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
      </div>

      <ul className="flex-1 space-y-1 p-2">
        {project && (
          <li>
            <Link
              to={`/work-area/${projectId}/search`}
              aria-current={isGlobalSearchActive ? "page" : undefined}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isGlobalSearchActive &&
                  "bg-accent font-medium text-accent-foreground"
              )}
            >
              {t("wa.globalSearch")}
            </Link>
          </li>
        )}
        <li>
          <button
            type="button"
            onClick={() => setSectionOpen((prev) => !prev)}
            aria-expanded={sectionOpen}
            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span>{t("wa.workspaces")}</span>
            <Chevron open={sectionOpen} />
          </button>

          {sectionOpen && (
            <ul className="mt-1 space-y-0.5 border-l pl-2 ml-4">
              {error && (
                <li>
                  <div
                    role="alert"
                    className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    {error}
                  </div>
                </li>
              )}
              {loading ? (
                <li>
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {t("wa.loading")}
                  </p>
                </li>
              ) : !error && workspaces.length === 0 ? (
                <li>
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {t("wa.empty")}
                  </p>
                </li>
              ) : (
                tree.map((node) => renderNode(node))
              )}
            </ul>
          )}
        </li>
      </ul>

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
    </nav>
  );
};

export default WorkAreaSidebar;
