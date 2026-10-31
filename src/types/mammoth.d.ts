/**
 * Type declarations for the `mammoth` package (docx -> HTML/Markdown
 * converter, https://github.com/mwilliamson/mammoth.js), scoped to the
 * browser API used by the HTML field editor.
 *
 * Note: the mammoth 1.13 browser bundle only accepts the document bytes
 * under the `arrayBuffer` property (its `browser/unzip.js` reads
 * `options.arrayBuffer` and rejects anything else with "Could not find
 * file in options"). The declaration below matches the runtime behavior.
 */
declare module "mammoth" {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface MammothHtmlResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface MammothInput {
    /** Raw .docx bytes as an `ArrayBuffer` (browser input shape). */
    arrayBuffer: ArrayBuffer;
  }

  /** Convert a .docx document to HTML. */
  export function convertToHtml(
    input: MammothInput,
    options?: Record<string, unknown>
  ): Promise<MammothHtmlResult>;
}

/**
 * Self-contained UMD browser bundle (bundled with mammoth 1.13).
 * Vite's CJS interop exposes the API object as the default export.
 */
declare module "mammoth/mammoth.browser" {
  import type { convertToHtml } from "mammoth";
  const mammoth: { convertToHtml: typeof convertToHtml };
  export default mammoth;
}
