import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";

const PROJECTS_ENDPOINT = "/api/my/v1/projects";

interface ProjectInfo {
  id: number;
  name: string;
  identifier: string;
  parentId: number | null;
  parentName: string | null;
  level: number;
  isRoot: boolean;
}

/** Depth-first ordering: parents before their children, id order within. */
function orderProjects(projects: ProjectInfo[]): ProjectInfo[] {
  const byParent = new Map<number | null, ProjectInfo[]>();
  for (const project of projects) {
    const list = byParent.get(project.parentId) ?? [];
    list.push(project);
    byParent.set(project.parentId, list);
  }
  const ordered: ProjectInfo[] = [];
  const walk = (parentId: number | null) => {
    for (const project of byParent.get(parentId) ?? []) {
      ordered.push(project);
      walk(project.id);
    }
  };
  walk(null);
  return ordered;
}

const ProjectsList = () => {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [maxSubprojectLevels, setMaxSubprojectLevels] = useState<number | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        maxSubprojectLevels: number;
        projects: ProjectInfo[];
      }>(PROJECTS_ENDPOINT);
      setProjects(orderProjects(data.projects ?? []));
      setMaxSubprojectLevels(data.maxSubprojectLevels);
      // Drop any selection that no longer exists after a reload.
      setSelected((prev) => {
        const ids = new Set((data.projects ?? []).map((p) => p.id));
        return prev.filter((id) => ids.has(id));
      });
    } catch (err) {
      const message =
        err instanceof ApiError && err.serverKey
          ? t(err.serverKey, err.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" });
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleSelected = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = async () => {
    if (deleting || selected.length === 0) return;
    if (
      !window.confirm(
        t("projectsList.deleteConfirm", { count: selected.length })
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api<{ deletedProjects: number }>(PROJECTS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "delete", ids: selected }),
      });
      toast.success(t("projectsList.deleteSuccess", { count: selected.length }));
      setSelected([]);
      await load();
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-3xl">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              {t("projectsList.title")}
            </h1>
            <Button asChild size="sm">
              <Link to="/administration/projects/new-project">
                {t("projects.newProject")}
              </Link>
            </Button>
          </div>

          {maxSubprojectLevels !== null && (
            <p className="mb-4 text-sm text-muted-foreground">
              {t("projectsList.depthLimit", { max: maxSubprojectLevels })}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("projectsList.loading")}
            </p>
          ) : error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("projectsList.empty")}
            </p>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={selected.length === 0 || deleting}
                  aria-busy={deleting}
                  onClick={handleDeleteSelected}
                >
                  {t("projectsList.deleteSelected", { count: selected.length })}
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className="w-10 px-3 py-2">
                        <span className="sr-only">
                          {t("projectsList.selectProject", { name: "" })}
                        </span>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("projectsList.name")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("projectsList.identifier")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("projectsList.parent")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("projectsList.level")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((project) => (
                      <tr key={project.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <label
                            htmlFor={`project-select-${project.id}`}
                            className="flex items-center text-sm"
                          >
                            <input
                              type="checkbox"
                              name="project-select"
                              id={`project-select-${project.id}`}
                              checked={selected.includes(project.id)}
                              onChange={() => toggleSelected(project.id)}
                              disabled={deleting}
                              className="h-4 w-4 rounded border-input accent-primary"
                            />
                            <span className="sr-only">
                              {t("projectsList.selectProject", {
                                name: project.name,
                              })}
                            </span>
                          </label>
                        </td>
                        <td className="px-3 py-2 text-foreground">
                          <Link
                            to={`/administration/projects/project-edit/${project.id}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {project.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {project.identifier}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {project.isRoot
                            ? t("projectsList.root")
                            : (project.parentName ?? "—")}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {project.isRoot
                            ? t("projectsList.levelRoot")
                            : project.level}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectsList;
