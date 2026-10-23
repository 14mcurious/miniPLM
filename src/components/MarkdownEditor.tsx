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
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  PenLine,
  Quote,
  Strikethrough,
  Table as TableIcon,
  X,
  Eye,
} from "lucide-react";
import { useI18n } from "@/i18n";
import MarkdownView from "@/components/MarkdownView";

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
    </div>
  );
};

export default MarkdownEditor;
