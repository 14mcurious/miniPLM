import { useCallback, useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import InstanceForm from "@/components/InstanceForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CUSTOM_TYPES_ENDPOINT,
  TEMPLATES_ENDPOINT,
  toFormValue,
  type FormState,
} from "@/lib/work-instance-form";
import {
  CustomType,
  InstanceTemplate,
  ProgressOption,
  UserRef,
  WorkContainer,
  WorkInstance,
  Workspace,
} from "@/lib/types";

const WORKSPACES_ENDPOINT = "/api/my/v1/workspaces";
const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

/**
 * Work space detail: the work containers of this work space and the work
 * instances of those containers. Work containers and work instances are
 * managed here: a container can only be created inside a work space.
 */
const WorkAreaWorkspaceDetail = () => {
  const { t } = useI18n();
  const { projectId, workspaceId } = useParams<{
    projectId: string;
    workspaceId: string;
  }>();
  const { status } = useAuth();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [containers, setContainers] = useState<WorkContainer[]>([]);
  const [instances, setInstances] = useState<WorkInstance[]>([]);
  const [progressOptions, setProgressOptions] = useState<ProgressOption[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [formMode, setFormMode] = useState<
    null | { mode: "create" } | { mode: "update"; id: number }
  >(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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
    if (!projectId || !workspaceId) return;
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const [workspacesData, containersData, instancesData] =
        await Promise.all([
          api<{ workspaces: Workspace[] }>(WORKSPACES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{
            workContainers: WorkContainer[];
            progressOptions: ProgressOption[] | null;
          }>(CONTAINERS_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
              workspaceId: Number(workspaceId),
            }),
          }),
          api<{
            workInstances: WorkInstance[];
            users: UserRef[];
          }>(INSTANCES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
        ]);
      const found =
        workspacesData.workspaces?.find(
          (ws) => String(ws.id) === String(workspaceId)
        ) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setWorkspace(found);
      const workspaceContainers = containersData.workContainers ?? [];
      setContainers(workspaceContainers);
      setProgressOptions(containersData.progressOptions ?? []);
      // Instances of the containers belonging to this work space.
      const containerIds = new Set(
        workspaceContainers.map((c) => String(c.id))
      );
      setInstances(
        (instancesData.workInstances ?? []).filter((instance) =>
          containerIds.has(String(instance.workContainerId))
        )
      );
      setUsers(instancesData.users ?? []);
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (status === "authenticated") {
      void load();
      // "?edit=<id>" opens the inline edit form of a work instance
      // (the instance detail page navigates here with this parameter).
      const editParam = searchParams.get("edit");
      if (editParam) {
        void openInstanceUpdate(Number(editParam), true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, load]);

  const openCreate = () => {
    setFormMode({ mode: "create" });
    setName("");
    setTitle("");
    setDescription("");
    setProgress("");
    setFormError(null);
  };

  const openUpdate = (container: WorkContainer) => {
    setFormMode({ mode: "update", id: container.id });
    setName(container.name);
    setTitle(container.title ?? "");
    setDescription(container.description ?? "");
    setProgress(container.progress ?? "");
    setFormError(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setFormError(null);
  };

  const openInstanceUpdate = async (
    instanceDbId: number,
    fromUrl = false
  ): Promise<void> => {
    if (!projectId) return;
    try {
      const [instanceData, templatesData, customTypesData] =
        await Promise.all([
          api<{ workInstance: WorkInstance }>(INSTANCES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({ operation: "get", id: instanceDbId }),
          }),
          api<{ templates: InstanceTemplate[] }>(TEMPLATES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{ customTypes: CustomType[] }>(CUSTOM_TYPES_ENDPOINT),
        ]);
      const instance = instanceData.workInstance;
      if (!instance) return;
      const fieldValues: Record<string, unknown> = {};
      for (const field of instance.fields) {
        fieldValues[field.name] = toFormValue(field);
      }
      setTemplates(templatesData.templates ?? []);
      setCustomTypes(customTypesData.customTypes ?? []);
      setEditForm({
        mode: "update",
        id: instanceDbId,
        name: instance.name,
        workContainerId: String(instance.workContainerId),
        templateId: instance.templateId ? String(instance.templateId) : "",
        progress: instance.progress ?? "",
        assigneeIds: instance.assigneeIds ?? [],
        fieldValues,
        adHoc: [],
      });
      if (fromUrl) {
        const next = new URLSearchParams(searchParams);
        next.delete("edit");
        setSearchParams(next, { replace: true });
      }
    } catch (err) {
      toast.error(translate(err));
    }
  };

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const labelClass = "mb-1 block text-sm font-medium text-foreground";
  const base = `/work-area/${projectId}`;

  return (
    <>
      <BackLink to={`${base}/workspaces`} label={t("wa.workspaces")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : notFound ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("wa.empty")}
            </div>
          ) : (
            <>
              <h1 className="mb-1 text-3xl font-bold tracking-tight text-foreground">
                {workspace?.name}
                {workspace?.title && (
                  <span className="ml-3 text-xl font-normal text-muted-foreground">
                    — {workspace.title}
                  </span>
                )}
              </h1>
              <p className="mb-6 text-sm text-muted-foreground">
                {t("wa.workspaceDetailHint")}
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}

              {/* Work containers of this work space */}
              <section className="mb-8">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("wa.workContainers")}
                  </h2>
                  <Button size="sm" onClick={openCreate} disabled={busy}>
                    {t("wa.newContainer")}
                  </Button>
                </div>

                {formMode && (
                  <form
                    className="mb-4 space-y-4 rounded-lg border bg-card p-5 shadow-sm"
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
                          projectId: Number(projectId),
                          workspaceId: Number(workspaceId),
                          name: name.trim(),
                          title: title.trim(),
                          description: description.trim(),
                          progress: progress.trim() || null,
                        };
                        if (formMode.mode === "create") {
                          payload.operation = "create";
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
                    <h3 className="text-lg font-semibold text-foreground">
                      {formMode.mode === "create"
                        ? t("wa.newContainerTitle")
                        : t("wa.editContainerTitle")}
                    </h3>
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
                    </div>
                    <div>
                      <label
                        htmlFor="container-description"
                        className={labelClass}
                      >
                        {t("wa.description")}
                      </label>
                      <Input
                        id="container-description"
                        name="containerDescription"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                    <div>
                      <label htmlFor="container-progress" className={labelClass}>
                        {t("wa.progress")}
                      </label>
                      <select
                        id="container-progress"
                        name="containerProgress"
                        value={progress}
                        onChange={(e) => setProgress(e.target.value)}
                        disabled={busy}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                      >
                        <option value="">—</option>
                        {(progressOptions ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
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
                      <Button
                        type="button"
                        variant="outline"
                        onClick={closeForm}
                      >
                        {t("wa.cancel")}
                      </Button>
                    </div>
                  </form>
                )}

                {containers.length === 0 && !formMode ? (
                  <p className="text-sm text-muted-foreground">
                    {t("wa.emptyContainers")}
                  </p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-2">{t("wa.identifier")}</th>
                        <th className="px-2 py-2">{t("wa.name")}</th>
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
                              to={`${base}/work-containers/${container.id}`}
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
                                  if (
                                    !window.confirm(
                                      t("wa.deleteContainerConfirm", {
                                        name: container.name,
                                      })
                                    )
                                  ) {
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
              </section>

              {/* Work instances of this work space's containers */}
              <section>
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("wa.workInstances")}
                  </h2>
                  <Button
                    size="sm"
                    asChild
                    disabled={containers.length === 0}
                  >
                    <Link
                      to={`${base}/workspaces/${workspaceId}/work-instances/new`}
                    >
                      {t("wa.newInstance")}
                    </Link>
                  </Button>
                </div>
                {editForm && (
                  <div className="mb-4">
                    <InstanceForm
                      form={editForm}
                      setForm={setEditForm}
                      projectId={projectId ?? ""}
                      containers={containers}
                      templates={templates}
                      customTypes={customTypes}
                      users={users}
                      progressOptions={progressOptions}
                      busy={editBusy}
                      setBusy={setEditBusy}
                      onSaved={() => {
                        setEditForm(null);
                        void load();
                      }}
                      onCancel={() => setEditForm(null)}
                    />
                  </div>
                )}
                {instances.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("wa.emptyInstances")}
                  </p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-2">{t("wa.instanceId")}</th>
                        <th className="px-2 py-2">{t("wa.name")}</th>
                        <th className="px-2 py-2">{t("wa.container")}</th>
                        <th className="px-2 py-2">{t("wa.progress")}</th>
                        <th className="px-2 py-2">{t("wa.assignees")}</th>
                        <th className="px-2 py-2">{t("wa.updated")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {instances.map((instance) => (
                        <tr key={instance.id} className="border-b hover:bg-muted/40">
                          <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                            {instance.instanceId}
                          </td>
                          <td className="px-2 py-2 font-medium text-foreground">
                            <Link
                              to={`${base}/work-instances/${instance.id}`}
                              className="hover:underline"
                            >
                              {instance.name}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {instance.workContainerName}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {instance.progress ?? "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {(instance.assigneeIds ?? []).join(", ") || "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {formatDate(instance.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaWorkspaceDetail;
