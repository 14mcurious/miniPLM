import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Placeholder from "@tiptap/extension-placeholder";
import { useI18n } from "@/i18n";
import HtmlToolbar from "@/components/HtmlToolbar";
import HtmlLinkDialog from "@/components/HtmlLinkDialog";
import HtmlImageDialog from "@/components/HtmlImageDialog";
import {
  docxFileName,
  docxToHtml,
  downloadBlob,
  htmlToDocxBlob,
} from "@/lib/html-docx";

export interface HtmlEditorProps {
  id: string;
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Rich HTML editor (Tiptap) for "html" template fields.
 *
 * The stored value is the editor HTML fragment. App-managed image
 * references (see lib/md-image) keep working because they resolve to
 * local object URLs at render time.
 */
const HtmlEditor = ({
  id,
  name,
  value,
  disabled = false,
  onChange,
}: HtmlEditorProps) => {
  const { t } = useI18n();
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor(
    {
      immediatelyRender: true,
      shouldRerenderOnTransaction: true,
      editable: !disabled,
      content: value,
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Color,
        TextStyle,
        FontFamily,
        Highlight,
        TextAlign,
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
        Image,
        Table,
        TableRow,
        TableCell,
        TableHeader,
        Placeholder.configure({ placeholder: t("html.placeholder") }),
      ],
      editorProps: {
        attributes: {
          id,
          name,
          class: "html-editor-content prose prose-sm max-w-none min-h-40 px-3 py-2 text-sm text-foreground focus:outline-none",
        },
      },
      onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML()),
    },
    [t] // recreate only on language change (placeholder text)
  );

  // Follow external value changes (template switch, load) without
  // clobbering what the user is typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div className="min-h-40 rounded-md border border-input bg-background" />
    );
  }

  const handleImportDocx = async (file: File) => {
    setImporting(true);
    try {
      const html = await docxToHtml(file);
      editor.chain().focus("end").insertContent(html).run();
      toast.success(t("html.importDone"));
    } catch (error: unknown) {
      console.error("html docx import failed:", error);
      toast.error(t("html.importError"));
    } finally {
      setImporting(false);
    }
  };

  const handleExportDocx = async () => {
    if (editor.isEmpty) {
      toast.error(t("html.exportEmpty"));
      return;
    }
    setExporting(true);
    try {
      const blob = await htmlToDocxBlob(editor.getHTML(), {
        root: editor.view.dom,
      });
      downloadBlob(blob, docxFileName(name));
      toast.success(t("html.exportDone"));
    } catch (error: unknown) {
      console.error("html docx export failed:", error);
      toast.error(t("html.exportError"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-0">
      <HtmlToolbar
        id={id}
        editor={editor}
        disabled={disabled}
        importing={importing}
        exporting={exporting}
        onImportFile={(file) => void handleImportDocx(file)}
        onExport={() => void handleExportDocx()}
        onOpenLink={() => setLinkOpen(true)}
        onOpenImage={() => setImageOpen(true)}
      />
      <div className="rounded-b-md border border-input bg-background">
        <EditorContent editor={editor} />
      </div>
      <HtmlLinkDialog
        id={id}
        editor={editor}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
      />
      <HtmlImageDialog
        id={id}
        editor={editor}
        open={imageOpen}
        onClose={() => setImageOpen(false)}
      />
    </div>
  );
};

export default HtmlEditor;
