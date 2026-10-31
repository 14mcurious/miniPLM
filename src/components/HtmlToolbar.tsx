import { useRef } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  CodeXml,
  Columns2,
  FileDown,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
  Rows,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Type,
  Undo2,
  Underline,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useI18n } from "@/i18n";

/** Preset text colors offered by the color select. */
const COLORS = [
  "#dc2626",
  "#ea580c",
  "#eab308",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#71717a",
];

/** Font families offered by the font select. */
const FONTS = [
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Courier New",
];

interface ToolButtonProps {
  title: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const ToolButton = ({
  title,
  disabled,
  active,
  onClick,
  children,
}: ToolButtonProps) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active ?? false}
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 ${
      active ? "bg-accent/20 text-foreground" : ""
    }`}
  >
    {children}
  </button>
);

const Separator = () => (
  <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
);

const selectClass =
  "h-8 rounded-md border border-input bg-background px-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-40";

export interface HtmlToolbarProps {
  id: string;
  editor: Editor;
  disabled: boolean;
  importing: boolean;
  exporting: boolean;
  onImportFile: (file: File) => void;
  onExport: () => void;
  onOpenLink: () => void;
  onOpenImage: () => void;
}

/**
 * Formatting toolbar for the HTML field editor. Renders the full
 * command set (styles, alignment, lists, links, images, tables) plus
 * the DOCX import/export actions on the right.
 */
const HtmlToolbar = ({
  id,
  editor,
  disabled,
  importing,
  exporting,
  onImportFile,
  onExport,
  onOpenLink,
  onOpenImage,
}: HtmlToolbarProps) => {
  const { t } = useI18n();
  const docxFileRef = useRef<HTMLInputElement>(null);
  /** Build a chain on the editor and run it (Tiptap v3 command API).
   *  Callbacks may either return the chain or a boolean after .run(). */
  type Chain = ReturnType<Editor["chain"]>;
  const run = (fn: (chain: Chain) => Chain | boolean) => () => {
    const chain = editor.chain();
    const result = fn(chain);
    if (result !== true && result !== false) result.run();
  };
  const textStyle = editor.getAttributes("textStyle") as Record<string, string>;
  const inTable = editor.isActive("table");

  return (
    <div
      role="toolbar"
      aria-label={t("html.toolbar")}
      className="flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 border-input bg-muted/40 p-1.5"
    >
      <ToolButton
        title={t("html.t.undo")}
        disabled={disabled || !editor.can().undo()}
        onClick={run((e) => e.undo().run())}
      >
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.redo")}
        disabled={disabled || !editor.can().redo()}
        onClick={run((e) => e.redo().run())}
      >
        <Redo2 className="h-4 w-4" />
      </ToolButton>
      <Separator />
      <ToolButton
        title={t("html.t.paragraph")}
        disabled={disabled}
        active={editor.isActive("paragraph")}
        onClick={run((e) => e.setNode("paragraph").run())}
      >
        <Pilcrow className="h-4 w-4" />
      </ToolButton>
      {([1, 2, 3] as const).map((level) => (
        <ToolButton
          key={level}
          title={t(`html.t.heading${level}`)}
          disabled={disabled}
          active={editor.isActive("heading", { level })}
          onClick={run((e) => e.toggleHeading({ level }).run())}
        >
          {level === 1 ? (
            <Heading1 className="h-4 w-4" />
          ) : level === 2 ? (
            <Heading2 className="h-4 w-4" />
          ) : (
            <Heading3 className="h-4 w-4" />
          )}
        </ToolButton>
      ))}
      <Separator />
      <ToolButton
        title={t("html.t.bold")}
        disabled={disabled}
        active={editor.isActive("bold")}
        onClick={run((e) => e.toggleBold().run())}
      >
        <Bold className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.italic")}
        disabled={disabled}
        active={editor.isActive("italic")}
        onClick={run((e) => e.toggleItalic().run())}
      >
        <Italic className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.underline")}
        disabled={disabled}
        active={editor.isActive("underline")}
        onClick={run((e) => e.toggleUnderline().run())}
      >
        <Underline className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.strike")}
        disabled={disabled}
        active={editor.isActive("strike")}
        onClick={run((e) => e.toggleStrike().run())}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.code")}
        disabled={disabled}
        active={editor.isActive("code")}
        onClick={run((e) => e.toggleCode().run())}
      >
        <Code className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.highlight")}
        disabled={disabled}
        active={editor.isActive("highlight")}
        onClick={run((e) => e.toggleHighlight().run())}
      >
        <Highlighter className="h-4 w-4" />
      </ToolButton>
      <Separator />
      <select
        id={`${id}-color`}
        name={`${id}-color`}
        aria-label={t("html.t.color")}
        title={t("html.t.color")}
        disabled={disabled}
        value={textStyle.color ?? ""}
        onChange={(e) => {
          const chain = editor.chain().focus();
          if (e.target.value) chain.setColor(e.target.value);
          else chain.unsetColor();
          chain.run();
        }}
        className={selectClass}
      >
        <option value="">{t("html.t.colorNone")}</option>
        {COLORS.map((color) => (
          <option key={color} value={color}>
            {color}
          </option>
        ))}
      </select>
      <select
        id={`${id}-font`}
        name={`${id}-font`}
        aria-label={t("html.t.font")}
        title={t("html.t.font")}
        disabled={disabled}
        value={textStyle.fontFamily ?? ""}
        onChange={(e) => {
          const chain = editor.chain().focus();
          if (e.target.value) chain.setFontFamily(e.target.value);
          else chain.unsetFontFamily();
          chain.run();
        }}
        className={selectClass}
      >
        <option value="">{t("html.t.fontAuto")}</option>
        {FONTS.map((family) => (
          <option key={family} value={family}>
            {family}
          </option>
        ))}
      </select>
      <Separator />
      <ToolButton
        title={t("html.t.alignLeft")}
        disabled={disabled}
        onClick={run((e) => e.setTextAlign("left").run())}
      >
        <AlignLeft className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.alignCenter")}
        disabled={disabled}
        onClick={run((e) => e.setTextAlign("center").run())}
      >
        <AlignCenter className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.alignRight")}
        disabled={disabled}
        onClick={run((e) => e.setTextAlign("right").run())}
      >
        <AlignRight className="h-4 w-4" />
      </ToolButton>
      <Separator />
      <ToolButton
        title={t("html.t.bullet")}
        disabled={disabled}
        active={editor.isActive("bulletList")}
        onClick={run((e) => e.toggleBulletList().run())}
      >
        <List className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.ordered")}
        disabled={disabled}
        active={editor.isActive("orderedList")}
        onClick={run((e) => e.toggleOrderedList().run())}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.quote")}
        disabled={disabled}
        active={editor.isActive("blockquote")}
        onClick={run((e) => e.toggleBlockquote().run())}
      >
        <Quote className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.codeBlock")}
        disabled={disabled}
        active={editor.isActive("codeBlock")}
        onClick={run((e) => e.toggleCodeBlock().run())}
      >
        <CodeXml className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.rule")}
        disabled={disabled}
        onClick={run((e) => e.setHorizontalRule().run())}
      >
        <Minus className="h-4 w-4" />
      </ToolButton>
      <Separator />
      <ToolButton
        title={t("html.t.link")}
        disabled={disabled}
        active={editor.isActive("link")}
        onClick={onOpenLink}
      >
        <LinkIcon className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.image")}
        disabled={disabled}
        onClick={onOpenImage}
      >
        <ImageIcon className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title={t("html.t.table")}
        disabled={disabled}
        onClick={run((e) =>
          e.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        )}
      >
        <TableIcon className="h-4 w-4" />
      </ToolButton>
      {inTable && (
        <>
          <Separator />
          <ToolButton
            title={t("html.t.tableAddRow")}
            disabled={disabled}
            onClick={run((e) => e.addRowAfter().run())}
          >
            <Rows className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            title={t("html.t.tableAddColumn")}
            disabled={disabled}
            onClick={run((e) => e.addColumnAfter().run())}
          >
            <Columns2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            title={t("html.t.tableDeleteRow")}
            disabled={disabled}
            onClick={run((e) => e.deleteRow().run())}
          >
            <Rows className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            title={t("html.t.tableDeleteColumn")}
            disabled={disabled}
            onClick={run((e) => e.deleteColumn().run())}
          >
            <Columns2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            title={t("html.t.tableDelete")}
            disabled={disabled}
            onClick={run((e) => e.deleteTable().run())}
          >
            <Trash2 className="h-4 w-4" />
          </ToolButton>
        </>
      )}
      <span className="ml-auto flex items-center gap-1">
        <Separator />
        <ToolButton
          title={t("html.t.importDocx")}
          disabled={disabled || importing}
          onClick={() => docxFileRef.current?.click()}
        >
          <FileUp className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title={t("html.t.exportDocx")}
          disabled={disabled || exporting}
          onClick={onExport}
        >
          <FileDown className="h-4 w-4" />
        </ToolButton>
      </span>
      <input
        ref={docxFileRef}
        id={`${id}-docx-upload`}
        name={`${id}-docx-upload`}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onImportFile(file);
        }}
      />
    </div>
  );
};

export default HtmlToolbar;
