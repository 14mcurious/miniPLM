import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressOption, UserRef, Workspace, WorkContainer } from "@/lib/types";

const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
const WORKSPACES_ENDPOINT = "/api/my/v1/workspaces";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

/**
 * Work containers of a work area (project). A container lives directly in
 * the project or inside a work space, carries name/title/description/
 * progress and a full modification history. Zero or more work instances
 * can be linked to it.
 */
const WorkAreaContainers = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();

  const [containers, setContainers] = useState<WorkContainer[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [progressOptions, setProgressOptions] = useState<ProgressOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formMode, setFormMode] = useState<
    null | { mode: "create" } | { mode: "update"; id: number }
  >(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [progress, setProgress] = useState("");
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
      const [containersData, workspacesData] = await Promise.all([
        api<{
          workContainers: WorkContainer[];
          progressOptions: ProgressOption[] | null;
        }>(CONTAINERS_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
          }),
        }),
        api<{ workspaces: Workspace[] }>(WORKSPACES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
          }),
        }),
      ]);
      setContainers(containersData.workContainers ?? []);
      setProgressOptions(containersData.progressOptions ?? []);
      setWorkspaces(workspacesData.workspaces ?? []);
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

  const openCreate = () => {
    setFormMode({ mode: "create" });
    setName("");
    setTitle("");
    setDescription("");
    setWorkspaceId("");
    setProgress("");
    setFormError(null);
  };

  const openUpdate = (container: WorkContainer) => {
    setFormMode({ mode: "update", id: container.id });
    setName(container.name);
    setTitle(container.title ?? "");
    setDescription(container.description ?? "");
    setWorkspaceId(
      container.workspaceId === null ? "" : String(container.workspaceId)
    );
    setProgress(container.progress ?? "");
    setFormError(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setFormError(null);
  };

  if (status === "unauthenticated") return null;

  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  return (
    <>
      <BackLink
        to={`/work-area/${projectId}`}
        label={`${t("workArea.title")} — ${t("wa.workContainers")}`}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t("wa.workContainers")}
            </h1>
            <Button onClick={openCreate} disabled={busy}>
              {t("wa.newContainer")}
            </Button>
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
                  const payload: Record<string, unknown> = {
                    name: name.trim(),
                    title: title.trim(),
                    description: description.trim(),
                    progress: progress,
                  };
                  if (formMode.mode === "create") {
                    payload.operation = "create";
                    payload.projectId = Number(projectId);
                    payload.workspaceId = workspaceId ? Number(workspaceId) : null;
                  } else {
                    payload.operation = "update";
                    payload.id = formMode.id;
                  }
                  await api(CONTAINERS_ENDPOINT, {
                    method: "POST",
                    body: JSON.stringify(payload),
                  });
                  toast.success(t("wa.containerSaved"));
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
                  ? t("wa.newContainerTitle")
                  : t("wa.editContainerTitle")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="container-name" className={labelClass}>
                    {t("wa.name")}
                  </label>
                  <Input
                    id="container-name"
                    name="containerName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label htmlFor="container-title" className={labelClass}>
                    {t("wa.title")}
                  </label>
                  <Input
                    id="container-title"
                    name="containerTitle"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={busy}
                  />
                </div>
                {formMode.mode === "create" && (
                  <div>
                    <label htmlFor="container-workspace" className={labelClass}>
                      {t("wa.workspace")}
                    </label>
                    <select
                      id="container-workspace"
                      name="containerWorkspace"
                      value={workspaceId}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      disabled={busy}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">{t("wa.workspaceProject")}</option>
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={String(workspace.id)}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="container-progress" className={labelClass}>
                    {t("wa.progress")}
                  </label>
                  {progressOptions.length > 0 ? (
                    <select
                      id="container-progress"
                      name="containerProgress"
                      value={progress}
                      onChange={(e) => setProgress(e.target.value)}
                      disabled={busy}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">{t("wa.progressNone")}</option>
                      {progressOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="container-progress"
                      name="containerProgress"
                      value={progress}
                      onChange={(e) => setProgress(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="container-description" className={labelClass}>
                  {t("wa.description")}
                </label>
                <textarea
                  id="container-description"
                  name="containerDescription"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={busy}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                />
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
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : containers.length === 0 && !formMode ? (
            <p className="text-sm text-muted-foreground">{t("wa.emptyContainers")}</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2">{t("wa.identifier")}</th>
                  <th className="px-2 py-2">{t("wa.name")}</th>
                  <th className="px-2 py-2">{t("wa.workspace")}</th>
                  <th className="px-2 py-2">{t("wa.progress")}</th>
                  <th className="px-2 py-2">{t("wa.author")}</th>
                  <th className="px-2 py-2">{t("wa.instances")}</th>
                  <th className="px-2 py-2">{t("wa.updated")}</th>
                  <th className="px-2 py-2" aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {containers.map((container) => (
                  <tr key={container.id} className="border-b hover:bg-muted/40">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {container.identifier}
                    </td>
                    <td className="px-2 py-2 font-medium text-foreground">
                      <Link
                        to={`/work-area/${projectId}/work-containers/${container.id}`}
                        className="hover:underline"
                      >
                        {container.name}
                      </Link>
                      {container.title && (
                        <span className="ml-2 text-muted-foreground">
                          — {container.title}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {container.workspaceName ?? t("wa.workspaceProject")}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {container.progress ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {formatUser(container.author)}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {container.instanceCount}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {formatDate(container.updatedAt)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openUpdate(container)}
                        >
                          {t("wa.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            if (!window.confirm(t("wa.deleteContainerConfirm", { name: container.name }))) {
                              return;
                            }
                            try {
                              await api(CONTAINERS_ENDPOINT, {
                                method: "POST",
                                body: JSON.stringify({
                                  operation: "delete",
                                  id: container.id,
                                }),
                              });
                              toast.success(t("wa.containerDeleted"));
                              await load();
                            } catch (err) {
                              toast.error(translate(err));
                            }
                          }}
                        >
                          {t("wa.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaContainers;
