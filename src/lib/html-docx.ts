/**
 * DOCX import/export helpers for the HTML field editor.
 *
 * - Import: `mammoth` (browser bundle, lazy-loaded) converts .docx bytes
 *   to an HTML fragment that the editor appends to the document.
 * - Export: `dom-docx/browser` converts the editor HTML (with live
 *   computed styles) to a .docx Blob downloaded in the browser.
 */

import type { convertToHtml } from "mammoth";

type MammothBrowserModule = {
  default: { convertToHtml: typeof convertToHtml };
};

/**
 * Convert a .docx file to an HTML body fragment (appended to the
 * document). Throws on invalid or empty documents.
 */
export async function docxToHtml(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const mod = (await import("mammoth/mammoth.browser")) as MammothBrowserModule;
  const result = await mod.default.convertToHtml({ buffer });
  if (!result.value || !result.value.trim()) {
    throw new Error("empty document");
  }
  return result.value;
}

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
