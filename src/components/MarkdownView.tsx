import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { resolveMdImages } from "@/lib/md-image";

interface MarkdownViewProps {
  source: string;
  className?: string;
}

/**
 * Read-only rendered markdown: the source is converted with `marked`
 * and sanitized (see lib/markdown) before being inserted as HTML with
 * the Tailwind typography "prose" styles.
 *
 * App-managed image references (inserted from disk, see lib/md-image) are
 * resolved after render: the bytes are fetched through the session-
 * authenticated endpoint and swapped into a local object URL.
 */
const MarkdownView = ({ source, className = "" }: MarkdownViewProps) => {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      resolveMdImages(containerRef.current);
    }
  }, [html]);
  if (!html) return null;
  return (
    <div
      ref={containerRef}
      className={`prose prose-sm max-w-none break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownView;
