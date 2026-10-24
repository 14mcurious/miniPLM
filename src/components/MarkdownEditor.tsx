import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bold,
  Code,
  CodeXml,
  FileDown,
  Heading1,
  Heading2,
  Heading3,
  HelpCircle,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  PenLine,
  Quote,
  RefreshCw,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Upload,
  X,
  Eye,
} from "lucide-react";
import { useI18n } from "@/i18n";
import MarkdownView from "@/components/MarkdownView";
import {
  MD_IMAGE_ACCEPT,
  MD_IMAGE_MAX_SIZE,
  deleteMdImage,
  listMdImages,
  mdImageErrorMessage,
  mdImageRef,
  replaceMdImage,
  resolveMdImages,
  uploadMdImage,
  type MdImageInfo,
} from "@/lib/md-image";

interface MarkdownEditorProps {
  id: string;
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

interface ToolDef {
  icon: React.ComponentType<{ className?: string }>;
  /** i18n key of the tooltip. */
  titleKey: string;
  action: (editor: MarkdownActions) => void;
}

interface MarkdownActions {
  wrap: (before: string, after?: string, placeholder?: string) => void;
  prefixLines: (prefix: (lineIndex: number) => string) => void;
  insertBlock: (block: string) => void;
}

/** Toolbar buttons, grouped; a `null` entry renders a separator. */
const TOOL_GROUPS: (ToolDef | null)[][] = [
  [
    {
      icon: Heading1,
      titleKey: "md.t.heading1",
      action: (e) => e.prefixLines(() => "# "),
    },
    {
      icon: Heading2,
      titleKey: "md.t.heading2",
      action: (e) => e.prefixLines(() => "## "),
    },
    {
      icon: Heading3,
      titleKey: "md.t.heading3",
      action: (e) => e.prefixLines(() => "### "),
    },
  ],
  [
    {
      icon: Bold,
      titleKey: "md.t.bold",
      action: (e) => e.wrap("**", "**", "bold"),
    },
    {
      icon: Italic,
      titleKey: "md.t.italic",
      action: (e) => e.wrap("*", "*", "italic"),
    },
    {
      icon: Strikethrough,
      titleKey: "md.t.strike",
      action: (e) => e.wrap("~~", "~~", "strike"),
    },
    {
      icon: Code,
      titleKey: "md.t.code",
      action: (e) => e.wrap("`", "`", "code"),
    },
  ],
  [
    {
      icon: List,
      titleKey: "md.t.bullet",
      action: (e) => e.prefixLines(() => "- "),
    },
    {
      icon: ListOrdered,
      titleKey: "md.t.ordered",
      action: (e) => e.prefixLines((i) => `${i + 1}. `),
    },
    {
      icon: ListTodo,
      titleKey: "md.t.task",
      action: (e) => e.prefixLines(() => "- [ ] "),
    },
  ],
  [
    {
      icon: Quote,
      titleKey: "md.t.quote",
      action: (e) => e.prefixLines(() => "> "),
    },
    {
      icon: CodeXml,
      titleKey: "md.t.codeBlock",
      action: (e) => e.insertBlock("```\ncode\n```"),
    },
  ],
  [
    {
      icon: LinkIcon,
      titleKey: "md.t.link",
      action: (e) => e.wrap("[", "](https://)", "link"),
    },
    {
      icon: ImageIcon,
      titleKey: "md.t.image",
      action: (e) => e.wrap("![", "](https://)", "alt"),
    },
    {
      icon: TableIcon,
      titleKey: "md.t.table",
      action: (e) =>
        e.insertBlock("| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |"),
    },
    {
      icon: Minus,
      titleKey: "md.t.rule",
      action: (e) => e.insertBlock("---"),
    },
  ],
];

/** Help dialog rows: syntax example (markdown) + its rendered result. */
const HELP_ROWS: { key: string; example: string }[] = [
  { key: "md.h.heading", example: "# Heading 1\n## Heading 2\n### Heading 3" },
  { key: "md.h.emphasis", example: "**bold** *italic* ~~strikethrough~~" },
  {
    key: "md.h.bullet",
    example: "- first item\n- second item\n  - nested item",
  },
  { key: "md.h.ordered", example: "1. first step\n2. second step" },
  { key: "md.h.task", example: "- [ ] to do\n- [x] done" },
  { key: "md.h.quote", example: "> quoted text" },
  { key: "md.h.inlineCode", example: "use `npm run build` to compile" },
  { key: "md.h.codeBlock", example: "```\ncode block\n```" },
  { key: "md.h.link", example: "[link text](https://example.com)" },
  { key: "md.h.image", example: "![alt text](https://example.com/image.png)" },
  {
    key: "md.h.table",
    example: "| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |",
  },
  { key: "md.h.rule", example: "---" },
];

const MarkdownEditor = ({
  id,
  name,
  value,
  disabled = false,
  onChange,
}: MarkdownEditorProps) => {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [helpOpen, setHelpOpen] = useState(false);

  // Private image store: insertion from disk + management dialog.
  const imageFileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageImages, setManageImages] = useState<MdImageInfo[]>([]);
  const [manageLoading, setManageLoading] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageBusyId, setManageBusyId] = useState<string | null>(null);
  const manageBodyRef = useRef<HTMLDivElement>(null);

  const apply = (next: string, selStart: number, selEnd: number) => {
    onChange(next);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selStart, selEnd);
    });
  };

  const handleExportDocx = () => {
    // Lazy-load the DOCX toolchain only when the user exports, so the
    // (heavy) docx package stays out of the main bundle.
    void import("@/lib/docx-export")
      .then(({ docxFileName, exportMarkdownToDocx }) =>
        exportMarkdownToDocx(value, docxFileName(name))
      )
      .then(() => toast.success(t("md.exportDocxDone")))
      .catch((error: unknown) => {
        console.error("md docx export failed:", error);
        toast.error(t("md.exportDocxError"));
      });
  };

  // --- Private image store: insert from disk + manage ---------------------

  /** Client-side validation shared by insert and replace. */
  const validateImageFile = (file: File): string | null => {
    if (file.size > MD_IMAGE_MAX_SIZE) {
      return t("md.imageTooLarge", { max: "700 KB" });
    }
    if (!MD_IMAGE_ACCEPT.split(",").includes(file.type)) {
      return t("md.imageUnsupported");
    }
    return null;
  };

  const handleInsertImage = async (file: File) => {
    const invalid = validateImageFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setImageBusy(true);
    try {
      const uploaded = await uploadMdImage(file);
      const alt = uploaded.fileName.replace(/\.[a-z0-9]+$/i, "");
      actions.insertBlock(`![${alt}](${mdImageRef(uploaded.id)})`);
      toast.success(t("md.imageInserted"));
    } catch (error: unknown) {
      console.error("md image upload failed:", error);
      toast.error(mdImageErrorMessage(error, t));
    } finally {
      setImageBusy(false);
    }
  };

  const loadManageImages = async () => {
    setManageLoading(true);
    setManageError(null);
    try {
      setManageImages(await listMdImages());
    } catch (error: unknown) {
      console.error("md image list failed:", error);
      setManageError(mdImageErrorMessage(error, t));
    } finally {
      setManageLoading(false);
    }
  };

  const handleManageOpen = () => {
    setManageOpen(true);
    void loadManageImages();
  };

  const handleReplaceClick = (imageId: string) => {
    replaceTargetRef.current = imageId;
    replaceFileRef.current?.click();
  };

  const handleReplaceFile = async (file: File) => {
    const target = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (!target) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setManageBusyId(target);
    try {
      await replaceMdImage(target, file);
      toast.success(t("md.imageReplaced"));
      await loadManageImages();
    } catch (error: unknown) {
      console.error("md image replace failed:", error);
      toast.error(mdImageErrorMessage(error, t));
    } finally {
      setManageBusyId(null);
    }
  };

  const handleDeleteImage = async (image: MdImageInfo) => {
    if (!window.confirm(t("md.manageDeleteConfirm"))) return;
    setManageBusyId(image.id);
    try {
      await deleteMdImage(image.id);
      toast.success(t("md.imageDeleted"));
      setManageImages((images) =>
        images.filter((item) => item.id !== image.id)
      );
    } catch (error: unknown) {
      console.error("md image delete failed:", error);
      toast.error(mdImageErrorMessage(error, t));
    } finally {
      setManageBusyId(null);
    }
  };

  // Render thumbnails inside the open manage dialog.
  useEffect(() => {
    if (manageOpen && manageBodyRef.current) {
      resolveMdImages(manageBodyRef.current);
    }
  }, [manageOpen, manageImages]);

  // Close the manage dialog on Escape.
  useEffect(() => {
    if (!manageOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManageOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manageOpen]);

  const actions: MarkdownActions = {
    wrap(before, after = before, placeholder = "") {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      const selected = value.slice(start, end) || placeholder;
      const next =
        value.slice(0, start) + before + selected + after + value.slice(end);
      const selStart = start + before.length;
      const selEnd = selStart + selected.length;
      apply(next, selStart, selEnd);
    },
    prefixLines(prefix) {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIndex = value.indexOf("\n", end);
      const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
      const block = value.slice(lineStart, lineEnd);
      const lines = block.split("\n");
      const prefixed = lines
        .map((line, index) => prefix(index) + line)
        .join("\n");
      const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      apply(next, lineStart, lineStart + prefixed.length);
    },
    insertBlock(block) {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart ?? 0;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const before = value.slice(0, lineStart);
      const after = value.slice(lineStart);
      const gapBefore = !before ? "" : before.endsWith("\n\n") ? "" : "\n";
      const gapAfter = after && !after.startsWith("\n") ? "\n" : "";
      const insertion = `${gapBefore}${block}\n${gapAfter}`;
      const position = lineStart + insertion.length;
      apply(before + insertion + after, position, position);
    },
  };

  // Close the help dialog on Escape.
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  const buttonClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-0">
      <div
        role="toolbar"
        aria-label={t("md.toolbar")}
        className="flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 border-input bg-muted/40 p-1.5"
      >
        {TOOL_GROUPS.map((group, groupIndex) => (
          <span key={groupIndex} className="flex items-center gap-1">
            {groupIndex > 0 && (
              <span
                aria-hidden="true"
                className="mx-1 h-5 w-px bg-border"
              />
            )}
            {group.map((tool, toolIndex) => {
              const Icon = tool.icon;
              return (
                <button
                  key={toolIndex}
                  type="button"
                  title={t(tool.titleKey)}
                  aria-label={t(tool.titleKey)}
                  disabled={disabled || mode !== "write"}
                  onClick={() => tool.action(actions)}
                  className={buttonClass}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <button
            type="button"
            title={t("md.t.insertImage")}
            aria-label={t("md.t.insertImage")}
            disabled={disabled || mode !== "write" || imageBusy}
            onClick={() => imageFileRef.current?.click()}
            className={buttonClass}
          >
            {imageBusy ? (
              <span className="h-4 w-4 animate-pulse text-muted-foreground">
                {t("md.uploadingImage")}
              </span>
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            title={t("md.t.manageImages")}
            aria-label={t("md.t.manageImages")}
            disabled={disabled}
            onClick={handleManageOpen}
            className={buttonClass}
          >
            <Images className="h-4 w-4" />
          </button>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title={t("md.write")}
            aria-label={t("md.write")}
            aria-pressed={mode === "write"}
            onClick={() => setMode("write")}
            className={`${buttonClass} ${
              mode === "write" ? "bg-accent text-foreground" : ""
            }`}
          >
            <PenLine className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t("md.preview")}
            aria-label={t("md.preview")}
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
            className={`${buttonClass} ${
              mode === "preview" ? "bg-accent text-foreground" : ""
            }`}
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t("md.exportDocx")}
            aria-label={t("md.exportDocx")}
            disabled={disabled || !value.trim()}
            onClick={handleExportDocx}
            className={buttonClass}
          >
            <FileDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t("md.help")}
            aria-label={t("md.help")}
            onClick={() => setHelpOpen(true)}
            className={buttonClass}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </span>
      </div>
      {mode === "write" ? (
        <textarea
          id={id}
          name={name}
          ref={textareaRef}
          rows={8}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-b-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground"
          spellCheck={false}
        />
      ) : (
        <div className="min-h-32 rounded-b-md border border-input bg-background px-3 py-2 text-sm text-foreground">
          {value.trim() ? (
            <MarkdownView source={value} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      )}

      {helpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("md.helpTitle")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-base font-semibold text-foreground">
                {t("md.helpTitle")}
              </h3>
              <button
                type="button"
                aria-label={t("md.close")}
                title={t("md.close")}
                onClick={() => setHelpOpen(false)}
                className={buttonClass}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              <p className="mb-3 text-sm text-muted-foreground">
                {t("md.helpIntro")}
              </p>
              <div className="space-y-3">
                {HELP_ROWS.map((row) => (
                  <div
                    key={row.key}
                    className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,38%)_1fr]"
                  >
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t(row.key)}
                      </p>
                      <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs text-foreground">
                        {row.example}
                      </pre>
                    </div>
                    <div className="rounded bg-muted/30 p-2">
                      <MarkdownView source={row.example} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file pickers for the private image store. */}
      <input
        ref={imageFileRef}
        id={`${id}-image-upload`}
        name={`${id}-image-upload`}
        type="file"
        accept={MD_IMAGE_ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleInsertImage(file);
        }}
      />
      <input
        ref={replaceFileRef}
        id={`${id}-image-replace`}
        name={`${id}-image-replace`}
        type="file"
        accept={MD_IMAGE_ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleReplaceFile(file);
        }}
      />

      {manageOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("md.manageTitle")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setManageOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-base font-semibold text-foreground">
                {t("md.manageTitle")}
              </h3>
              <button
                type="button"
                aria-label={t("md.close")}
                title={t("md.close")}
                onClick={() => setManageOpen(false)}
                className={buttonClass}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div ref={manageBodyRef} className="overflow-y-auto px-4 py-3">
              <p className="mb-3 text-sm text-muted-foreground">
                {t("md.manageIntro")}
              </p>
              {manageLoading && (
                <p className="text-sm text-muted-foreground">
                  {t("md.manageLoading")}
                </p>
              )}
              {!manageLoading && manageError && (
                <div className="mb-3 space-y-2">
                  <p className="text-sm text-destructive">
                    {manageError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadManageImages()}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("md.manageReload")}
                  </button>
                </div>
              )}
              {!manageLoading && !manageError && manageImages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("md.manageEmpty")}
                </p>
              )}
              <div className="space-y-2">
                {manageImages.map((image) => {
                  const busy = manageBusyId === image.id;
                  return (
                    <div
                      key={image.id}
                      className="flex items-center gap-3 rounded-md border p-2"
                    >
                      <img
                        src={image.ref}
                        alt={image.fileName}
                        className="h-12 w-12 flex-none rounded border bg-muted object-contain"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {image.fileName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {Math.round(image.size / 1024)} KB ·{" "}
                          {image.contentType} · {image.updatedAt}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy}
                        onClick={() => handleReplaceClick(image.id)}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {t("md.manageReplace")}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy}
                        onClick={() => void handleDeleteImage(image)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("md.manageDelete")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarkdownEditor;
