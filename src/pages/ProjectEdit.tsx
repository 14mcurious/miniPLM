import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackLink from "@/components/BackLink";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

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

const ProjectEdit = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [maxSubprojectLevels, setMaxSubprojectLevels] = useState(10);
  const [loading, setLoading] = useState(true);
  const [parentId, setParentId] = useState<string>("");
  const [parentIdLoaded, setParentIdLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  const project = projects.find((p) => String(p.id) === projectId) ?? null;

  const load = async () => {
    const data = await api<{
      maxSubprojectLevels: number;
      projects: ProjectInfo[];
    }>(PROJECTS_ENDPOINT);
    setProjects(data.projects ?? []);
    setMaxSubprojectLevels(data.maxSubprojectLevels ?? 10);
    return data.projects ?? [];
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setParentId("");
    setParentIdLoaded(false);
    setFieldError(null);
    setBannerError(null);
    load()
      .then((loaded) => {
        if (!active) return;
        const found = loaded.find((p) => String(p.id) === projectId) ?? null;
        if (found) {
          setParentId(found.parentId !== null ? String(found.parentId) : "");
        }
        setParentIdLoaded(true);
      })
      .catch((err) => {
        if (!active) return;
        const message =
          err instanceof ApiError && err.serverKey
            ? t(err.serverKey, err.serverParams ?? undefined)
            : t("error.requestFailed", { status: "?" });
        setBannerError({ key: "error.requestFailed", params: { status: "?" } });
        toast.error(message);
        setParentIdLoaded(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  // Project itself + all descendants: never valid as its own parent.
  const excludedIds = useMemo(() => {
    const excluded = new Set<number>();
    if (!project) return excluded;
    const byParent = new Map<number | null, number[]>();
    for (const p of projects) {
      const list = byParent.get(p.parentId) ?? [];
      list.push(p.id);
      byParent.set(p.parentId, list);
    }
    excluded.add(project.id);
    const walk = (id: number) => {
      for (const childId of byParent.get(id) ?? []) {
        if (!excluded.has(childId)) {
          excluded.add(childId);
          walk(childId);
        }
      }
    };
    walk(project.id);
    return excluded;
  }, [projects, project]);

  // Deepest descendant offset of the project's subtree (0 = no children).
  const subtreeDepthOffset = useMemo(() => {
    if (!project) return 0;
    let max = 0;
    for (const p of projects) {
      if (excludedIds.has(p.id) && p.level > project.level) {
        max = Math.max(max, p.level - project.level);
      }
    }
    return max;
  }, [projects, project, excludedIds]);

  const selectedParent =
    parentId === ""
      ? null
      : (projects.find((p) => String(p.id) === parentId) ?? null);

  const validate = (): string | null => {
    if (selectedParent && selectedParent.level + 1 + subtreeDepthOffset > maxSubprojectLevels) {
      return "projects.error.levelLimit";
    }
    return null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !project) return;
    const error = validate();
    setFieldError(error);
    setBannerError(null);
    if (error) return;

    setSaving(true);
    try {
      await api(PROJECTS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "update-parent",
          id: project.id,
          parentId: selectedParent ? selectedParent.id : null,
        }),
      });
      await load();
      toast.success(t("projectEdit.saved"));
    } catch (err) {
      if (err instanceof ApiError && err.serverKey) {
        setBannerError({
          key: err.serverKey,
          params: err.serverParams ?? undefined,
        });
      } else {
        setBannerError({ key: "error.requestFailed", params: { status: "?" } });
      }
      toast.error(
        err instanceof ApiError && err.serverKey
          ? t(err.serverKey, err.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setSaving(false);
    }
  };

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-full";
  const fieldErrorClass = "mt-1 text-sm text-destructive";

  return (
    <>
      <BackLink
        to="/administration/projects/projects-list"
        label={t("projectsList.title")}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
            {t("projectEdit.title")}
          </h1>
          {!loading && project && (
            <p className="mb-6 text-sm text-muted-foreground">
              {t("projectEdit.nameRef")}: <span className="font-medium">{project.name}</span>{" "}
              <span className="text-muted-foreground">({project.identifier})</span>
            </p>
          )}

          {bannerError && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t(bannerError.key, bannerError.params)}
            </div>
          )}

          {loading || !parentIdLoaded ? (
            <p className="text-sm text-muted-foreground">
              {t("projectsList.loading")}
            </p>
          ) : !project ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("projects.error.projectNotFound")}
            </div>
          ) : (
            <form onSubmit={handleSave} noValidate className="space-y-4">
              <div>
                <label htmlFor="edit-project-name" className={labelClass}>
                  {t("newProject.name")}
                </label>
                <Input
                  id="edit-project-name"
                  name="name"
                  value={project.name}
                  readOnly
                  disabled
                  aria-readonly="true"
                  className={`${fieldClass} bg-muted/30 text-muted-foreground`}
                />
              </div>

              <div>
                <label htmlFor="edit-project-identifier" className={labelClass}>
                  {t("newProject.identifier")}
                </label>
                <Input
                  id="edit-project-identifier"
                  name="identifier"
                  value={project.identifier}
                  readOnly
                  disabled
                  aria-readonly="true"
                  className={`${fieldClass} bg-muted/30 text-muted-foreground`}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("projectEdit.readOnlyNote")}
                </p>
              </div>

              <div>
                <label htmlFor="edit-project-parent" className={labelClass}>
                  {t("newProject.parent")}
                </label>
                <select
                  id="edit-project-parent"
                  name="parentId"
                  value={parentId}
                  onChange={(e) => {
                    setParentId(e.target.value);
                    setFieldError(null);
                  }}
                  disabled={saving}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                >
                  <option value="">{t("newProject.parentNone")}</option>
                  {projects
                    .filter((p) => !excludedIds.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} ({p.identifier}) —{" "}
                        {t("newProject.levelTag", { level: p.level })}
                      </option>
                    ))}
                </select>
                {fieldError && (
                  <p className={fieldErrorClass}>
                    {t(fieldError, { max: maxSubprojectLevels })}
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {t("newProject.depthNote", { max: maxSubprojectLevels })}
              </p>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button
                  type="submit"
                  disabled={saving}
                  aria-busy={saving}
                >
                  {t("projectEdit.save")}
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link to="/administration/projects/projects-list">
                    {t("projectEdit.backToProjectsList")}
                  </Link>
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectEdit;
