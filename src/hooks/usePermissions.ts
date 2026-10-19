import { useMemo } from "react";
import { useAuth } from "./useAuth";

export type AccessMode = "C" | "R" | "U" | "D";

/**
 * Per-project access modes of the current user, derived from the work
 * areas returned by the login / `me` endpoint (the union of the modes of
 * the user's enabled groups).
 *
 * Modes: C = create, R = read, U = update (edit), D = delete.
 *
 * The hook is the single source of truth for mirroring the real
 * permissions in the UI: create buttons need "C", edit buttons "U",
 * delete buttons "D". Reading is always possible for the projects the
 * user can access (they are listed in the work areas).
 */
export function useProjectModes(
  projectId: string | number | null | undefined
): { modes: string; can: (mode: AccessMode) => boolean } {
  const { workAreas } = useAuth();
  const modes = useMemo(() => {
    if (projectId === null || projectId === undefined || projectId === "") {
      return "";
    }
    const area = workAreas.find((item) => String(item.id) === String(projectId));
    return area?.modes ?? "";
  }, [workAreas, projectId]);
  const can = (mode: AccessMode) => modes.includes(mode);
  return { modes, can };
}
