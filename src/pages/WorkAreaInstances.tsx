import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AttachmentValue,
  CustomType,
  InstanceTemplate,
  ProgressOption,
  UserRef,
  WorkContainer,
  WorkInstance,
  WorkInstanceField,
} from "@/lib/types";

const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";
const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
const TEMPLATES_ENDPOINT = "/api/my/v1/templates";
const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";
const ATTACHMENTS_ENDPOINT = "/api/my/v1/attachments";
const MAX_UPLOAD = 5 * 1024 * 1024;

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

interface FormState {
  mode: "create" | "update";
  id?: number;
  name: string;
  workContainerId: string;
  templateId: string;
  progress: string;
  assigneeIds: number[];
  /** field name -> raw input value (strings; attachments kept as object). */
  fieldValues: Record<string, unknown>;
  /** ad-hoc fields (no template): [{name, type, customType, value}] */
  adHoc: { name: string; type: string; customType: string; value: string }[];
}

const emptyForm = (): FormState => ({
  mode: "create",
  name: "",
  workContainerId: "",
  templateId: "",
  progress: "",
  assigneeIds: [],
  fieldValues: {},
  adHoc: [],
});

/**
 * Work instances of a work area (project): list + create/edit form.
 * The data shape of an instance is defined by a JSON template (or by
 * ad-hoc fields). Field types: number, date, string, attachment (file),
 * html, xml and custom (enumerated values of a configured custom type).
 */
