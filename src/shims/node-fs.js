/**
 * Browser shim for Node's "fs" module.
 *
 * `mammoth` binds fs methods at module load time; real file I/O is only
 * used for external file access, which is disabled by default and never
 * used in the browser.
 */
const notAvailable = () =>
  Promise.reject(new Error("fs is not available in the browser"));

export const promises = {
  readFile: notAvailable,
  writeFile: notAvailable,
};
export const createWriteStream = () => {
  throw new Error("fs.createWriteStream is not available in the browser");
};
export const readFileSync = () => {
  throw new Error("fs.readFileSync is not available in the browser");
};
export const writeFileSync = () => {
  throw new Error("fs.writeFileSync is not available in the browser");
};

export default {
  promises,
  createWriteStream,
  readFileSync,
  writeFileSync,
};
