import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

const PROJECTS_ENDPOINT = "/api/my/v1/projects";
const NAME_RE = /^[A-Za-z][A-Za-z0-9 ]*$/;

interface ProjectInfo {
  id: number;
  name: string;
  identifier: string;
  parentId: number | null;
  parentName: string | null;
  level: number;
  isRoot: boolean;
}

const NewProject = () => {
  const { t } = useI18n();

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [maxSubprojectLevels, setMaxSubprojectLevels] = useState(10);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");

  const [savedProject, setSavedProject] = useState<ProjectInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  // Load existing projects (parent choices + identifier uniqueness) and the
  // administrator-configurable depth limit.
  useEffect(() => {
    api<{ maxSubprojectLevels: number; projects: ProjectInfo[] }>(
      PROJECTS_ENDPOINT
    )
      .then((data) => {
        setProjects(data.projects ?? []);
        setMaxSubprojectLevels(data.maxSubprojectLevels ?? 10);
      })
      .catch(() => {
        // keep defaults when the endpoint is unreachable; the save request
        // will surface the server-side error anyway
      });
  }, []);

  // System identifier: the name without any space characters.
  const identifier = useMemo(
    () => name.trim().replace(/ /g, ""),
    [name]
  );

  const selectedParent =
    parentId === ""
      ? null
      : (projects.find((p) => String(p.id) === parentId) ?? null);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    const trimmed = name.trim();
    if (!trimmed) {
      errors.name = "projects.error.nameRequired";
    } else if (!NAME_RE.test(trimmed)) {
      errors.name = "projects.error.nameFormat";
    } else {
      const candidate = trimmed.replace(/ /g, "").toLowerCase();
      if (projects.some((p) => p.identifier.toLowerCase() === candidate)) {
        errors.name = "projects.error.nameTaken";
      }
    }
    if (selectedParent && selectedParent.level + 1 > maxSubprojectLevels) {
      errors.parentId = "projects.error.levelLimit";
    }
    return errors;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || savedProject) return;
    const errors = validate();
    setFieldErrors(errors);
    setBannerError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const data = await api<{ project: ProjectInfo }>(PROJECTS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "create",
          name: name.trim(),
          parentId: selectedParent ? selectedParent.id : null,
        }),
      });
      setSavedProject(data.project);
      setProjects((prev) => [...prev, data.project]);
      toast.success(t("newProject.saved"));
    } catch (error) {
      if (error instanceof ApiError && error.serverKey) {
        setBannerError({
          key: error.serverKey,
          params: error.serverParams ?? undefined,
        });
      } else {
        setBannerError({ key: "error.requestFailed", params: { status: "?" } });
      }
      toast.error(
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setSaving(false);
    }
  };

  const locked = savedProject !== null;

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-full";
  const fieldErrorClass = "mt-1 text-sm text-destructive";

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl">
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground">
            {t("newProject.title")}
          </h1>

          {bannerError && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t(bannerError.key, bannerError.params)}
            </div>
          )}

          <form onSubmit={handleSave} noValidate className="space-y-4">
            <div>
              <label htmlFor="project-name" className={labelClass}>
                {t("newProject.name")} *
              </label>
              <Input
                id="project-name"
                name="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.name;
                    return next;
                  });
                }}
                disabled={locked || saving}
                className={fieldClass}
              />
              {fieldErrors.name && (
                <p className={fieldErrorClass}>{t(fieldErrors.name)}</p>
              )}
            </div>

            <div>
              <label htmlFor="project-identifier" className={labelClass}>
                {t("newProject.identifier")}
              </label>
              <Input
                id="project-identifier"
                name="identifier"
                value={identifier}
                readOnly
                disabled
                aria-readonly="true"
                className={`${fieldClass} bg-muted/30 text-muted-foreground`}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("newProject.identifierAuto")}
              </p>
            </div>

            <div>
              <label htmlFor="project-parent" className={labelClass}>
                {t("newProject.parent")}{" "}
                <span className="font-normal text-muted-foreground">
                  {t("newProject.optional")}
                </span>
              </label>
              <select
                id="project-parent"
                name="parentId"
                value={parentId}
                onChange={(e) => {
                  setParentId(e.target.value);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.parentId;
                    return next;
                  });
                }}
                disabled={locked || saving}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              >
                <option value="">{t("newProject.parentNone")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={String(project.id)}>
                    {project.name} ({project.identifier}) —{" "}
                    {t("newProject.levelTag", { level: project.level })}
                  </option>
                ))}
              </select>
              {fieldErrors.parentId && (
                <p className={fieldErrorClass}>
                  {t(fieldErrors.parentId, { max: maxSubprojectLevels })}
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {t("newProject.depthNote", { max: maxSubprojectLevels })}
            </p>

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="submit"
                disabled={locked || saving}
                aria-busy={saving}
              >
                {t("newProject.save")}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/administration/projects/projects-list">
                  {t("newProject.backToProjects")}
                </Link>
              </Button>
            </div>
          </form>

          {savedProject && (
            <div className="mt-6 rounded-md border p-4 text-sm">
              <p className="mb-2 font-medium text-foreground">
                {t("newProject.statusPrefix")}: {t("newProject.statusSaved")}
              </p>
              <dl className="space-y-1 text-muted-foreground">
                <div>
                  <dt className="inline font-medium text-foreground">
                    {t("newProject.name")}:
                  </dt>{" "}
                  <dd className="inline">{savedProject.name}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-foreground">
                    {t("newProject.identifier")}:
                  </dt>{" "}
                  <dd className="inline">{savedProject.identifier}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-foreground">
                    {t("newProject.parent")}:
                  </dt>{" "}
                  <dd className="inline">
                    {savedProject.isRoot
                      ? t("newProject.parentNone")
                      : (savedProject.parentName ?? "—")}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium text-foreground">
                    {t("projectsList.level")}:
                  </dt>{" "}
                  <dd className="inline">
                    {savedProject.isRoot
                      ? t("projectsList.levelRoot")
                      : savedProject.level}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default NewProject;
