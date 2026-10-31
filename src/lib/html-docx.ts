/**
 * DOCX import/export helpers for the HTML field editor.
 *
 * - Import: `./docx-import` converts a .docx file to an HTML fragment that
 *   the editor appends to the document (mammoth browser bundle plus
 *   shape/header-footer compensation).
 * - Export: `dom-docx/browser` converts the editor HTML (with live
 *   computed styles) to a .docx Blob downloaded in the browser.
 */

export { docxToHtml } from "./docx-import";

export interface HtmlToDocxOptions {
  /** Live editor element used to snapshot computed styles. */
  root: Element;
}

/** Convert an HTML body fragment to a .docx Blob. */
export async function htmlToDocxBlob(
  html: string,
  { root }: HtmlToDocxOptions
): Promise<Blob> {
  const { convertHtmlToDocx } = await import("dom-docx/browser");
  return convertHtmlToDocx(html, {
    styleSource: "computed",
    root,
    onWarning: null,
  });
}

/** Build the .docx file name from the field name. */
export function docxFileName(base: string): string {
  const cleaned = base
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${cleaned || "documento"}.docx`;
}

/** Trigger a browser download for a generated Blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
