/**
 * Browser shim for Node's "path" module.
 *
 * `mammoth` (Word import) requires "path" at module load time; the values
 * are only used for external file access (file:// images), which is
 * disabled by default and never used in the browser.
 */
const noop = () => "";

export const dirname = noop;
export const basename = noop;
export const isAbsolute = noop;
export const resolve = noop;
export const join = noop;
export const sep = "/";

export default {
  dirname,
  basename,
  isAbsolute,
  resolve,
  join,
  sep,
};
