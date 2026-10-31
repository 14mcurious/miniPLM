import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useI18n } from "@/i18n";
import {
  MD_IMAGE_ACCEPT,
  MD_IMAGE_MAX_SIZE,
  mdImageErrorMessage,
  mdImageRef,
  uploadMdImage,
} from "@/lib/md-image";

const IMAGE_URL_RE = /^https?:\/\//i;

interface HtmlImageDialogProps {
  id: string;
  editor: Editor;
  open: boolean;
  onClose: () => void;
}

/**
 * Insert an image into the HTML field, either from a local file
 * (uploaded to the app's private image store) or from a URL.
 */
const HtmlImageDialog = ({ id, editor, open, onClose }: HtmlImageDialogProps) => {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setUrl("");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleFile = async (file: File) => {
    if (file.size > MD_IMAGE_MAX_SIZE) {
      toast.error(t("html.t.imageTooLarge"));
      return;
    }
    if (!MD_IMAGE_ACCEPT.split(",").includes(file.type)) {
      toast.error(t("html.t.imageUnsupported"));
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadMdImage(file);
      editor
        .chain()
        .focus()
        .setImage({
          src: mdImageRef(uploaded.id),
          alt: uploaded.fileName.replace(/\.[a-z0-9]+$/i, ""),
        })
        .run();
      onClose();
    } catch (error: unknown) {
      console.error("html image upload failed:", error);
      toast.error(mdImageErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const insertUrl = () => {
    const value = url.trim();
    if (!IMAGE_URL_RE.test(value)) return;
    editor.chain().focus().setImage({ src: value, alt: "" }).run();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("html.t.image")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {t("html.t.image")}
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
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="mb-4 inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ImagePlus className="h-4 w-4" />
          {busy ? t("wa.uploading") : t("html.t.imageByFile")}
        </button>
        <input
          ref={fileRef}
          id={`${id}-image-file`}
          name={`${id}-image-file`}
          type="file"
          accept={MD_IMAGE_ACCEPT}
          className="hidden"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
        <label
          htmlFor={`${id}-image-url`}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("html.t.imageByUrl")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-image-url`}
            name={`${id}-image-url`}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insertUrl();
              }
            }}
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button"
            onClick={insertUrl}
            disabled={!IMAGE_URL_RE.test(url.trim())}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("html.t.imageInsert")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HtmlImageDialog;
