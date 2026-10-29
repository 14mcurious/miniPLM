import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { allowedProgressOptions } from "@/lib/workflow-progress";
import FieldEditor from "@/components/FieldEditor";
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
} from "@/lib/work-instance-form";
import {
  AttachmentValue,
  CustomType,
  InstanceTemplate,
  WorkContainer,
} from "@/lib/types";

const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";

export interface ContainerFormProps {
  projectId: number;
  /** Work space the new container belongs to (create mode). */
  workspaceId?: number | null;
  /** Container being edited (update mode). */
  container?: WorkContainer | null;
  /** Called after a successful save with the saved container id. */
  onSaved: (id: number) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

/**
 * Shared work container create/update form.
 *
 * Create: opened from a work space view ("New work Container"); after a
 * successful save the user is taken to the container detail page.
 * Update: opened from the container detail page ("Edit", D2); the same
 * form is used so editing happens where the container is presented.
 *
 * Containers use the same template library as work instances: template,
 * template fields and (when the template defines it) progress.
 */
const ContainerForm = ({
  projectId,
  workspaceId = null,
  container = null,
  onSaved,
  onCancel,
}: ContainerFormProps) => {
  const { t } = useI18n();
  const mode = container ? "update" : "create";

  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  // Seed the update form from the stored container values.
  useEffect(() => {
    if (!container) return;
    setTitle(container.title ?? "");
    setDescription(container.description ?? "");
    setProgress(container.progress ?? "");
    setTemplateId(container.templateId ? String(container.templateId) : "");
    const values: Record<string, unknown> = {};
    for (const field of container.fields ?? []) {
      values[field.name] = toFormValue(field);
    }
    setFieldValues(values);
  }, [container]);

  const load = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const scopeWorkspace =
        workspaceId ?? container?.workspaceId ?? undefined;
      const [containersData, templatesData, customTypesData] =
        await Promise.all([
          api<{
            workContainers: WorkContainer[];
            userRoles: string[];
          }>(CONTAINERS_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId,
              ...(scopeWorkspace != null ? { workspaceId: scopeWorkspace } : {}),
            }),
          }),
          api<{ templates: InstanceTemplate[] }>(TEMPLATES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({ operation: "list", projectId }),
          }),
          api<{ customTypes: CustomType[] }>(CUSTOM_TYPES_ENDPOINT),
        ]);
      setUserRoles(containersData.userRoles ?? []);
      setTemplates(templatesData.templates ?? []);
      setCustomTypes(customTypesData.customTypes ?? []);
    } catch (err) {
      setDataError(translate(err));
    } finally {
      setDataLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspaceId, container?.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentTemplate =
    templates.find((template) => String(template.id) === templateId) ?? null;
  const progressWorkflow = currentTemplate?.progressWorkflow ?? null;
  const progressOptions = allowedProgressOptions(
    progressWorkflow,
    userRoles,
    progress,
    mode
  );

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
      setFieldValues((prev) => ({ ...prev, [fieldName]: data.attachment }));
    } catch (err) {
      toast.error(translate(err));
    } finally {
      setUploadingField(null);
    }
  };

  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  return (
    <form
      className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const { fields: templateFields, error: fieldsError } =
          buildFieldPayload(
            {
              mode,
              title: "",
              workContainerId: "",
              templateId,
              progress: "",
              assigneeIds: [],
              fieldValues,
            },
            currentTemplate,
            t
          );
        if (fieldsError) {
          setFormError(translate(fieldsError));
          return;
        }
        setBusy(true);
        setFormError(null);
        try {
          const payload: Record<string, unknown> = {
            projectId,
            title: title.trim(),
            description: description.trim(),
            progress: progress.trim() || null,
            templateId: templateId ? Number(templateId) : null,
          };
          // fields === null: legacy record without a template; omit the
          // key so the stored fields are kept untouched by the backend
          // merge.
          if (templateFields) {
            payload.fields = templateFields;
          }
          if (mode === "create") {
            payload.operation = "create";
            if (workspaceId != null) {
              payload.workspaceId = workspaceId;
            }
          } else {
            payload.operation = "update";
            payload.id = container!.id;
          }
          const data = await api<{ workContainer?: { id: number } }>(
            CONTAINERS_ENDPOINT,
            { method: "POST", body: JSON.stringify(payload) }
          );
          toast.success(t("wa.containerSaved"));
          const savedId =
            data?.workContainer?.id ?? (mode === "update" ? container!.id : 0);
          onSaved(savedId);
        } catch (err) {
          setFormError(translate(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="text-lg font-semibold text-foreground">
        {mode === "create"
          ? t("wa.newContainerTitle")
          : t("wa.editContainerTitle")}
      </h3>

      {dataError && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {dataError}
        </div>
      )}
      {dataLoading ? (
        <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
      ) : (
        <>
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
                value={templateId}
                onChange={(e) => {
                  const nextTemplateId = e.target.value;
                  const template = templates.find(
                    (item) => String(item.id) === nextTemplateId
                  );
                  const values: Record<string, unknown> = {};
                  if (template) {
                    for (const def of template.definition) {
                      if (def.type !== "progress") {
                        values[def.name] = "";
                      }
                    }
                  }
                  setTemplateId(nextTemplateId);
                  setFieldValues(values);
                  // A different template means a different progress
                  // workflow: reset the value.
                  setProgress("");
                }}
                disabled={busy || mode === "update"}
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
            {progressWorkflow && (
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
          </div>
          <div>
            <label htmlFor="container-description" className={labelClass}>
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
          {currentTemplate &&
            currentTemplate.definition.filter(
              (def) => def.type !== "progress"
            ).length > 0 && (
              <div className="space-y-4 border-t pt-4">
                <h4 className="text-base font-semibold text-foreground">
                  {t("wa.templateFields", { name: currentTemplate.name })}
                </h4>
                {currentTemplate.definition
                  .filter((def) => def.type !== "progress")
                  .map((def) => (
                    <FieldEditor
                      key={def.name}
                      def={def}
                      customTypes={customTypes}
                      value={fieldValues[def.name]}
                      busy={busy}
                      uploading={uploadingField === def.name}
                      onChange={(value) =>
                        setFieldValues((prev) => ({
                          ...prev,
                          [def.name]: value,
                        }))
                      }
                      onFile={(file) => void uploadFile(def.name, file)}
                    />
                  ))}
              </div>
            )}
          {!currentTemplate && (
            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground">
                {mode === "update"
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
            <Button type="submit" disabled={busy || dataLoading} aria-busy={busy}>
              {t("wa.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={busy}
            >
              {t("wa.cancel")}
            </Button>
          </div>
        </>
      )}
    </form>
  );
};

export default ContainerForm;
