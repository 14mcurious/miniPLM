import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CustomType,
  FieldDef,
  InstanceTemplate,
} from "@/lib/types";

const TEMPLATES_ENDPOINT = "/api/my/v1/templates";
const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";

const ALL_TYPES = ["number", "date", "string", "attachment", "html", "xml", "custom"];

/**
 * Work instance templates of a work area: JSON definitions of the fields a
 * work instance can carry (name, type, description, referenced custom
 * type). Instances created from a template get exactly these fields.
 */
const WorkAreaTemplates = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();

  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formMode, setFormMode] = useState<
    null | { mode: "create" } | { mode: "update"; id: number }
  >(null);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([]);
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
      const [templatesData, customTypesData] = await Promise.all([
        api<{ templates: InstanceTemplate[] }>(TEMPLATES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "list",
            projectId: Number(projectId),
          }),
        }),
        api<{ customTypes: CustomType[] }>(CUSTOM_TYPES_ENDPOINT),
      ]);
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
    if (status === "authenticated") {
      void load();
    }
  }, [status, load]);

  const openCreate = () => {
    setFormMode({ mode: "create" });
    setName("");
    setFields([]);
    setFormError(null);
  };

  const openUpdate = (template: InstanceTemplate) => {
    setFormMode({ mode: "update", id: template.id });
    setName(template.name);
    setFields(
      template.definition.map((def) => ({
        name: def.name,
        type: def.type,
        description: def.description ?? "",
        customType: def.customType ?? null,
      }))
    );
    setFormError(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setFormError(null);
  };

  const updateField = (
    index: number,
    patch: Partial<FieldDef>
  ): void => {
    setFields((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const handleDelete = async (template: InstanceTemplate) => {
    if (!window.confirm(t("wa.deleteTemplateConfirm", { name: template.name }))) {
      return;
    }
    try {
      await api(TEMPLATES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "delete", id: template.id }),
      });
      toast.success(t("wa.templateDeleted"));
      await load();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  return (
    <>
      <BackLink
        to={`/work-area/${projectId}`}
        label={`${t("workArea.title")} — ${t("wa.templates")}`}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-4xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t("wa.templates")}
            </h1>
            <Button onClick={openCreate} disabled={busy}>
              {t("wa.newTemplate")}
            </Button>
          </div>
          <p className="mb-6 text-sm text-muted-foreground">
            {t("wa.templatesHint")}
          </p>

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
              className="mb-8 space-y-4 rounded-lg border bg-card p-5 shadow-sm"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                if (!name.trim()) {
                  setFormError(t("wa.error.nameRequired"));
                  return;
                }
                if (fields.length === 0) {
                  setFormError(t("wa.error.fieldsRequired"));
                  return;
                }
                if (fields.some((field) => !field.name.trim())) {
                  setFormError(t("wa.error.fieldNameRequired"));
                  return;
                }
                setBusy(true);
                setFormError(null);
                try {
                  const payload: Record<string, unknown> = {
                    name: name.trim(),
                    definition: fields.map((field) => ({
                      name: field.name.trim(),
                      type: field.type,
                      description: field.description ?? "",
                      customType:
                        field.type === "custom" ? field.customType ?? null : null,
                    })),
                  };
                  if (formMode.mode === "create") {
                    payload.operation = "create";
                    payload.projectId = Number(projectId);
                  } else {
                    payload.operation = "update";
                    payload.id = formMode.id;
                  }
                  await api(TEMPLATES_ENDPOINT, {
                    method: "POST",
                    body: JSON.stringify(payload),
                  });
                  toast.success(t("wa.templateSaved"));
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
                  ? t("wa.newTemplateTitle")
                  : t("wa.editTemplateTitle")}
              </h2>
              <div>
                <label htmlFor="template-name" className={labelClass}>
                  {t("wa.name")}
                </label>
                <Input
                  id="template-name"
                  name="templateName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div
                    key={index}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_130px_1fr_auto]"
                  >
                    <Input
                      id={`tpl-field-name-${index}`}
                      name={`tplFieldName${index}`}
                      placeholder={t("wa.fieldName")}
                      value={field.name}
                      onChange={(e) => updateField(index, { name: e.target.value })}
                      disabled={busy}
                    />
                    <select
                      id={`tpl-field-type-${index}`}
                      name={`tplFieldType${index}`}
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value })}
                      disabled={busy}
                      className="h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground"
                    >
                      {ALL_TYPES.map((typeValue) => (
                        <option key={typeValue} value={typeValue}>
                          {t(`fieldType.${typeValue}`)}
                        </option>
                      ))}
                    </select>
                    {field.type === "custom" ? (
                      <select
                        id={`tpl-field-custom-${index}`}
                        name={`tplFieldCustomType${index}`}
                        value={field.customType ?? ""}
                        onChange={(e) =>
                          updateField(index, { customType: e.target.value || null })
                        }
                        disabled={busy}
                        className="h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground"
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
                      <Input
                        id={`tpl-field-desc-${index}`}
                        name={`tplFieldDescription${index}`}
                        placeholder={t("wa.fieldDescription")}
                        value={field.description ?? ""}
                        onChange={(e) =>
                          updateField(index, { description: e.target.value })
                        }
                        disabled={busy}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() =>
                        setFields((prev) => prev.filter((_, i) => i !== index))
                      }
                      disabled={busy}
                    >
                      {t("wa.remove")}
                    </Button>
                    {field.type === "custom" && (
                      <div className="sm:col-span-4">
                        <Input
                          id={`tpl-field-custom-desc-${index}`}
                          name={`tplFieldCustomDescription${index}`}
                          placeholder={t("wa.fieldDescription")}
                          value={field.description ?? ""}
                          onChange={(e) =>
                            updateField(index, { description: e.target.value })
                          }
                          disabled={busy}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setFields((prev) => [
                      ...prev,
                      { name: "", type: "string", description: "", customType: null },
                    ])
                  }
                >
                  {t("wa.addField")}
                </Button>
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
          ) : templates.length === 0 && !formMode ? (
            <p className="text-sm text-muted-foreground">{t("wa.emptyTemplates")}</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2">{t("wa.name")}</th>
                  <th className="px-2 py-2">{t("wa.fields")}</th>
                  <th className="px-2 py-2">{t("wa.usedBy")}</th>
                  <th className="px-2 py-2">{t("wa.updated")}</th>
                  <th className="px-2 py-2" aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id} className="border-b hover:bg-muted/40">
                    <td className="px-2 py-2 font-medium text-foreground">
                      {template.name}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {template.definition
                        .map((def) => def.name)
                        .join(", ") || "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {template.usedByCount}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {template.updatedAt
                        ? new Date(template.updatedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openUpdate(template)}
                        >
                          {t("wa.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleDelete(template)}
                          disabled={template.usedByCount > 0}
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

export default WorkAreaTemplates;
