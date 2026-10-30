import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "./useAuth";
import ProjectSelectDialog from "@/components/ProjectSelectDialog";

/**
 * Current work area (project) selection.
 *
 * The choice is persisted per user in localStorage ("preselected" across
 * sessions) and is always validated against the work areas the user can
 * actually access: if the stored project is no longer accessible it is
 * dropped and the work area starts with no project selected.
 *
 * The project picker dialog is rendered by {@link ProjectPickerHost},
 * which lives inside the router so a confirmed selection can navigate to
 * the selected project's work area from any page.
 */

interface WorkAreaProjectContextValue {
  /** Currently selected project id (validated), or null. */
  projectId: number | null;
  /** Display name of the selected project, or null. */
  projectName: string | null;
  /**
   * Pick the current project (persisted for the user). Resolves to true
   * when the selection was applied, false when the project is not
   * accessible (the auth snapshot is re-checked live before deciding).
   */
  selectProject: (projectId: number) => Promise<boolean>;
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
  const { status, user, workAreas, refreshWorkAreas } = useAuth();
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
    async (id: number): Promise<boolean> => {
      if (!user) return false;
      if (!workAreas.some((area) => area.id === id)) {
        // The picker dialog lists the LIVE work areas while the auth
        // context keeps the login-time snapshot: permissions may have
        // changed since login, so re-check against the server before
        // dropping a selection the user just confirmed (a silent drop
        // would look like the choice "did nothing").
        const fresh = await refreshWorkAreas();
        if (!fresh.some((area) => area.id === id)) return false;
      }
      setProjectId(id);
      writeStored(user.loginName, id);
      return true;
    },
    [user, workAreas, refreshWorkAreas]
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

/**
 * Host for the project picker dialog.
 *
 * It is mounted inside the router (the context provider itself sits
 * outside it) so that after a confirmed selection the app navigates to
 * the selected project's work area search page. Without that navigation
 * the confirmed choice would only update the persisted selection and the
 * visible page would keep showing the project the user was on before —
 * the picker would appear to do nothing.
 */
export const ProjectPickerHost = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pickerOpen, closePicker, selectProject } = useWorkAreaProject();

  const handleConfirm = async (id: number) => {
    const applied = await selectProject(id);
    closePicker();
    if (applied) {
      navigate(`/work-area/${id}/search`, { replace: true });
    } else {
      toast.error(t("wa.projectPicker.notAccessible"));
    }
  };

  return (
    <ProjectSelectDialog
      open={pickerOpen}
      onClose={closePicker}
      onConfirm={(id) => {
        void handleConfirm(id);
      }}
    />
  );
};
