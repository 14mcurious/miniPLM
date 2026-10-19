import type { ProgressOption, ProgressWorkflow } from "@/lib/types";

/**
 * Progress workflow helpers (mirror of the backend transition rules).
 *
 * Modes: C = create, R = read, U = update, D = delete.
 *
 * A progress field follows the rules of its definition:
 *  - on create, when the workflow defines transitions, the object starts
 *    from its initial state (or the progress stays empty);
 *  - on update, only the states reachable from the current state by an
 *    allowed transition are offered; a transition with a role is only
 *    usable by users holding that role (null role = any user).
 *
 * The progress field shows each state's value; hovering reveals the
 * state's label. The backend re-checks every rule, this only drives
 * what the UI offers.
 */

export function allowedProgressOptions(
  workflow: ProgressWorkflow | null | undefined,
  userRoles: string[] | null | undefined,
  currentValue: string | null | undefined,
  mode: "create" | "update"
): ProgressOption[] {
  if (!workflow || !Array.isArray(workflow.options) || workflow.options.length === 0) {
    return []; // no workflow type: free-text progress
  }
  const options = workflow.options;
  const roles = new Set((userRoles ?? []).map((role) => String(role)));
  const transitions = Array.isArray(workflow.transitions) ? workflow.transitions : [];
  const byValue = new Map(options.map((option) => [option.value, option]));
  const value = (currentValue ?? "").trim();

  if (mode === "create") {
    if (transitions.length === 0) {
      return options;
    }
    const initial = workflow.initialState ? byValue.get(workflow.initialState) : undefined;
    return initial ? [initial] : options;
  }

  // Update: the current value is always kept (selecting it again is a
  // no-op), plus the states reachable by the user's allowed transitions.
  if (transitions.length === 0) {
    return value && !byValue.has(value)
      ? [...options, { label: value, value }]
      : options;
  }
  if (byValue.has(value)) {
    const result: ProgressOption[] = [byValue.get(value)!];
    const seen = new Set([value]);
    for (const transition of transitions) {
      if (transition.from !== value) continue;
      if (transition.role && !roles.has(transition.role)) continue;
      const target = byValue.get(transition.to);
      if (target && !seen.has(target.value)) {
        seen.add(target.value);
        result.push(target);
      }
    }
    return result;
  }
  // Empty or legacy current value (not a workflow option): the first
  // assignment must target the initial state when one is defined.
  if (workflow.initialState) {
    const initial = byValue.get(workflow.initialState);
    return initial ? [initial] : options;
  }
  return value
    ? [...options, { label: value, value }]
    : options;
}

/** Label of a progress value (shown on hover), or "". */
export function progressLabel(
  workflow: ProgressWorkflow | null | undefined,
  value: string | null | undefined
): string {
  if (!workflow || !value) return "";
  const option = workflow.options.find((item) => item.value === value);
  return option?.label ?? "";
}
