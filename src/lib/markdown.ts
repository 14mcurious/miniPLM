import { marked } from "marked";

/**
 * Markdown ("md" field type) rendering helpers.
 *
 * `marked` converts the markdown source to HTML (GFM: tables, task
 * lists, strikethrough, ...). The generated HTML passes through a small
 * DOM-based sanitizer that strips script-execution vectors (script /
 * iframe / object / embed elements, event-handler attributes, unsafe
 * URLs) before it is inserted into the document. The content is authored
 * by project members, the same trust model as the "html" fields.
 */

marked.setOptions({ gfm: true, breaks: true });

const BLOCKED_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "frame",
  "noscript",
  "style",
]);

const SAFE_URL_RE = /^(https?:|mailto:|#|\/)/i;

/** Recursively remove blocked tags, event handlers and unsafe URLs. */
function cleanElement(root: Element): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (BLOCKED_TAGS.has(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        value !== "#" &&
        !SAFE_URL_RE.test(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

/**
 * Render a markdown source to sanitized HTML ("text/html" document
 * body). Empty sources render to an empty string.
 */
export function renderMarkdown(source: string): string {
  if (!source || !source.trim()) return "";
  const html = marked.parse(source, { async: false }) as string;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const child of Array.from(doc.body.children)) {
    if (BLOCKED_TAGS.has(child.tagName.toLowerCase())) child.remove();
  }
  cleanElement(doc.body);
  return doc.body.innerHTML;
}
