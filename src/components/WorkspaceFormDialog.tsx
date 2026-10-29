import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Workspace } from "@/lib/types";

const WORKSPACES_ENDPOINT = "/api/my/v1/workspaces";

export interface WorkspaceFormDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  /** Create a new work space. */
  mode: "create" | "update";
  /** Parent work space id for a child creation (create mode only). */
  parentId?: number | null;
  /** Display name of the parent (create mode, for the dialog title). */
  parentName?: string | null;
  /** Work space being edited (update mode). */
  workspace?: Workspace | null;
  /** Called after a successful save. */
  onSaved: () => void;
}

/**
 * Modal form to create (root or child) or update a work space. Used by
 * the work area side panel, where a full page for such a small form
 * would be overkill.
 */
const WorkspaceFormDialog = ({
  open,
  onClose,
  projectId,
  mode,
  parentId = null,
  parentName = null,
  workspace = null,
  onSaved,
}: WorkspaceFormDialogProps) => {
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(mode === "update" && workspace ? workspace.name : "");
    setTitle(mode === "update" && workspace ? (workspace.title ?? "") : "");
    setFormError(null);
    setBusy(false);
  }, [open, mode, workspace]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const heading =
    mode === "update"
      ? t("wa.editWorkspaceTitle")
      : parentId != null && parentName
        ? t("wa.newWorkspaceChildTitle", { name: parentName })
        : t("wa.newWorkspaceTitle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setFormError(t("wa.error.nameRequired"));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (mode === "create") {
        await api(WORKSPACES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "create",
            projectId,
            name: name.trim(),
            title: title.trim(),
            parentId,
          }),
        });
      } else if (workspace) {
        await api(WORKSPACES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "update",
            id: workspace.id,
            name: name.trim(),
            title: title.trim(),
          }),
        });
      }
      onSaved();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.serverKey
          ? t(err.serverKey, err.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t("wa.projectPicker.close")}
          >
            ✕
          </Button>
        </div>
        <div>
          <label
            htmlFor="workspace-form-name"
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("wa.name")}
          </label>
          <Input
            id="workspace-form-name"
            name="workspaceFormName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        <div>
          <label
            htmlFor="workspace-form-title"
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("wa.title")}
          </label>
          <Input
            id="workspace-form-title"
            name="workspaceFormTitle"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </div>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("wa.cancel")}
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {t("wa.save")}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default WorkspaceFormDialog;
