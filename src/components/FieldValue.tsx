import { useEffect, useRef } from "react";
import MarkdownView from "@/components/MarkdownView";
import { downloadAttachment } from "@/lib/work-instance-form";
import { resolveMdImages } from "@/lib/md-image";
import { AttachmentValue, WorkInstanceField } from "@/lib/types";

/**
 * Read-only HTML value. App-managed image references (inserted from
 * disk by the HTML/Markdown editors) are resolved to session-fetched
 * object URLs after render.
 */
const HtmlValue = ({ html }: { html: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      resolveMdImages(containerRef.current);
    }
  }, [html]);
  return (
    <div
      ref={containerRef}
      className="prose prose-sm max-w-none rounded-md border bg-muted/30 p-3 text-sm text-foreground"
      // HTML authored by the same project members; rendered as-is.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

interface FieldValueProps {
  field: WorkInstanceField;
}

/**
 * Read-only rendering of a work instance / work container field value.
 * The value is rendered according to its declared type: markdown and HTML
 * as a preview, XML as code, attachments as a download link — never as
 * raw source text.
 */
const FieldValue = ({ field }: FieldValueProps) => {
  const value = field.value;
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (field.type === "attachment" && typeof value === "object") {
    const attachment = value as AttachmentValue;
    return (
      <button
        type="button"
        className="text-sm text-primary hover:underline"
        onClick={() => void downloadAttachment(attachment.s3Key)}
      >
        {attachment.fileName} ({Math.round(attachment.size / 1024)} KB)
      </button>
    );
  }
  if (field.type === "html") {
    return <HtmlValue html={String(value)} />;
  }
  if (field.type === "xml") {
    return (
      <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs text-foreground">
        {String(value)}
      </pre>
    );
  }
  if (field.type === "md") {
    return (
      <div className="rounded-md border bg-muted/30 p-3">
        <MarkdownView source={String(value)} />
      </div>
    );
  }
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <span
            key={index}
            className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {String(item)}
          </span>
        ))}
      </span>
    );
  }
  return <span className="break-words">{String(value)}</span>;
};

export default FieldValue;
