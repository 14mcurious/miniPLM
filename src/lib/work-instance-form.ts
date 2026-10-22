import { api } from "@/lib/api";
import type {
  AttachmentValue,
  CustomType,
  FieldDef,
  InstanceTemplate,
  WorkInstanceField,
} from "@/lib/types";

export const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";
export const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
export const TEMPLATES_ENDPOINT = "/api/my/v1/templates";
export const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";
export const ATTACHMENTS_ENDPOINT = "/api/my/v1/attachments";
export const MAX_UPLOAD = 5 * 1024 * 1024;

/** Field types available for ad-hoc fields (no attachment: those need a template). */
export const AD_HOC_TYPES = [
  "number",
  "date",
  "string",
  "html",
  "md",
  "xml",
  "custom",
];

export interface FormState {
  mode: "create" | "update";
  id?: number;
  title: string;
  workContainerId: string;
  templateId: string;
  progress: string;
  assigneeIds: number[];
  /** field name -> raw input value (strings; attachments kept as object). */
  fieldValues: Record<string, unknown>;
  /** ad-hoc fields (no template): [{name, type, customType, value}] */
  adHoc: { name: string; type: string; customType: string; value: string }[];
}

export const emptyForm = (): FormState => ({
  mode: "create",
  title: "",
  workContainerId: "",
  templateId: "",
  progress: "",
  assigneeIds: [],
  fieldValues: {},
  adHoc: [],
});

/** Convert a stored field value to the form representation. */
export function toFormValue(field: WorkInstanceField): unknown {
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

/** Convert a raw form value into the stored value for the given field type. */
export function coerceFieldValue(
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

export function fileToBase64(file: File): Promise<string> {
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

export async function downloadAttachment(s3Key: string): Promise<void> {
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

export interface FieldEditorProps {
  def: FieldDef;
  customTypes: CustomType[];
  value: unknown;
  busy: boolean;
  uploading: boolean;
  onChange: (value: unknown) => void;
  onFile: (file: File) => void;
}

/**
 * Builds the fields payload from the form state, using either the selected
 * template definition or the ad-hoc fields.
 */
export function buildFieldPayload(
  state: FormState,
  currentTemplate: InstanceTemplate | null,
  t: (key: string, params?: Record<string, string | number>) => string
): { fields: unknown[]; error: string | null } {
  if (currentTemplate) {
    const fields: unknown[] = currentTemplate.definition
      .filter((def) => def.type !== "progress")
      .map((def) => ({
        name: def.name,
        value: coerceFieldValue(
          def.type,
          state.fieldValues[def.name],
          def.customType ?? null
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
}

export const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";
