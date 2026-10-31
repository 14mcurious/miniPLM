// Step 3a: isolated check of getSectionReferences(docXml, kind).
// Only reads w:headerReference / w:footerReference from document.xml,
// in document order, deduplicating by r:id. No rels, no HTML, no images.

const { DOMParser } = require("/tmp/workbench/miniplm/node_modules/@xmldom/xmldom");

/**
 * Parse document.xml and return the ordered, deduplicated list of
 * section-part relationship ids (w:headerReference / w:footerReference).
 *
 * @param {string} docXml  word/document.xml content
 * @param {"header"|"footer"} kind
 * @returns {string[]} r:id values, in document order, deduplicated
 */
function getSectionReferences(docXml, kind) {
  const tagName =
    kind === "header" ? "w:headerReference" : "w:footerReference";
  const doc = new DOMParser().parseFromString(docXml, "application/xml");
  const refs = doc.getElementsByTagName(tagName);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < refs.length; i++) {
    const rid = refs[i].getAttribute("r:id") || "";
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);
    out.push(rid);
  }
  return out;
}

// --- tests -----------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) { throw new Error("FAIL: " + msg); }
  console.log("PASS: " + msg);
}

const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>sezione 1</w:t></w:r>
      <w:pPr><w:sectPr>
        <w:headerReference w:type="default" r:id="rId2"/>
        <w:headerReference w:type="first" r:id="rId9"/>
        <w:footerReference w:type="default" r:id="rId3"/>
      </w:sectPr></w:pPr>
    </w:p>
    <w:p><w:r><w:t>sezione 2</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:headerReference w:type="even" r:id="rId5"/>
      <w:footerReference w:type="default" r:id="rId3"/>
      <w:footerReference w:type="first" r:id="rId7"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const headers = getSectionReferences(docXml, "header");
const footers = getSectionReferences(docXml, "footer");

// document order: rId2 (sec1 default), rId9 (sec1 first), rId2 dup skipped,
// rId5 (sec2 even)
assert(headers.length === 3, "headers: 3 unici (rId2, rId9, rId5)");
assert(headers[0] === "rId2", "headers[0]=rId2");
assert(headers[1] === "rId9", "headers[1]=rId9");
assert(headers[2] === "rId5", "headers[2]=rId5");

// footers: rId3 (sec1), rId3 dup saltato, rId7 (sec2 first)
assert(footers.length === 2, "footers: 2 unici (rId3, rId7)");
assert(footers[0] === "rId3", "footers[0]=rId3");
assert(footers[1] === "rId7", "footers[1]=rId7");

// caso senza riferimenti
const empty = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>`;
assert(getSectionReferences(empty, "header").length === 0, "no header refs -> []");
assert(getSectionReferences(empty, "footer").length === 0, "no footer refs -> []");

console.log("ALL 3a CHECKS PASSED");
process.exit(0);
