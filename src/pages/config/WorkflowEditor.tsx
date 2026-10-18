import { useI18n } from "@/i18n";
import { CustomTypeOption, WorkflowTransition } from "@/lib/types";

export interface RoleListRef {
  id: number;
  name: string;
  members: { id: number; name: string }[];
}

interface WorkflowEditorProps {
  options: CustomTypeOption[];
  initialState: string;
  setInitialState: (value: string) => void;
  transitions: WorkflowTransition[];
  setTransitions: (value: WorkflowTransition[]) => void;
  roleListId: number | null;
  setRoleListId: (value: number | null) => void;
  roleLists: RoleListRef[];
  busy: boolean;
}

/**
 * Workflow-specific editor: initial state selector and the state transition
 * matrix (from-state rows x to-state columns, optional role per cell).
 */
const WorkflowEditor = ({
  options,
  initialState,
  setInitialState,
  transitions,
  setTransitions,
  roleListId,
  setRoleListId,
  roleLists,
  busy,
}: WorkflowEditorProps) => {
  const { t } = useI18n();
  const stateValues = options
    .map((option) => option.value.trim())
    .filter((value) => value !== "");

  const selectedList = roleLists.find((rl) => rl.id === roleListId) ?? null;

  const cell = (from: string, to: string) =>
    transitions.find((tr) => tr.from === from && tr.to === to) ?? null;

  /** Check/uncheck a matrix cell: one transition per (from, to) pair. */
  const setCell = (from: string, to: string, checked: boolean) => {
    const rest = transitions.filter(
      (tr) => !(tr.from === from && tr.to === to)
    );
    if (!checked) {
      setTransitions(rest);
      return;
    }
    setTransitions([...rest, { from, to, role: null }]);
  };

  const setCellRole = (from: string, to: string, role: string) => {
    setTransitions(
      transitions.map((tr) =>
        tr.from === from && tr.to === to ? { ...tr, role: role || null } : tr
      )
    );
  };

  /** Role list switch: drop role restrictions the new list does not contain. */
  const changeRoleList = (value: string) => {
    const nextId = value ? Number(value) : null;
    const nextList = roleLists.find((rl) => rl.id === nextId) ?? null;
    const validNames = new Set(
      (nextList?.members ?? []).map((m) => m.name)
    );
    setTransitions(
      transitions.map((tr) =>
        tr.role && !validNames.has(tr.role) ? { ...tr, role: null } : tr
      )
    );
    setRoleListId(nextId);
  };

  const selectClass =
    "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="space-y-4 border-t pt-4">
      <h3 className="text-base font-semibold text-foreground">
        {t("ct.workflowStates")}
      </h3>
      <div>
        <label
          htmlFor="ct-initial-state"
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("ct.workflowInitialState")}
        </label>
        <select
          id="ct-initial-state"
          name="ctInitialState"
          value={initialState}
          onChange={(e) => setInitialState(e.target.value)}
          disabled={busy}
          className={selectClass}
        >
          <option value="">{t("ct.workflowInitialStateNone")}</option>
          {stateValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("ct.workflowInitialStateHint")}
        </p>
      </div>

      <div>
        <label
          htmlFor="ct-role-list"
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("ct.roleList")}
        </label>
        <select
          id="ct-role-list"
          name="ctRoleList"
          value={roleListId ?? ""}
          onChange={(e) => changeRoleList(e.target.value)}
          disabled={busy}
          className={selectClass}
        >
          <option value="">— {t("ct.roleAny")} —</option>
          {roleLists.map((rl) => (
            <option key={rl.id} value={rl.id}>
              {rl.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("ct.roleListHint")}
        </p>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">
          {t("ct.workflowTransitions")}
        </span>
        <p className="text-xs text-muted-foreground">
          {t("ct.matrixHint")}
        </p>

        {stateValues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("ct.workflowNoTransitions")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-input">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th
                    scope="col"
                    className="min-w-36 px-2 py-2 align-bottom text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    <span className="block text-left">
                      {t("ct.matrixFrom")}
                    </span>
                    <span className="block text-right">
                      {t("ct.matrixTo")}
                    </span>
                  </th>
                  {stateValues.map((to) => (
                    <th
                      key={to}
                      scope="col"
                      className="min-w-36 px-2 py-2 text-left text-xs font-medium text-foreground"
                    >
                      {to}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stateValues.map((from, row) => (
                  <tr
                    key={from}
                    className="border-b align-top last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="px-2 py-2 text-left text-xs font-medium text-foreground"
                    >
                      {from}
                    </th>
                    {stateValues.map((to, col) => {
                      const tr = cell(from, to);
                      return (
                        <td key={to} className="px-1.5 py-1.5">
                          <div className="flex flex-col gap-1">
                            <input
                              type="checkbox"
                              id={`ct-matrix-${row}-${col}`}
                              name={`ctMatrix${row}${col}`}
                              aria-label={t("ct.matrixCell", { from, to })}
                              checked={Boolean(tr)}
                              onChange={(e) =>
                                setCell(from, to, e.target.checked)
                              }
                              disabled={busy}
                              className="h-4 w-4 rounded border-input"
                            />
                            <select
                              id={`ct-matrix-role-${row}-${col}`}
                              name={`ctMatrixRole${row}${col}`}
                              aria-label={t("ct.matrixCellRole", { from, to })}
                              value={tr?.role ?? ""}
                              onChange={(e) =>
                                setCellRole(from, to, e.target.value)
                              }
                              disabled={busy || !tr || !selectedList}
                              className="h-7 w-32 rounded border border-input bg-background px-1 text-xs text-foreground"
                            >
                              <option value="">{t("ct.roleAny")}</option>
                              {(selectedList?.members ?? []).map((m) => (
                                <option key={m.id} value={m.name}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowEditor;
