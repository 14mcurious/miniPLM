import { useI18n } from "@/i18n";
import { Input } from "@/components/ui/input";
import type { AttachmentValue, CustomType, FieldDef } from "@/lib/types";
import { downloadAttachment } from "@/lib/work-instance-form";
import type { FieldEditorProps } from "@/lib/work-instance-form";

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

export default FieldEditor;
