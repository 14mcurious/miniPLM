import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CustomType, CustomTypeOption, WorkflowTransition, Role, RoleList } from "@/lib/types";
import WorkflowEditor, { RoleListRef } from "@/pages/config/WorkflowEditor";
import CustomTypeFormFields from "@/pages/config/CustomTypeFormFields";

const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";

const VALUE_TYPES = new Set(["string", "number", "date"]);

interface Props {
  /** "standard" or "workflow" (progress types). */
  category: "standard" | "workflow";
  /**
   * When provided, "New" and "Edit" navigate to dedicated pages instead of
   * opening the inline form (used by the workflow progress types page).
   */
  editorRoutes?: { new: string; edit: (id: number) => string };
}

/**
 * Admin manager for custom types of one category (standard types used by
 * work instance fields; workflow types used for progress). Options are the
 * enumerated values of the type (label + value), validated by the backend
 * against the declared base type (number/date/string).
 */
const CustomTypesManager = ({ category, editorRoutes }: Props) => {
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
  const [initialState, setInitialState] = useState<string>("");
  const [transitions, setTransitions] = useState<WorkflowTransition[]>([]);
  const [roleListId, setRoleListId] = useState<number | null>(null);
  const [roleLists, setRoleLists] = useState<RoleListRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
        roles: Role[];
        roleLists: RoleList[];
      }>(CUSTOM_TYPES_ENDPOINT);
      setTypes(
        (data.customTypes ?? []).filter(
          (type) => type.category === category
        )
      );
      if (category === "workflow") {
        setProgressType(data.workflowProgressType ?? null);
        setRoleLists(
          (data.roleLists ?? []).map((rl) => ({
            id: rl.id,
            name: rl.name,
            members: (rl.members ?? []).map((m) => ({ id: m.id, name: m.name })),
          }))
        );
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
    setInitialState("");
    setTransitions([]);
    setRoleListId(null);
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
    setInitialState(type.initialState ?? "");
    // The matrix holds one entry per (from, to) pair: keep the first one.
    const seenPairs = new Set<string>();
    setTransitions(
      (Array.isArray(type.transitions) ? type.transitions : [])
        .filter((tr) => {
          const key = `${tr.from}\u2192${tr.to}`;
          if (seenPairs.has(key)) return false;
          seenPairs.add(key);
          return true;
        })
        .map((tr) => ({ ...tr }))
    );
    setRoleListId(type.roleListId ?? null);
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
    if (category === "workflow") {
      payload.initialState = initialState || null;
      payload.transitions = transitions;
      payload.roleListId = roleListId;
    }
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

  /** Export a single workflow progress type as a downloadable JSON file. */
  const exportProgressType = (type: CustomType) => {
    const payload = {
      app: "miniplm",
      resource: "progress-type",
      exportedAt: new Date().toISOString(),
      progressType: {
        id: type.id,
        name: type.name,
        valueType: type.valueType,
        multiSelect: type.multiSelect,
        options: (type.options ?? []).map((o) => ({ ...o })),
        initialState: type.initialState ?? null,
        transitions: (type.transitions ?? []).map((tr) => ({ ...tr })),
        roleList: type.roleListName ? { name: type.roleListName } : null,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const slug = type.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    anchor.download = `miniplm-progress-type-${slug || type.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  /**
   * Import a single workflow progress type from a JSON file (the exported
   * format, or a plain object). The type is matched by name
   * (case-insensitive): created when missing, updated when present. The
   * optional role list is resolved by name against the existing lists.
   */
  const importProgressType = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm(t("ct.importProgressTypeConfirm"))) return;
    setImporting(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        toast.error(t("ct.importProgressTypeInvalid"));
        return;
      }
      const src =
        parsed &&
        typeof parsed === "object" &&
        (parsed as { progressType?: unknown }).progressType !== undefined
          ? (parsed as { progressType: unknown }).progressType
          : parsed;
      if (!src || typeof src !== "object") {
        toast.error(t("ct.importProgressTypeInvalid"));
        return;
      }
      const it = src as {
        name?: unknown;
        valueType?: unknown;
        multiSelect?: unknown;
        options?: unknown;
        initialState?: unknown;
        transitions?: unknown;
        roleList?: unknown;
      };
      const name = typeof it.name === "string" ? it.name.trim() : "";
      const TYPE_NAME_RE = /^[A-Za-z][A-Za-z0-9 ]{0,79}$/;
      const valueType =
        typeof it.valueType === "string"
          ? it.valueType.trim().toLowerCase()
          : "string";
      if (
        !name ||
        !TYPE_NAME_RE.test(name) ||
        !VALUE_TYPES.has(valueType) ||
        !Array.isArray(it.options) ||
        it.options.length === 0
      ) {
        toast.error(t("ct.importProgressTypeInvalid"));
        return;
      }
      const options = it.options.map((o) => {
        const opt = (o ?? {}) as { value?: unknown; label?: unknown };
        return {
          value: typeof opt.value === "string" ? opt.value.trim() : "",
          label:
            typeof opt.label === "string" && opt.label.trim() !== ""
              ? opt.label.trim()
              : typeof opt.value === "string"
                ? opt.value.trim()
                : "",
        };
      });
      if (options.some((o) => o.value === "")) {
        toast.error(t("ct.importProgressTypeInvalid"));
        return;
      }
      const optionValues = new Set(options.map((o) => o.value));
      const initialStateRaw = it.initialState;
      const initialState =
        typeof initialStateRaw === "string" && initialStateRaw.trim() !== ""
          ? initialStateRaw.trim()
          : null;
      if (initialState !== null && !optionValues.has(initialState)) {
        toast.error(t("ct.importProgressTypeInvalid"));
        return;
      }
      // Resolve the optional role list by name.
      let roleListId: number | null = null;
      if (it.roleList !== undefined && it.roleList !== null) {
        const rlName =
          typeof it.roleList === "string"
            ? it.roleList.trim()
            : it.roleList &&
                typeof it.roleList === "object" &&
                typeof (it.roleList as { name?: unknown }).name === "string"
              ? ((it.roleList as { name: string }).name).trim()
              : "";
        const match = roleLists.find(
          (rl) => rl.name.toLowerCase() === rlName.toLowerCase()
        );
        if (!match) {
          toast.error(
            t("ct.importProgressTypeMissingRoleList", { name: rlName })
          );
          return;
        }
        roleListId = match.id;
      }
      // Validate transitions against option values and the list roles.
      if (!Array.isArray(it.transitions)) {
        toast.error(t("ct.importProgressTypeInvalid"));
        return;
      }
      const listRoleNames = new Set(
        roleListId !== null
          ? (roleLists.find((rl) => rl.id === roleListId)?.members ?? [])
              .map((m) => m.name)
          : []
      );
      const transitions: WorkflowTransition[] = [];
      for (const raw of it.transitions) {
        const tr = (raw ?? {}) as {
          from?: unknown;
          to?: unknown;
          role?: unknown;
        };
        const from = typeof tr.from === "string" ? tr.from.trim() : "";
        const to = typeof tr.to === "string" ? tr.to.trim() : "";
        const role =
          typeof tr.role === "string" && tr.role.trim() !== ""
            ? tr.role.trim()
            : null;
        if (!from || !to || !optionValues.has(from) || !optionValues.has(to)) {
          toast.error(t("ct.importProgressTypeInvalid"));
          return;
        }
        if (role !== null && !listRoleNames.has(role)) {
          toast.error(t("ct.importProgressTypeInvalid"));
          return;
        }
        transitions.push({ from, to, role });
      }
      const multiSelect = Boolean(it.multiSelect);
      const payload = {
        name,
        valueType,
        multiSelect,
        options,
        initialState,
        transitions,
        roleListId,
      };
      const existing = types.find(
        (ty) =>
          ty.category === "workflow" &&
          ty.name.toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "update",
            id: existing.id,
            ...payload,
          }),
        });
      } else {
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "create",
            category: "workflow",
            ...payload,
          }),
        });
      }
      toast.success(t("ct.importProgressTypeOk"));
      await load();
    } catch (err) {
      toast.error(translate(err));
    } finally {
      setImporting(false);
    }
  };

  const shown = types;

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-foreground">
          {category === "workflow"
            ? t("ct.workflowTitle")
            : t("ct.standardTitle")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {category === "workflow" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={loading || importing || busy}
            >
              {t("ct.importProgressType")}
            </Button>
          )}
          {editorRoutes ? (
            <Button asChild size="sm" disabled={busy}>
              <Link to={editorRoutes.new}>{t("ct.new")}</Link>
            </Button>
          ) : (
            <Button size="sm" onClick={openCreate} disabled={busy}>
              {t("ct.new")}
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        id="progress-type-import-file"
        name="progressTypeImportFile"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importProgressType(e)}
      />
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
          <CustomTypeFormFields
            name={name}
            setName={setName}
            valueType={valueType}
            setValueType={setValueType}
            multiSelect={multiSelect}
            setMultiSelect={setMultiSelect}
            options={options}
            setOptions={setOptions}
            busy={busy}
          />

          {category === "workflow" && (
            <WorkflowEditor
              options={options}
              initialState={initialState}
              setInitialState={setInitialState}
              transitions={transitions}
              setTransitions={setTransitions}
              roleListId={roleListId}
              setRoleListId={setRoleListId}
              roleLists={roleLists}
              busy={busy}
            />
          )}

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
                    {category === "workflow" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => exportProgressType(type)}
                      >
                        {t("ct.exportProgressType")}
                      </Button>
                    )}
                    {editorRoutes ? (
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                        disabled={busy}
                      >
                        <Link to={editorRoutes.edit(type.id)}>
                          {t("wa.edit")}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(type)}
                      >
                        {t("wa.edit")}
                      </Button>
                    )}
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
