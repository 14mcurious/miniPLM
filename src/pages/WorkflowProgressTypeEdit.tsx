import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import {
  CustomType,
  CustomTypeOption,
  Role,
  RoleList,
  WorkflowTransition,
} from "@/lib/types";
import CustomTypeFormFields from "@/pages/config/CustomTypeFormFields";
import WorkflowEditor, { RoleListRef } from "@/pages/config/WorkflowEditor";

const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";
const LIST_ROUTE = "/administration/configuration/workflow/progress-types";

/**
 * Dedicated page for creating a new workflow progress type or editing an
 * existing one. Reached from the progress types list page.
 */
const WorkflowProgressTypeEdit = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { typeId } = useParams<{ typeId: string }>();
  const typeToEdit = typeId ? Number(typeId) : null;
  const isCreate = typeToEdit === null;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [valueType, setValueType] = useState("string");
  const [multiSelect, setMultiSelect] = useState(false);
  const [options, setOptions] = useState<CustomTypeOption[]>([]);
  const [initialState, setInitialState] = useState<string>("");
  const [transitions, setTransitions] = useState<WorkflowTransition[]>([]);
  const [roleListId, setRoleListId] = useState<number | null>(null);
  const [roleLists, setRoleLists] = useState<RoleListRef[]>([]);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const data = await api<{
        customTypes: CustomType[];
        roleLists: RoleList[];
        roles: Role[];
      }>(CUSTOM_TYPES_ENDPOINT);
      setRoleLists(
        (data.roleLists ?? []).map((rl) => ({
          id: rl.id,
          name: rl.name,
          members: (rl.members ?? []).map((m) => ({ id: m.id, name: m.name })),
        }))
      );
      if (isCreate) {
        setName("");
        setValueType("string");
        setMultiSelect(false);
        setOptions([{ label: "", value: "" }]);
        setInitialState("");
        setTransitions([]);
        setRoleListId(null);
        return;
      }
      const found = (data.customTypes ?? []).find((ct) => ct.id === typeToEdit);
      if (!found) {
        setNotFound(true);
        return;
      }
      setName(found.name);
      setValueType(found.valueType);
      setMultiSelect(found.multiSelect);
      setOptions(
        found.options.length
          ? found.options.map((option) => ({ ...option }))
          : [{ label: "", value: "" }]
      );
      setInitialState(found.initialState ?? "");
      // The matrix holds one entry per (from, to) pair: keep the first one.
      const seenPairs = new Set<string>();
      setTransitions(
        (Array.isArray(found.transitions) ? found.transitions : [])
          .filter((tr) => {
            const key = `${tr.from}\u2192${tr.to}`;
            if (seenPairs.has(key)) return false;
            seenPairs.add(key);
            return true;
          })
          .map((tr) => ({ ...tr }))
      );
      setRoleListId(found.roleListId ?? null);
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeToEdit, isCreate]);

  useEffect(() => {
    void load();
  }, [load]);

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
      options: options.filter((option) => option.value.trim() !== ""),
      initialState: initialState || null,
      transitions,
      roleListId,
    };
    try {
      if (isCreate) {
        payload.operation = "create";
        payload.category = "workflow";
      } else {
        payload.operation = "update";
        payload.id = typeToEdit;
      }
      await api(CUSTOM_TYPES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success(t("ct.saved"));
      navigate(LIST_ROUTE);
    } catch (err) {
      setFormError(translate(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl space-y-6">
          <div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
              {isCreate
                ? t("progressTypeEdit.newTitle")
                : t("progressTypeEdit.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("progressTypeEdit.description")}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {notFound && (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("progressTypeEdit.notFound")}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : (
            !notFound && (
              <form
                onSubmit={save}
                className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
              >
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
                {formError && (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                )}
                <div className="flex gap-3">
                  <Button type="submit" disabled={busy} aria-busy={busy}>
                    {t("configuration.save")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(LIST_ROUTE)}
                    disabled={busy}
                  >
                    {t("wa.cancel")}
                  </Button>
                </div>
              </form>
            )
          )}
        </div>
      </div>
    </>
  );
};

export default WorkflowProgressTypeEdit;
