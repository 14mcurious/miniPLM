import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./useAuth";
import ProjectSelectDialog from "@/components/ProjectSelectDialog";

/**
 * Current work area (project) selection.
 *
 * The choice is persisted per user in localStorage ("preselected" across
 * sessions) and is always validated against the work areas the user can
 * actually access: if the stored project is no longer accessible it is
 * dropped and the work area starts with no project selected.
 */

interface WorkAreaProjectContextValue {
  /** Currently selected project id (validated), or null. */
  projectId: number | null;
  /** Display name of the selected project, or null. */
  projectName: string | null;
  /** Pick the current project (persisted for the user). */
  selectProject: (projectId: number) => void;
  /** Clear the current project selection. */
  clearProject: () => void;
  /** Whether the project selection dialog is open. */
  pickerOpen: boolean;
  /** Open the project selection dialog. */
  openPicker: () => void;
  /** Close the project selection dialog. */
  closePicker: () => void;
}

const WorkAreaProjectContext =
  createContext<WorkAreaProjectContextValue | null>(null);

const STORAGE_PREFIX = "miniplm.workArea.currentProjectId.";

function storageKey(loginName: string): string {
  return `${STORAGE_PREFIX}${loginName}`;
}

function readStored(loginName: string): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey(loginName));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStored(loginName: string, projectId: number): void {
  try {
    window.localStorage.setItem(storageKey(loginName), String(projectId));
  } catch {
    // storage unavailable: the selection stays in memory only
  }
}

function removeStored(loginName: string): void {
  try {
    window.localStorage.removeItem(storageKey(loginName));
  } catch {
    // ignore
  }
}

export const WorkAreaProjectProvider = ({ children }: { children: ReactNode }) => {
  const { status, user, workAreas } = useAuth();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // (Re)validate the stored selection whenever the session or the
  // accessible work areas change; drop selections that are no longer
  // accessible so a stale id never becomes the current project.
  useEffect(() => {
    if (status !== "authenticated" || !user) {
      setProjectId(null);
      return;
    }
    const stored = readStored(user.loginName);
    const accessible =
      stored !== null && workAreas.some((area) => area.id === stored);
    if (stored !== null && !accessible) {
      removeStored(user.loginName);
    }
    setProjectId(accessible ? stored : null);
  }, [status, user, workAreas]);

  const selectProject = useCallback(
    (id: number) => {
      if (!user) return;
      if (!workAreas.some((area) => area.id === id)) return;
      setProjectId(id);
      writeStored(user.loginName, id);
    },
    [user, workAreas]
  );

  const clearProject = useCallback(() => {
    setProjectId(null);
    if (user) {
      removeStored(user.loginName);
    }
  }, [user]);

  const value = useMemo<WorkAreaProjectContextValue>(() => {
    const name =
      projectId !== null
        ? (workAreas.find((area) => area.id === projectId)?.name ?? null)
        : null;
    return {
      projectId,
      projectName: name,
      selectProject,
      clearProject,
      pickerOpen,
      openPicker: () => setPickerOpen(true),
      closePicker: () => setPickerOpen(false),
    };
  }, [projectId, workAreas, selectProject, clearProject, pickerOpen]);

  return (
    <WorkAreaProjectContext.Provider value={value}>
      {children}
      <ProjectSelectDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(id) => {
          selectProject(id);
          setPickerOpen(false);
        }}
      />
    </WorkAreaProjectContext.Provider>
  );
};

/** Read the current work area project selection (see the provider). */
export function useWorkAreaProject(): WorkAreaProjectContextValue {
  const ctx = useContext(WorkAreaProjectContext);
  if (!ctx) {
    throw new Error(
      "useWorkAreaProject must be used within WorkAreaProjectProvider"
    );
  }
  return ctx;
}
