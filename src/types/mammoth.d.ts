/**
 * Type declarations for the `mammoth` package (docx -> HTML/Markdown
 * converter, https://github.com/mwilliamson/mammoth.js), scoped to the
 * browser API used by the HTML field editor.
 *
 * Note: mammoth 1.x accepts the raw document bytes under the `buffer`
 * property (`{ arrayBuffer }`, documented in the README, is not handled by
 * the library's unzip layer in 1.13.x). The declaration below matches the
 * runtime behavior.
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
    /** Raw .docx bytes (ArrayBuffer or typed array from the browser). */
    buffer: ArrayBuffer | ArrayBufferView;
  }

  /** Convert a .docx document to HTML. */
  export function convertToHtml(
    input: MammothInput,
    options?: Record<string, unknown>
  ): Promise<MammothHtmlResult>;
}
