import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WORK_AREAS_ENDPOINT = "/api/my/v1/work-areas";

interface ProjectNode {
  id: number;
  name: string;
  identifier: string;
  parentId: number | null;
  level: number;
  parentName: string | null;
  isRoot: boolean;
}

interface TreeNode {
  project: ProjectNode;
  children: TreeNode[];
}

/**
 * Builds the project tree from the flat accessible list. Accessible
 * sub-projects whose parent is not accessible are surfaced at the top
 * level so they remain selectable.
 */
function buildTree(projects: ProjectNode[]): TreeNode[] {
  const known = new Set(projects.map((project) => project.id));
  const byParent = new Map<number | null, TreeNode[]>();
  for (const project of projects) {
    const parent =
      project.parentId != null && known.has(project.parentId)
        ? project.parentId
        : null;
    const list = byParent.get(parent) ?? [];
    list.push({ project, children: [] });
    byParent.set(parent, list);
  }
  const roots = byParent.get(null) ?? [];
  const attach = (list: TreeNode[]) => {
    list.sort((a, b) => a.project.name.localeCompare(b.project.name));
    for (const node of list) {
      node.children = byParent.get(node.project.id) ?? [];
      attach(node.children);
    }
  };
  attach(roots);
  return roots;
}

interface ProjectSelectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the confirmed project id. */
  onConfirm: (projectId: number) => void;
}

/**
 * Modal dialog to choose the current work area project: the list of
 * accessible root projects is shown first and each root can be expanded
 * to browse its sub-projects. "Select" asks for a confirmation before
 * the choice becomes the current project.
 */
const ProjectSelectDialog = ({
  open,
  onClose,
  onConfirm,
}: ProjectSelectDialogProps) => {
  const { t } = useI18n();

  const [projects, setProjects] = useState<ProjectNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setExpanded({});
    setConfirming(false);
    api<{ workAreas: ProjectNode[] }>(WORK_AREAS_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ operation: "list" }),
    })
      .then((data) => {
        if (!cancelled) setProjects(data.workAreas ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.serverKey
            ? t(err.serverKey, err.serverParams ?? undefined)
            : t("error.requestFailed", { status: "?" })
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes the dialog (confirmation stage included).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const tree = useMemo(() => buildTree(projects), [projects]);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId]
  );

  if (!open) return null;

  const toggle = (id: number) =>
    setExpanded((prev) => ({ ...prev, [id]: prev[id] !== true }));

  const renderNode = (node: TreeNode, depth: number) => {
    const { project, children } = node;
    const expandable = children.length > 0;
    const isExpanded = expandable && expanded[project.id] !== false;
    const selected = selectedId === project.id;
    return (
      <li key={project.id}>
        <div
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-1.5 transition-colors",
            selected
              ? "border-primary bg-accent"
              : "border-transparent hover:bg-muted"
          )}
        >
          {expandable ? (
            <button
              type="button"
              onClick={() => toggle(project.id)}
              aria-label={isExpanded ? t("wa.collapse") : t("wa.expand")}
              className="w-5 shrink-0 text-center text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => setSelectedId(project.id)}
            aria-pressed={selected}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left text-sm text-foreground",
              selected && "text-accent-foreground"
            )}
          >
            <span className="truncate font-medium">{project.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              ({project.identifier})
            </span>
            {selected && (
              <span className="ml-auto shrink-0 text-xs font-medium text-primary">
                ✓
              </span>
            )}
          </button>
        </div>
        {isExpanded && (
          <ul className="mt-1 ml-5 space-y-1 border-l pl-3">
            {children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("wa.projectPicker.title")}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t("wa.projectPicker.title")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t("wa.projectPicker.close")}
          >
            ✕
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {confirming && selectedProject ? (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-foreground">
                {t("wa.projectPicker.confirmTitle")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("wa.projectPicker.confirmMessage", {
                  name: selectedProject.name,
                })}
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                >
                  {t("wa.cancel")}
                </Button>
                <Button type="button" onClick={() => onConfirm(selectedProject.id)}>
                  {t("wa.projectPicker.confirm")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                {t("wa.projectPicker.subtitle")}
              </p>
              {error && (
                <div
                  role="alert"
                  className="mb-3 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              {loading ? (
                <p className="text-sm text-muted-foreground">
                  {t("wa.projectPicker.loading")}
                </p>
              ) : !error && projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("wa.projectPicker.empty")}
                </p>
              ) : (
                <ul className="space-y-1" aria-label={t("wa.projectPicker.title")}>
                  {tree.map((node) => renderNode(node, 0))}
                </ul>
              )}
            </>
          )}
        </div>

        {!confirming && (
          <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
            <p className="text-xs text-muted-foreground">
              {selectedProject
                ? t("wa.sidebar.currentProject", {
                    name: selectedProject.name,
                  })
                : t("wa.projectPicker.selectDisabled")}
            </p>
            <Button
              type="button"
              disabled={!selectedProject}
              onClick={() => setConfirming(true)}
            >
              {t("wa.projectPicker.select")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectSelectDialog;
