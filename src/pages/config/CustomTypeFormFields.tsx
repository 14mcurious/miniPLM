import type { Dispatch, SetStateAction } from "react";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomTypeOption } from "@/lib/types";

interface CustomTypeFormFieldsProps {
  name: string;
  setName: (value: string) => void;
  valueType: string;
  setValueType: (value: string) => void;
  multiSelect: boolean;
  setMultiSelect: (value: boolean) => void;
  options: CustomTypeOption[];
  setOptions: Dispatch<SetStateAction<CustomTypeOption[]>>;
  busy: boolean;
}

/**
 * Shared basic fields of the custom-type form: name, base value type,
 * multi-select flag and the enumerated options editor. Used by both the
 * inline manager form and the dedicated progress-type edit page.
 */
const CustomTypeFormFields = ({
  name,
  setName,
  valueType,
  setValueType,
  multiSelect,
  setMultiSelect,
  options,
  setOptions,
  busy,
}: CustomTypeFormFieldsProps) => {
  const { t } = useI18n();
  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  return (
    <div className="space-y-4">
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
    </div>
  );
};

export default CustomTypeFormFields;
