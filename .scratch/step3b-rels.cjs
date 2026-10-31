// Step 3b: isolated check of rels resolution.
// relsTargetMap(relsXml) -> { Id: Target }
// resolvePartPath(baseDir, target) -> normalized package path
// No document.xml, no HTML, no images.

const { DOMParser } = require("/tmp/workbench/miniplm/node_modules/@xmldom/xmldom");

/**
 * Parse a .rels part and return { Id: Target }.
 * @param {string} relsXml  e.g. word/_rels/document.xml.rels content
 * @returns {Record<string, string>}
 */
function relsTargetMap(relsXml) {
  const out = {};
  if (!relsXml) return out;
  const doc = new DOMParser().parseFromString(relsXml, "application/xml");
  const rels = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const id = rels[i].getAttribute("Id") || "";
    const target = rels[i].getAttribute("Target") || "";
    if (id) out[id] = target;
  }
  return out;
}

/**
 * Normalize a path, collapsing "." and ".." segments.
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  const parts = p.split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Resolve a relationship Target against the directory of the part that owns
 * the rels.
 *
 * Targets are relative to the owning part's directory (e.g. "header1.xml" is
 * relative to "word/" because document.xml lives at word/document.xml).
 * A leading "/" means package-root absolute.
 *
 * @param {string} baseDir  directory of the owning part, e.g. "word"
 * @param {string} target   Relationship Target value
 * @returns {string}        normalized package path, e.g. "word/header1.xml"
 */
function resolvePartPath(baseDir, target) {
  if (target.startsWith("/")) {
    return normalizePath(target.slice(1));
  }
  return normalizePath(baseDir + "/" + target);
}

// --- tests -----------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) { throw new Error("FAIL: " + msg); }
  console.log("PASS: " + msg);
}

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/word/media/image2.png"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="../sub/other-header.xml"/>
</Relationships>`;

const map = relsTargetMap(docRels);

assert(Object.keys(map).length === 6, "relsTargetMap: 6 entries");
assert(map["rId1"] === "word/document.xml", "rId1 -> word/document.xml");
assert(map["rId2"] === "header1.xml", "rId2 -> header1.xml");
assert(map["rId4"] === "media/image1.png", "rId4 -> media/image1.png");

// resolvePartPath: document.xml owns these rels, base dir = "word"
assert(resolvePartPath("word", map["rId2"]) === "word/header1.xml", "relative -> word/header1.xml");
assert(resolvePartPath("word", map["rId3"]) === "word/footer1.xml", "relative -> word/footer1.xml");
assert(resolvePartPath("word", map["rId4"]) === "word/media/image1.png", "relative subdir -> word/media/image1.png");
assert(resolvePartPath("word", map["rId5"]) === "word/media/image2.png", "absolute -> word/media/image2.png");
assert(resolvePartPath("word", map["rId6"]) === "sub/other-header.xml", ".. collapse -> sub/other-header.xml");

// null/empty rels
assert(Object.keys(relsTargetMap("")).length === 0, "empty rels xml -> {}");
assert(Object.keys(relsTargetMap(null)).length === 0, "null rels xml -> {}");

console.log("ALL 3b CHECKS PASSED");
process.exit(0);
