/**
 * Browser shim for Node's "os" module (used by mammoth only for file://
 * URI handling, which is never used in the browser).
 */
export const platform = () => "browser";
export const homedir = () => "/";

export default { platform, homedir };
