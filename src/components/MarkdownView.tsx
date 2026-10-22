import { useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown";

interface MarkdownViewProps {
  source: string;
  className?: string;
}

/**
 * Read-only rendered markdown: the source is converted with `marked`
 * and sanitized (see lib/markdown) before being inserted as HTML with
 * the Tailwind typography "prose" styles.
 */
const MarkdownView = ({ source, className = "" }: MarkdownViewProps) => {
  const html = useMemo(() => renderMarkdown(source), [source]);
  if (!html) return null;
  return (
    <div
      className={`prose prose-sm max-w-none break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownView;
