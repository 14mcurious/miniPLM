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
import { useProjectModes } from "@/hooks/usePermissions";
import { api, ApiError } from "@/lib/api";
import { allowedProgressOptions, progressLabel } from "@/lib/workflow-progress";
import BackLink from "@/components/BackLink";
import FieldEditor from "@/components/FieldEditor";
import InstanceForm from "@/components/InstanceForm";
import WorkAreaContainersTable from "@/components/WorkAreaContainersTable";
import WorkAreaInstancesTable from "@/components/WorkAreaInstancesTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ATTACHMENTS_ENDPOINT,
  CUSTOM_TYPES_ENDPOINT,
  MAX_UPLOAD,
  TEMPLATES_ENDPOINT,
  buildFieldPayload,
  fileToBase64,
  toFormValue,
  type FormState,
} from "@/lib/work-instance-form";
import {
  AttachmentValue,
  CustomType,
  InstanceTemplate,
  UserRef,
  WorkContainer,
  WorkInstance,
  Workspace,
} from "@/lib/types";

const WORKSPACES_ENDPOINT = "/api/my/v1/workspaces";
const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";

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
  const { can } = useProjectModes(projectId);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [containers, setContainers] = useState<WorkContainer[]>([]);
  const [instances, setInstances] = useState<WorkInstance[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState("");
  // Containers use the same template library as work instances: template,
  // template fields and (when the template defines it) progress.
  const [containerTemplateId, setContainerTemplateId] = useState("");
  const [containerFieldValues, setContainerFieldValues] = useState<
    Record<string, unknown>
  >({});
  const [containerUploading, setContainerUploading] = useState<
    string | null
  >(null);
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
      const [
        workspacesData,
        containersData,
        instancesData,
        templatesData,
        customTypesData,
      ] = await Promise.all([
          api<{ workspaces: Workspace[] }>(WORKSPACES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{
            workContainers: WorkContainer[];
            userRoles: string[];
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
          api<{ templates: InstanceTemplate[] }>(TEMPLATES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{ customTypes: CustomType[] }>(CUSTOM_TYPES_ENDPOINT),
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
      setUserRoles(containersData.userRoles ?? []);
      setTemplates(templatesData.templates ?? []);
      setCustomTypes(customTypesData.customTypes ?? []);
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
        if (can("U")) {
          void openInstanceUpdate(Number(editParam), true);
        } else {
          // Read-only access: the edit form is not available; drop the
          // parameter instead of opening a form the backend would reject.
          const next = new URLSearchParams(searchParams);
          next.delete("edit");
          setSearchParams(next, { replace: true });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, load]);

  const openCreate = () => {
    setFormMode({ mode: "create" });
    setTitle("");
    setDescription("");
    setProgress("");
    setContainerTemplateId("");
    setContainerFieldValues({});
    setFormError(null);
  };

  const openUpdate = (container: WorkContainer) => {
    setFormMode({ mode: "update", id: container.id });
    setTitle(container.title ?? "");
    setDescription(container.description ?? "");
    setProgress(container.progress ?? "");
    setContainerTemplateId(
      container.templateId ? String(container.templateId) : ""
    );
    const fieldValues: Record<string, unknown> = {};
    for (const field of container.fields ?? []) {
      fieldValues[field.name] = toFormValue(field);
    }
    setContainerFieldValues(fieldValues);
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
    try {
      const instanceData = await api<{ workInstance: WorkInstance }>(
        INSTANCES_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({ operation: "get", id: instanceDbId }),
        }
      );
      const instance = instanceData.workInstance;
      if (!instance) return;
      const fieldValues: Record<string, unknown> = {};
      for (const field of instance.fields) {
        fieldValues[field.name] = toFormValue(field);
      }
      setEditForm({
        mode: "update",
        id: instanceDbId,
        title: instance.title,
        workContainerId: String(instance.workContainerId),
        templateId: instance.templateId ? String(instance.templateId) : "",
        progress: instance.progress ?? "",
        assigneeIds: instance.assigneeIds ?? [],
        fieldValues,
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

  // Containers share the template library with work instances: progress is
  // a template field, so the offered choices come from the selected
  // template's workflow (create: initial state; update: role-filtered
  // transitions). Without a progress field the control is absent.
  const containerTemplate =
    templates.find(
      (template) => String(template.id) === containerTemplateId
    ) ?? null;
  const containerProgressWorkflow =
    containerTemplate?.progressWorkflow ?? null;
  const containerProgressOptions = allowedProgressOptions(
    containerProgressWorkflow,
    userRoles,
    progress,
    formMode?.mode === "update" ? "update" : "create"
  );

  // The instance edit form offers the progress choices of the template
  // currently selected in the form (the row's template when opened).
  const editTemplate = editForm
    ? templates.find(
        (template) => String(template.id) === editForm.templateId
      ) ?? null
    : null;
  const editProgressWorkflow = editTemplate?.progressWorkflow ?? null;

  const uploadContainerFile = async (fieldName: string, file: File) => {
    if (file.size > MAX_UPLOAD) {
      setFormError(t("wa.error.attachmentTooLarge", { max: "5 MB" }));
      return;
    }
    setContainerUploading(fieldName);
    try {
      const base64 = await fileToBase64(file);
      const data = await api<{ attachment: AttachmentValue }>(
        ATTACHMENTS_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "upload",
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            content: base64,
          }),
        }
      );
      setContainerFieldValues((prev) => ({
        ...prev,
        [fieldName]: data.attachment,
      }));
    } catch (err) {
      toast.error(translate(err));
    } finally {
      setContainerUploading(null);
    }
  };

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

              {/* Work containers of this work space (hidden while the work
              instance edit form is open). */}
              {!editForm && (
              <section className="mb-8">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("wa.workContainers")}
                  </h2>
                  {can("C") && (
                    <Button size="sm" onClick={openCreate} disabled={busy}>
                      {t("wa.newContainer")}
                    </Button>
                  )}
                </div>

                {formMode && (
                  <form
                    className="mb-4 space-y-4 rounded-lg border bg-card p-5 shadow-sm"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (busy) return;
                      setBusy(true);
                      setFormError(null);
                      try {
                        const {
                          fields: templateFields,
                          error: fieldsError,
                        } = buildFieldPayload(
                          {
                            mode: formMode.mode,
                            title: "",
                            workContainerId: "",
                            templateId: containerTemplateId,
                            progress: "",
                            assigneeIds: [],
                            fieldValues: containerFieldValues,
                          },
                          containerTemplate,
                          t
                        );
                        if (fieldsError) {
                          setFormError(translate(fieldsError));
                          return;
                        }
                        const payload: Record<string, unknown> = {
                          projectId: Number(projectId),
                          workspaceId: Number(workspaceId),
                          title: title.trim(),
                          description: description.trim(),
                          progress: progress.trim() || null,
                          templateId: containerTemplateId
                            ? Number(containerTemplateId)
                            : null,
                        };
                        // fields === null: legacy record without a
                        // template; omit the key so the stored fields are
                        // kept untouched by the backend merge.
                        if (templateFields) {
                          payload.fields = templateFields;
                        }
                        if (formMode.mode === "create") {
                          payload.operation = "create";
                        } else {
                          payload.operation = "update";
                          payload.id = formMode.id;
                        }
                        const data = await api<{
                          workContainer?: { id: number };
                        }>(CONTAINERS_ENDPOINT, {
                          method: "POST",
                          body: JSON.stringify(payload),
                        });
                        toast.success(t("wa.containerSaved"));
                        if (formMode.mode === "create") {
                          const createdId = data?.workContainer?.id;
                          // Keep the user in the editing context: after
                          // creation the form becomes the update form of
                          // the new container, so further saves are
                          // updates (never duplicates). If the id is
                          // missing for any reason, fall back to closing.
                          if (createdId != null) {
                            setFormMode({ mode: "update", id: createdId });
                          } else {
                            closeForm();
                          }
                        }
                        // The form stays open on success so the user can
                        // keep working on the container; the Cancel button
                        // closes it explicitly.
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
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="container-template" className={labelClass}>
                          {t("wa.template")}
                        </label>
                        <select
                          id="container-template"
                          name="containerTemplate"
                          value={containerTemplateId}
                          onChange={(e) => {
                            const templateId = e.target.value;
                            const template = templates.find(
                              (item) => String(item.id) === templateId
                            );
                            const fieldValues: Record<string, unknown> = {};
                            if (template) {
                              for (const def of template.definition) {
                                if (def.type !== "progress") {
                                  fieldValues[def.name] = "";
                                }
                              }
                            }
                            setContainerTemplateId(templateId);
                            setContainerFieldValues(fieldValues);
                            // A different template means a different
                            // progress workflow: reset the value.
                            setProgress("");
                          }}
                          disabled={busy || formMode?.mode === "update"}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                        >
                          <option value="">{t("wa.templateNone")}</option>
                          {templates.map((template) => (
                            <option
                              key={template.id}
                              value={String(template.id)}
                            >
                              {template.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {containerProgressWorkflow && (
                        <div>
                          <label
                            htmlFor="container-progress"
                            className={labelClass}
                          >
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
                            <option value="">{t("wa.progressNone")}</option>
                            {containerProgressOptions.map((option) => (
                              <option
                                key={option.value}
                                value={option.value}
                                title={option.label || option.value}
                              >
                                {option.value}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
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
                    {containerTemplate &&
                      containerTemplate.definition.filter(
                        (def) => def.type !== "progress"
                      ).length > 0 && (
                        <div className="space-y-4 border-t pt-4">
                          <h3 className="text-base font-semibold text-foreground">
                            {t("wa.templateFields", {
                              name: containerTemplate.name,
                            })}
                          </h3>
                          {containerTemplate.definition
                            .filter((def) => def.type !== "progress")
                            .map((def) => (
                              <FieldEditor
                                key={def.name}
                                def={def}
                                customTypes={customTypes}
                                value={containerFieldValues[def.name]}
                                busy={busy}
                                uploading={
                                  containerUploading === def.name
                                }
                                onChange={(value) =>
                                  setContainerFieldValues((prev) => ({
                                    ...prev,
                                    [def.name]: value,
                                  }))
                                }
                                onFile={(file) =>
                                  void uploadContainerFile(def.name, file)
                                }
                              />
                            ))}
                        </div>
                      )}
                    {!containerTemplate && (
                      <div className="border-t pt-4">
                        <p className="text-sm text-muted-foreground">
                          {formMode.mode === "update"
                            ? t("wa.noTemplateHint")
                            : t("wa.error.templateRequired")}
                        </p>
                      </div>
                    )}
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
                  <WorkAreaContainersTable
                    base={base}
                    containers={containers}
                    canEdit={can("U")}
                    canDelete={can("D")}
                    onEdit={openUpdate}
                    onDeleted={() => void load()}
                  />
                )}
              </section>
              )}

              {/* Work instances of this work space's containers */}
              <section>
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("wa.workInstances")}
                  </h2>
                  {!editForm && can("C") && (
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
                  )}
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
                      progressOptions={allowedProgressOptions(
                        editProgressWorkflow,
                        userRoles,
                        editForm.progress,
                        "update"
                      )}
                      progressEnabled={editProgressWorkflow !== null}
                      busy={editBusy}
                      setBusy={setEditBusy}
                      onSaved={() => {
                        // Keep the edit form open on success: the user
                        // stays in the editing context and can keep
                        // working on the instance; Cancel closes it.
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
                  <WorkAreaInstancesTable
                    base={base}
                    instances={instances}
                  />
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
