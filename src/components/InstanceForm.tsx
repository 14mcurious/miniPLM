import { useState } from "react";
import { useI18n } from "@/i18n";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FieldEditor from "@/components/FieldEditor";
import type {
  CustomType,
  InstanceTemplate,
  ProgressOption,
  UserRef,
  WorkContainer,
} from "@/lib/types";
import {
  AD_HOC_TYPES,
  ATTACHMENTS_ENDPOINT,
  INSTANCES_ENDPOINT,
  MAX_UPLOAD,
  buildFieldPayload,
  emptyForm,
  fileToBase64,
  type FormState,
} from "@/lib/work-instance-form";

export interface InstanceFormProps {
  form: FormState;
  setForm: (form: FormState | null) => void;
  projectId: string;
  containers: WorkContainer[];
  templates: InstanceTemplate[];
  customTypes: CustomType[];
  users: UserRef[];
  progressOptions: ProgressOption[];
  /**
   * True when the selected template includes a progress field. The progress
   * control is rendered only in that case (progress is a template field,
   * never a default one).
   */
  progressEnabled: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** Called after a successful create/update; receives the saved instance id. */
  onSaved: (id: number) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

/**
 * Shared create/edit form for a work instance.
 * Used by both the "New Work Instance" page and the
 * "Work Instance Configuration" page.
 */
const InstanceForm = ({
  form,
  setForm,
  projectId,
  containers,
  templates,
  customTypes,
  users,
  progressOptions,
  progressEnabled,
  busy,
  setBusy,
  onSaved,
  onCancel,
}: InstanceFormProps) => {
  const { t } = useI18n();
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const currentTemplate =
    form.templateId !== ""
      ? templates.find(
          (template) => String(template.id) === form.templateId
        ) ?? null
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!form.title.trim()) {
      setFormError(t("wa.error.titleRequired"));
      return;
    }
    if (!form.workContainerId) {
      setFormError(t("wa.error.containerRequired"));
      return;
    }
    const { fields, error } = buildFieldPayload(form, currentTemplate, t);
    if (error) {
      setFormError(error);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        operation: form.mode === "create" ? "create" : "update",
        title: form.title.trim(),
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
      const data = await api<{ workInstance?: { id: number } }>(
        INSTANCES_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      toast.success(t("wa.instanceSaved"));
      const savedId =
        data.workInstance?.id ?? form.id ?? 0;
      onSaved(savedId);
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
      const data = await api<{ attachment: import("@/lib/types").AttachmentValue }>(
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
      setForm(
        form
          ? {
              ...form,
              fieldValues: {
                ...form.fieldValues,
                [fieldName]: data.attachment,
              },
            }
          : form
      );
    } catch (err) {
      setFormError(translate(err));
    } finally {
      setUploadingField(null);
    }
  };

  const closeForm = () => {
    setFormError(null);
    onCancel();
  };

  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  return (
    <form
      className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
      onSubmit={handleSubmit}
    >
      <h2 className="text-lg font-semibold text-foreground">
        {form.mode === "create"
          ? t("wa.newInstanceTitle")
          : t("wa.editInstanceTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="instance-title" className={labelClass}>
            {t("wa.title")}
          </label>
          <Input
            id="instance-title"
            name="instanceTitle"
            value={form.title}
            onChange={(e) =>
              setForm({ ...form, title: e.target.value })
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
                {container.identifier}
                {container.title ? ` — ${container.title}` : ""}
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
                  if (def.type !== "progress") {
                    fieldValues[def.name] = "";
                  }
                }
              }
              setForm({
                ...form,
                templateId,
                fieldValues,
                adHoc: [],
                // A different template means a different progress workflow:
                // the previous value is not valid for the new one.
                progress: "",
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
        {progressEnabled && (
          <div>
            <label htmlFor="instance-progress" className={labelClass}>
              {t("wa.progress")}
            </label>
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
                          ? [...form.assigneeIds, user.id!]
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
          {currentTemplate.definition
            .filter((def) => def.type !== "progress")
            .map((def) => (
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
  );
};

export default InstanceForm;