const WorkAreaInstances = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [instances, setInstances] = useState<WorkInstance[]>([]);
  const [containers, setContainers] = useState<WorkContainer[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [progressOptions, setProgressOptions] = useState<ProgressOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

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
      const [instancesData, containersData, templatesData, customTypesData] =
        await Promise.all([
          api<{
            workInstances: WorkInstance[];
            users: UserRef[];
            progressOptions: ProgressOption[] | null;
          }>(INSTANCES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{ workContainers: WorkContainer[] }>(CONTAINERS_ENDPOINT, {
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
      setInstances(instancesData.workInstances ?? []);
      setUsers(instancesData.users ?? []);
      setProgressOptions(instancesData.progressOptions ?? []);
      setContainers(containersData.workContainers ?? []);
      setTemplates(templatesData.templates ?? []);
      setCustomTypes(customTypesData.customTypes ?? []);
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
    const editParam = searchParams.get("edit");
    if (editParam) {
      void openUpdate(Number(editParam), true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, projectId]);

  const currentTemplate =
    form?.templateId !== ""
      ? templates.find(
          (template) => String(template.id) === form.templateId
        ) ?? null
      : null;

  const openCreate = () => {
    const first = containers[0];
    setForm({
      ...emptyForm(),
      workContainerId: first ? String(first.id) : "",
    });
    setFormError(null);
  };

  const openUpdate = async (
    instanceDbId: number,
    fromUrl = false
  ): Promise<void> => {
    try {
      const data = await api<{ workInstance: WorkInstance }>(
        INSTANCES_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({ operation: "get", id: instanceDbId }),
        }
      );
      const instance = data.workInstance;
      const fieldValues: Record<string, unknown> = {};
      for (const field of instance.fields) {
        fieldValues[field.name] = toFormValue(field);
      }
      setForm({
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

  const closeForm = () => {
    setForm(null);
    setFormError(null);
  };

  const buildFieldPayload = (
    state: FormState
  ): { fields: unknown[]; error: string | null } => {
    if (currentTemplate) {
      const fields: unknown[] = currentTemplate.definition.map((def) => ({
        name: def.name,
        value: coerceFieldValue(
          def.type,
          state.fieldValues[def.name],
          def.customType
        ),
      }));
      return { fields, error: null };
    }
    const fields: unknown[] = [];
    for (const item of state.adHoc) {
      const name = item.name.trim();
      if (!name) continue;
      const raw = item.value;
      if (raw === "" || raw === null) continue;
      const customType =
        item.type === "custom" ? item.customType || null : null;
      if (item.type === "custom" && !customType) {
        return {
          fields: [],
          error: t("wa.error.customTypeRequired"),
        };
      }
      fields.push({
        name,
        type: item.type,
        customType,
        value: coerceFieldValue(item.type, raw, customType),
      });
    }
    return { fields, error: null };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    if (!form.name.trim()) {
      setFormError(t("wa.error.nameRequired"));
      return;
    }
    if (!form.workContainerId) {
      setFormError(t("wa.error.containerRequired"));
      return;
    }
    const { fields, error } = buildFieldPayload(form);
    if (error) {
      setFormError(error);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        operation: form.mode === "create" ? "create" : "update",
        name: form.name.trim(),
        progress: form.progress,
        assignees: form.assigneeIds,
        fields,
      };
      if (form.mode === "create") {
        payload.projectId = Number(projectId);
        payload.workContainerId = Number(form.workContainerId);
        payload.templateId = form.templateId
          ? Number(form.templateId)
          : null;
      } else {
        payload.id = form.id;
      }
      await api(INSTANCES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success(t("wa.instanceSaved"));
      closeForm();
      await load();
    } catch (err) {
      setFormError(translate(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (fieldName: string, file: File) => {
    if (file.size > MAX_UPLOAD) {
      setFormError(t("wa.error.attachmentTooLarge", { max: "5 MB" }));
      return;
    }
    setUploadingField(fieldName);
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
      setForm((prev) =>
        prev
          ? {
              ...prev,
              fieldValues: {
                ...prev.fieldValues,
                [fieldName]: data.attachment,
              },
            }
          : prev
      );
    } catch (err) {
      setFormError(translate(err));
    } finally {
      setUploadingField(null);
    }
  };

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  return (
    <>
      <BackLink
        to={`/work-area/${projectId}`}
        label={`${t("workArea.title")} — ${t("wa.workInstances")}`}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t("wa.workInstances")}
            </h1>
            <div className="flex gap-2">
              <Link to={`/work-area/${projectId}/templates`}>
                <Button variant="outline">{t("wa.manageTemplates")}</Button>
              </Link>
              <Button onClick={openCreate} disabled={busy}>
                {t("wa.newInstance")}
              </Button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {form && (
            <form
              className="mb-6 space-y-4 rounded-lg border bg-card p-5 shadow-sm"
              onSubmit={handleSubmit}
            >
              <h2 className="text-lg font-semibold text-foreground">
                {form.mode === "create"
                  ? t("wa.newInstanceTitle")
                  : t("wa.editInstanceTitle")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="instance-name" className={labelClass}>
                    {t("wa.name")}
                  </label>
                  <Input
                    id="instance-name"
                    name="instanceName"
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    disabled={busy}
                  />
                </div>
                <div>
                  <label htmlFor="instance-container" className={labelClass}>
                    {t("wa.container")}
                  </label>
                  <select
                    id="instance-container"
                    name="instanceContainer"
                    value={form.workContainerId}
                    onChange={(e) =>
                      setForm({ ...form, workContainerId: e.target.value })
                    }
                    disabled={busy || form.mode === "update"}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">—</option>
                    {containers.map((container) => (
                      <option key={container.id} value={String(container.id)}>
                        {container.identifier} — {container.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="instance-template" className={labelClass}>
                    {t("wa.template")}
                  </label>
                  <select
                    id="instance-template"
                    name="instanceTemplate"
                    value={form.templateId}
                    onChange={(e) => {
                      const templateId = e.target.value;
                      const template = templates.find(
                        (item) => String(item.id) === templateId
                      );
                      const fieldValues: Record<string, unknown> = {};
                      if (template) {
                        for (const def of template.definition) {
                          fieldValues[def.name] = "";
                        }
                      }
                      setForm({
                        ...form,
                        templateId,
                        fieldValues,
                        adHoc: [],
                      });
                    }}
                    disabled={busy || form.mode === "update"}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">{t("wa.templateNone")}</option>
                    {templates.map((template) => (
                      <option key={template.id} value={String(template.id)}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="instance-progress" className={labelClass}>
                    {t("wa.progress")}
                  </label>
                  {progressOptions.length > 0 ? (
                    <select
                      id="instance-progress"
                      name="instanceProgress"
                      value={form.progress}
                      onChange={(e) =>
                        setForm({ ...form, progress: e.target.value })
                      }
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
                      id="instance-progress"
                      name="instanceProgress"
                      value={form.progress}
                      onChange={(e) =>
                        setForm({ ...form, progress: e.target.value })
                      }
                      disabled={busy}
                    />
                  )}
                </div>
                <div>
                  <span className={labelClass}>{t("wa.assignees")}</span>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-input bg-background p-2">
                    {users.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      users.map((user) => {
                        const checked = form.assigneeIds.includes(user.id!);
                        return (
                          <label
                            key={user.id}
                            className="flex items-center gap-2 text-sm text-foreground"
                          >
                            <input
                              type="checkbox"
                              id={`assignee-${user.id}`}
                              name={`assignee-${user.id}`}
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [
                                      ...form.assigneeIds,
                                      user.id!,
                                    ]
                                  : form.assigneeIds.filter(
                                      (id) => id !== user.id
                                    );
                                setForm({
                                  ...form,
                                  assigneeIds: next,
                                });
                              }}
                              disabled={busy}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span>
                              {user.name} {user.surname} ({user.loginName})
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
              {currentTemplate ? (
                <div className="space-y-4 border-t pt-4">
                  <h3 className="text-base font-semibold text-foreground">
                    {t("wa.templateFields", { name: currentTemplate.name })}
                  </h3>
                  {currentTemplate.definition.map((def) => (
                    <FieldEditor
                      key={def.name}
                      def={def}
                      customTypes={customTypes}
                      value={form.fieldValues[def.name]}
                      busy={busy}
                      uploading={uploadingField === def.name}
                      onChange={(value) =>
                        setForm({
                          ...form,
                          fieldValues: {
                            ...form.fieldValues,
                            [def.name]: value,
                          },
                        })
                      }
                      onFile={(file) => uploadFile(def.name, file)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-foreground">
                      {t("wa.adHocFields")}
                    </h3>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setForm({
                          ...form,
                          adHoc: [
                            ...form.adHoc,
                            { name: "", type: "string", customType: "", value: "" },
                          ],
                        })
                      }
                    >
                      {t("wa.addField")}
                    </Button>
                  </div>
                  {form.adHoc.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("wa.adHocHint")}
                    </p>
                  )}
                  {form.adHoc.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                    >
                      <Input
                        id={`adhoc-name-${index}`}
                        name={`adhocName${index}`}
                        placeholder={t("wa.fieldName")}
                        value={item.name}
                        onChange={(e) => {
                          const next = [...form.adHoc];
                          next[index] = { ...item, name: e.target.value };
                          setForm({ ...form, adHoc: next });
                        }}
                        disabled={busy}
                      />
                      <select
                        id={`adhoc-type-${index}`}
                        name={`adhocType${index}`}
                        value={item.type}
                        onChange={(e) => {
                          const next = [...form.adHoc];
                          next[index] = { ...item, type: e.target.value };
                          setForm({ ...form, adHoc: next });
                        }}
                        disabled={busy}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                      >
                        {AD_HOC_TYPES.map((typeValue) => (
                          <option key={typeValue} value={typeValue}>
                            {t(`fieldType.${typeValue}`)}
                          </option>
                        ))}
                      </select>
                      {item.type === "custom" ? (
                        <select
                          id={`adhoc-custom-${index}`}
                          name={`adhocCustomType${index}`}
                          value={item.customType}
                          onChange={(e) => {
                            const next = [...form.adHoc];
                            next[index] = {
                              ...item,
                              customType: e.target.value,
                            };
                            setForm({ ...form, adHoc: next });
                          }}
                          disabled={busy}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                        >
                          <option value="">—</option>
                          {customTypes
                            .filter((type) => !type.isDisabled)
                            .map((type) => (
                              <option key={type.id} value={type.name}>
                                {type.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span className="hidden sm:block" aria-hidden="true" />
                      )}
                      <div className="sm:col-span-4">
                        <Input
                          id={`adhoc-value-${index}`}
                          name={`adhocValue${index}`}
                          placeholder={t("wa.fieldValue")}
                          value={typeof item.value === "string" ? item.value : ""}
                          onChange={(e) => {
                            const next = [...form.adHoc];
                            next[index] = { ...item, value: e.target.value };
                            setForm({ ...form, adHoc: next });
                          }}
                          disabled={busy}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            adHoc: form.adHoc.filter(
                              (_, i) => i !== index
                            ),
                          })
                        }
                        disabled={busy}
                      >
                        {t("wa.remove")}
                      </Button>
                    </div>
                  ))}
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
                <Button type="button" variant="outline" onClick={closeForm}>
                  {t("wa.cancel")}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : instances.length === 0 && !form ? (
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
                  <th className="px-2 py-2">{t("wa.template")}</th>
                  <th className="px-2 py-2">{t("wa.progress")}</th>
                  <th className="px-2 py-2">{t("wa.assignees")}</th>
                  <th className="px-2 py-2">{t("wa.updated")}</th>
                  <th className="px-2 py-2" aria-label="actions" />
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
                        to={`/work-area/${projectId}/work-instances/${instance.id}`}
                        className="hover:underline"
                      >
                        {instance.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {instance.workContainerName}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {instance.templateName ?? "—"}
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
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openUpdate(instance.id)}
                        >
                          {t("wa.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                t("wa.deleteInstanceConfirm", {
                                  name: instance.name,
                                })
                              )
                            ) {
                              return;
                            }
                            try {
                              await api(INSTANCES_ENDPOINT, {
                                method: "POST",
                                body: JSON.stringify({
                                  operation: "delete",
                                  id: instance.id,
                                }),
                              });
                              toast.success(t("wa.instanceDeleted"));
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

/** Convert a stored field value to the form representation. */
function toFormValue(field: WorkInstanceField): unknown {
  const value = field.value;
  if (field.type === "attachment" && value && typeof value === "object") {
    return value;
  }
  if (field.type === "custom" && Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value);
}

/** Field types available for ad-hoc fields (no attachment: those need a template). */
const AD_HOC_TYPES = ["number", "date", "string", "html", "xml", "custom"];

/** Convert a raw form value into the stored value for the given field type. */
function coerceFieldValue(
  type: string,
  raw: unknown,
  _customTypeName: string | null
): unknown {
  if (type === "number") {
    if (raw === "" || raw === null || raw === undefined) return null;
    const parsed = Number(String(raw).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === "date") {
    return raw ? String(raw) : null;
  }
  if (type === "attachment") {
    if (raw && typeof raw === "object") return raw;
    return null;
  }
  if (type === "custom") {
    if (Array.isArray(raw)) return raw.length ? raw : null;
    return raw ? String(raw) : null;
  }
  // string, html, xml
  return raw ? String(raw) : null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.substring(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function downloadAttachment(s3Key: string): Promise<void> {
  const data = await api<{ attachment: { fileName: string; content: string } }>(
    ATTACHMENTS_ENDPOINT,
    {
      method: "POST",
      body: JSON.stringify({ operation: "download", s3Key }),
    }
  );
  const byteChars = atob(data.attachment.content);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = data.attachment.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface FieldEditorProps {
  def: import("@/lib/types").FieldDef;
  customTypes: CustomType[];
  value: unknown;
  busy: boolean;
  uploading: boolean;
  onChange: (value: unknown) => void;
  onFile: (file: File) => void;
}

/** Renders the input for one template field, by field type. */
const FieldEditor = ({
  def,
  customTypes,
  value,
  busy,
  uploading,
  onChange,
  onFile,
}: FieldEditorProps) => {
  const { t } = useI18n();
  const customType = def.customType
    ? customTypes.find((type) => type.name === def.customType) ?? null
    : null;
  const typeLabel = t(`fieldType.${def.type}`);
  const id = `field-${def.name.replace(/[^A-Za-z0-9]/g, "-")}`;

  let control: React.ReactNode;
  if (def.type === "number") {
    control = (
      <Input
        id={id}
        name={id}
        type="number"
        step="any"
        value={value === "" ? "" : String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
      />
    );
  } else if (def.type === "date") {
    control = (
      <Input
        id={id}
        name={id}
        type="date"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
      />
    );
  } else if (def.type === "string") {
    control = (
      <Input
        id={id}
        name={id}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
      />
    );
  } else if (def.type === "html" || def.type === "xml") {
    control = (
      <textarea
        id={id}
        name={id}
        rows={4}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ${
          def.type === "xml" ? "font-mono" : ""
        }`}
      />
    );
  } else if (def.type === "attachment") {
    const attachment =
      value && typeof value === "object" ? (value as AttachmentValue) : null;
    control = (
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={`${id}-file`}
          className="inline-flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          {t("wa.attachment")}
          <input
            id={`${id}-file`}
            name={`${id}-file`}
            type="file"
            className="hidden"
            disabled={busy || uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {uploading && (
          <span className="text-sm text-muted-foreground">
            {t("wa.uploading")}…
          </span>
        )}
        {attachment && (
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => void downloadAttachment(attachment.s3Key)}
          >
            {attachment.fileName} ({Math.round(attachment.size / 1024)} KB)
          </button>
        )}
      </div>
    );
  } else if (def.type === "custom") {
    if (!customType) {
      control = (
        <p className="text-sm text-destructive">
          {t("wa.error.customTypeMissing")}
        </p>
      );
    } else if (customType.multiSelect) {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="flex flex-wrap gap-3">
          {customType.options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  id={`${id}-${option.value}`}
                  name={id}
                  value={option.value}
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value);
                    onChange(next);
                  }}
                  disabled={busy}
                  className="h-4 w-4 rounded border-input"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      );
    } else {
      control = (
        <select
          id={id}
          name={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">—</option>
          {customType.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
  } else {
    control = null;
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <label
          htmlFor={id}
          className="text-sm font-medium text-foreground"
        >
          {def.name}
        </label>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {typeLabel}
        </span>
      </div>
      {def.description && (
        <p className="mb-2 text-xs text-muted-foreground">{def.description}</p>
      )}
      {control}
    </div>
  );
};

export default WorkAreaInstances;
