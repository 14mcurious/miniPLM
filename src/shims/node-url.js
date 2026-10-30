/**
 * Browser shim for Node's "url" module (used by mammoth for file:// URIs,
 * which are never resolved in the browser).
 */
export const parse = (uri) => ({
  protocol: "",
  pathname: typeof uri === "string" ? uri : "",
  href: typeof uri === "string" ? uri : "",
});

export default { parse };
