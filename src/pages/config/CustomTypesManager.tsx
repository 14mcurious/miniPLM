import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomType, CustomTypeOption } from "@/lib/types";

const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";

interface Props {
  /** "standard" or "workflow" (progress types). */
  category: "standard" | "workflow";
}

/**
 * Admin manager for custom types of one category (standard types used by
 * work instance fields; workflow types used for progress). Options are the
 * enumerated values of the type (label + value), validated by the backend
 * against the declared base type (number/date/string).
 */
const CustomTypesManager = ({ category }: Props) => {
  const { t } = useI18n();
  const [types, setTypes] = useState<CustomType[]>([]);
  const [progressType, setProgressType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<null | CustomType>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [valueType, setValueType] = useState("string");
  const [multiSelect, setMultiSelect] = useState(false);
  const [options, setOptions] = useState<CustomTypeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        customTypes: CustomType[];
        workflowProgressType: string | null;
      }>(CUSTOM_TYPES_ENDPOINT);
      setTypes(
        (data.customTypes ?? []).filter(
          (type) => type.category === category
        )
      );
      if (category === "workflow") {
        setProgressType(data.workflowProgressType ?? null);
      }
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setName("");
    setValueType("string");
    setMultiSelect(false);
    setOptions([{ label: "", value: "" }]);
    setFormError(null);
  };

  const openEdit = (type: CustomType) => {
    setEditing(type);
    setCreating(false);
    setName(type.name);
    setValueType(type.valueType);
    setMultiSelect(type.multiSelect);
    setOptions(
      type.options.length
        ? type.options.map((option) => ({ ...option }))
        : [{ label: "", value: "" }]
    );
    setFormError(null);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setFormError(t("ct.error.nameRequired"));
      return;
    }
    setBusy(true);
    setFormError(null);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      valueType,
      multiSelect,
      options: options.filter(
        (option) => option.value.trim() !== ""
      ),
    };
    try {
      if (creating) {
        payload.operation = "create";
        payload.category = category;
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        payload.operation = "update";
        payload.id = editing?.id;
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      toast.success(t("ct.saved"));
      closeForm();
      await load();
    } catch (err) {
      setFormError(translate(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleDisabled = async (type: CustomType) => {
    try {
      await api(CUSTOM_TYPES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "update",
          id: type.id,
          isDisabled: !type.isDisabled,
        }),
      });
      await load();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  const remove = async (type: CustomType) => {
    if (!window.confirm(t("ct.deleteConfirm", { name: type.name }))) {
      return;
    }
    try {
      await api(CUSTOM_TYPES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "delete", id: type.id }),
      });
      toast.success(t("ct.deleted"));
      await load();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  const saveProgressType = async (selected: string) => {
    setBusy(true);
    try {
      await api(CUSTOM_TYPES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "set-progress-type",
          name: selected,
        }),
      });
      toast.success(t("ct.progressTypeSaved"));
      setProgressType(selected || null);
    } catch (err) {
      toast.error(translate(err));
    } finally {
      setBusy(false);
    }
  };

  const labelClass = "mb-1 block text-sm font-medium text-foreground";
  const shown = types;

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-foreground">
          {category === "workflow"
            ? t("ct.workflowTitle")
            : t("ct.standardTitle")}
        </h2>
        <Button size="sm" onClick={openCreate} disabled={busy}>
          {t("ct.new")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {category === "workflow"
          ? t("ct.workflowHint")
          : t("ct.standardHint")}
      </p>

      {category === "workflow" && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
          <div>
            <label
              htmlFor="progress-type"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              {t("ct.progressType")}
            </label>
            <select
              id="progress-type"
              name="progressType"
              value={progressType ?? ""}
              onChange={(e) => void saveProgressType(e.target.value)}
              disabled={busy}
              className="h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">{t("ct.progressTypeNone")}</option>
              {types
                .filter((type) => !type.isDisabled)
                .map((type) => (
                  <option key={type.id} value={type.name}>
                    {type.name}
                  </option>
                ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("ct.progressTypeHint")}
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {(creating || editing) && (
        <form
          onSubmit={save}
          className="space-y-4 rounded-md border p-4"
        >
          <h3 className="text-base font-semibold text-foreground">
            {creating ? t("ct.newTitle") : t("ct.editTitle")}
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="ct-name" className={labelClass}>
                {t("ct.name")}
              </label>
              <Input
                id="ct-name"
                name="ctName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label htmlFor="ct-value-type" className={labelClass}>
                {t("ct.valueType")}
              </label>
              <select
                id="ct-value-type"
                name="ctValueType"
                value={valueType}
                onChange={(e) => setValueType(e.target.value)}
                disabled={busy}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="string">{t("ct.valueTypeString")}</option>
                <option value="number">{t("ct.valueTypeNumber")}</option>
                <option value="date">{t("ct.valueTypeDate")}</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  id="ct-multi-select"
                  name="ctMultiSelect"
                  checked={multiSelect}
                  onChange={(e) => setMultiSelect(e.target.checked)}
                  disabled={busy}
                  className="h-4 w-4 rounded border-input"
                />
                {t("ct.multiSelect")}
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">
              {t("ct.options")}
            </span>
            {options.map((option, index) => (
              <div
                key={index}
                className="flex items-center gap-2"
              >
                <div className="flex flex-col gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    aria-label={t("ct.moveUp")}
                    title={t("ct.moveUp")}
                    onClick={() =>
                      setOptions((prev) => {
                        if (index <= 0) return prev;
                        const next = [...prev];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        return next;
                      })
                    }
                    disabled={busy || index === 0}
                    className="h-7 w-8 px-0"
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    aria-label={t("ct.moveDown")}
                    title={t("ct.moveDown")}
                    onClick={() =>
                      setOptions((prev) => {
                        if (index >= prev.length - 1) return prev;
                        const next = [...prev];
                        [next[index + 1], next[index]] = [
                          next[index],
                          next[index + 1],
                        ];
                        return next;
                      })
                    }
                    disabled={busy || index === options.length - 1}
                    className="h-7 w-8 px-0"
                  >
                    ↓
                  </Button>
                </div>
                <Input
                  id={`ct-option-value-${index}`}
                  name={`ctOptionValue${index}`}
                  placeholder={t("ct.optionValue")}
                  value={option.value}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((item, i) =>
                        i === index ? { ...item, value: e.target.value } : item
                      )
                    )
                  }
                  disabled={busy}
                />
                <Input
                  id={`ct-option-label-${index}`}
                  name={`ctOptionLabel${index}`}
                  placeholder={t("ct.optionLabel")}
                  value={option.label}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((item, i) =>
                        i === index ? { ...item, label: e.target.value } : item
                      )
                    )
                  }
                  disabled={busy}
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    setOptions((prev) => prev.filter((_, i) => i !== index))
                  }
                  disabled={busy || options.length <= 1}
                >
                  {t("wa.remove")}
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() =>
                setOptions((prev) => [...prev, { label: "", value: "" }])
              }
              disabled={busy}
            >
              {t("ct.addOption")}
            </Button>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {t("configuration.save")}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm}>
              {t("wa.cancel")}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
      ) : shown.length === 0 && !creating && !editing ? (
        <p className="text-sm text-muted-foreground">{t("ct.empty")}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2">{t("ct.name")}</th>
              <th className="px-2 py-2">{t("ct.valueType")}</th>
              <th className="px-2 py-2">{t("ct.select")}</th>
              <th className="px-2 py-2">{t("ct.optionsCount")}</th>
              <th className="px-2 py-2">{t("ct.status")}</th>
              <th className="px-2 py-2" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((type) => (
              <tr key={type.id} className="border-b hover:bg-muted/40">
                <td className="px-2 py-2 font-medium text-foreground">
                  {type.name}
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {t(
                    `ct.valueType${
                      { string: "String", number: "Number", date: "Date" }[
                        type.valueType
                      ] ?? "String"
                    }`
                  )}
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {type.multiSelect ? t("ct.multi") : t("ct.single")}
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {type.options.length}
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {type.isDisabled ? t("ct.disabled") : t("ct.enabled")}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(type)}
                    >
                      {t("wa.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void toggleDisabled(type)}
                    >
                      {type.isDisabled ? t("ct.enable") : t("ct.disable")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void remove(type)}
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
  );
};

export default CustomTypesManager;
