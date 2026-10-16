import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import BackLink from "@/components/BackLink";
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

  return (
    <>
      <BackLink to="/administration/projects" label={t("projects.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-3xl">
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground">
            {t("projectsList.title")}
          </h1>

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
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left">
                  <tr>
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
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectsList;
