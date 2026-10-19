import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useProjectModes, type AccessMode } from "@/hooks/usePermissions";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Workspace } from "@/lib/types";

const WORKSPACES_ENDPOINT = "/api/my/v1/workspaces";

interface Node {
  workspace: Workspace;
  children: Node[];
}

/**
 * Work spaces of a work area (project): a tree where every work space can
 * contain other work spaces and work containers. Supports create (root or
 * child), rename and delete (with confirmation of the cascade).
 */
const WorkAreaWorkspaces = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();
  const { can } = useProjectModes(projectId);
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [formMode, setFormMode] = useState<
    null | { mode: "create"; parentId: number | null } | { mode: "update"; id: number }
  >(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  const isExpanded = (id: number) =>
    expanded[id] !== false; // expanded by default

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => ({ ...prev, [id]: prev[id] === false }));

  const openCreate = (parentId: number | null) => {
    setFormMode({ mode: "create", parentId });
    setName("");
    setTitle("");
    setFormError(null);
  };

  const openUpdate = (workspace: Workspace) => {
    setFormMode({ mode: "update", id: workspace.id });
    setName(workspace.name);
    setTitle(workspace.title ?? "");
    setFormError(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setName("");
    setTitle("");
    setFormError(null);
  };

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  return (
    <>
      <BackLink
        to={`/work-area/${projectId}`}
        label={`${t("workArea.title")} — ${t("wa.workspaces")}`}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-4xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t("wa.workspaces")}
            </h1>
            {can("C") && (
              <Button onClick={() => openCreate(null)} disabled={busy}>
                {t("wa.newWorkspace")}
              </Button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {formMode && (
            <form
              className="mb-6 space-y-4 rounded-lg border bg-card p-5 shadow-sm"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                if (!name.trim()) {
                  setFormError(t("wa.error.nameRequired"));
                  return;
                }
                setBusy(true);
                setFormError(null);
                try {
                  if (formMode.mode === "create") {
                    await api(WORKSPACES_ENDPOINT, {
                      method: "POST",
                      body: JSON.stringify({
                        operation: "create",
                        projectId: Number(projectId),
                        name: name.trim(),
                        title: title.trim(),
                        parentId: formMode.parentId,
                      }),
                    });
                    toast.success(t("wa.workspaceSaved"));
                  } else {
                    await api(WORKSPACES_ENDPOINT, {
                      method: "POST",
                      body: JSON.stringify({
                        operation: "update",
                        id: formMode.id,
                        name: name.trim(),
                        title: title.trim(),
                      }),
                    });
                    toast.success(t("wa.workspaceSaved"));
                  }
                  closeForm();
                  await load();
                } catch (err) {
                  setFormError(translate(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2 className="text-lg font-semibold text-foreground">
                {formMode.mode === "create"
                  ? t("wa.newWorkspaceTitle")
                  : t("wa.editWorkspaceTitle")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="workspace-name"
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    {t("wa.name")}
                  </label>
                  <Input
                    id="workspace-name"
                    name="workspaceName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label
                    htmlFor="workspace-title"
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    {t("wa.title")}
                  </label>
                  <Input
                    id="workspace-title"
                    name="workspaceTitle"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <div className="flex gap-3">
                <Button type="submit" disabled={busy} aria-busy={busy}>
                  {t("wa.save")}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  {t("wa.cancel")}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("wa.loading")}
            </p>
          ) : workspaces.length === 0 && !formMode ? (
            <p className="text-sm text-muted-foreground">
              {t("wa.empty")}
            </p>
          ) : (
            <ul className="space-y-1" role="tree" aria-label={t("wa.workspaces")}>
              {tree.map((node) => (
                <TreeNode
                  key={node.workspace.id}
                  node={node}
                  depth={0}
                  isExpanded={isExpanded}
                  onToggle={toggleExpanded}
                  onOpen={(workspace) =>
                    navigate(
                      `/work-area/${projectId}/workspaces/${workspace.id}`
                    )
                  }
                  onCreateChild={openCreate}
                  onEdit={openUpdate}
                  can={can}
                  onDelete={async (workspace) => {
                    if (
                      !window.confirm(
                        t("wa.deleteConfirm", { name: workspace.name })
                      )
                    ) {
                      return;
                    }
                    try {
                      await api(WORKSPACES_ENDPOINT, {
                        method: "POST",
                        body: JSON.stringify({
                          operation: "delete",
                          id: workspace.id,
                        }),
                      });
                      toast.success(t("wa.workspaceDeleted"));
                      await load();
                    } catch (err) {
                      toast.error(translate(err));
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};

interface TreeNodeProps {
  node: Node;
  depth: number;
  isExpanded: (id: number) => boolean;
  onToggle: (id: number) => void;
  onOpen: (workspace: Workspace) => void;
  onCreateChild: (parentId: number | null) => void;
  onEdit: (workspace: Workspace) => void;
  can: (mode: AccessMode) => boolean;
  onDelete: (workspace: Workspace) => void;
}

const TreeNode = ({
  node,
  depth,
  isExpanded,
  onToggle,
  onOpen,
  onCreateChild,
  onEdit,
  can,
  onDelete,
}: TreeNodeProps) => {
  const { t } = useI18n();
  const { workspace, children } = node;
  const expanded = isExpanded(workspace.id);
  return (
    <li role="treeitem" aria-expanded={children.length > 0 ? expanded : undefined}>
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2"
        style={{ marginLeft: depth * 1.25 }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(workspace.id)}
            className="w-5 text-center text-muted-foreground hover:text-foreground"
            aria-label={expanded ? t("wa.collapse") : t("wa.expand")}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-5" aria-hidden="true" />
        )}
        <span className="font-medium text-foreground">{workspace.name}</span>
        {workspace.title && (
          <span className="text-sm text-muted-foreground">— {workspace.title}</span>
        )}
        <span className="ml-auto flex flex-wrap gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={() => onOpen(workspace)}>
            {t("wa.openWorkspace")}
          </Button>
          {can("C") && (
            <Button size="sm" variant="outline" onClick={() => onCreateChild(workspace.id)}>
              {t("wa.newChild")}
            </Button>
          )}
          {can("U") && (
            <Button size="sm" variant="outline" onClick={() => onEdit(workspace)}>
              {t("wa.edit")}
            </Button>
          )}
          {can("D") && (
            <Button size="sm" variant="outline" onClick={() => onDelete(workspace)}>
              {t("wa.delete")}
            </Button>
          )}
        </span>
      </div>
      {expanded && children.length > 0 && (
        <ul role="group" className="mt-1 space-y-1">
          {children.map((child) => (
            <TreeNode
              key={child.workspace.id}
              node={child}
              depth={depth + 1}
              isExpanded={isExpanded}
              onToggle={onToggle}
              onOpen={onOpen}
              onCreateChild={onCreateChild}
              onEdit={onEdit}
              can={can}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

export default WorkAreaWorkspaces;
