import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useI18n } from "@/i18n";

const SAFE_LINK_RE = /^(https?:\/\/|mailto:)/i;

interface HtmlLinkDialogProps {
  id: string;
  editor: Editor;
  open: boolean;
  onClose: () => void;
}

/**
 * Small dialog to create/update a link on the current selection (or on
 * the link under the cursor). Validates the URL scheme before applying.
 */
const HtmlLinkDialog = ({ id, editor, open, onClose }: HtmlLinkDialogProps) => {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [hasCurrent, setHasCurrent] = useState(false);
  const [canApply, setCanApply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh the form when the dialog opens (editor selection may move).
  useEffect(() => {
    if (!open) return;
    const state = linkDialogState(editor);
    setUrl(state.url);
    setHasCurrent(state.hasCurrent);
    setCanApply(state.canApply);
    setError(null);
  }, [open, editor]);

  if (!open) return null;

  const apply = () => {
    const value = url.trim();
    if (!SAFE_LINK_RE.test(value)) {
      setError(t("html.t.linkError"));
      return;
    }
    editor.chain().extendMarkRange("link").setLink({ href: value }).run();
    onClose();
  };

  const remove = () => {
    editor.chain().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("html.t.link")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {t("html.t.link")}
          </h3>
          <button
            type="button"
            aria-label={t("md.close")}
            title={t("md.close")}
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <label
          htmlFor={`${id}-link-url`}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("html.t.linkUrl")}
        </label>
        <input
          id={`${id}-link-url`}
          name={`${id}-link-url`}
          type="url"
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          className="mb-2 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("html.t.linkApply")}
          </button>
          {hasCurrent && (
            <button
              type="button"
              onClick={remove}
              className="rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {t("html.t.linkRemove")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default HtmlLinkDialog;

/** Populate the dialog state before rendering it (called by the parent). */
export function linkDialogState(editor: Editor): {
  url: string;
  hasCurrent: boolean;
  canApply: boolean;
} {
  return {
    url: String(editor.getAttributes("link").href ?? ""),
    hasCurrent: editor.isActive("link"),
    canApply: !editor.state.selection.empty || editor.isActive("link"),
  };
}
