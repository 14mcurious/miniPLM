// Step 2: validate the "replace shape drawings without image with text
// paragraphs" pre-processing against the real mammoth browser bundle.
const { DOMParser } = require("/tmp/workbench/miniplm/node_modules/@xmldom/xmldom");
const JSZip = require("/tmp/workbench/miniplm/node_modules/jszip");
const mammoth = require("/tmp/workbench/miniplm/node_modules/mammoth/mammoth.browser.js");

// --- helpers shared with the future src/lib/docx-import.ts -----------------

function parseXml(xml) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function escapeAttr(v) {
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeXml(node) {
  let out = "<" + node.nodeName;
  const attrs = node.attributes;
  for (let i = 0; i < attrs.length; i++) {
    out += ` ${attrs[i].name}="${escapeAttr(attrs[i].value)}"`;
  }
  out += ">";
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1) {
      out += serializeXml(child);
    } else if (child.nodeType === 3 || child.nodeType === 4) {
      out += escapeText(child.nodeValue || "");
    }
  }
  out += `</${node.nodeName}>`;
  return out;
}

function localChildren(parent, name) {
  const out = [];
  const children = parent ? parent.childNodes : null;
  if (!children) return out;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1 && child.nodeName === name) out.push(child);
  }
  return out;
}

function paragraphText(p) {
  // concatenate in document order i w:t di un w:p
  let text = "";
  const ts = p.getElementsByTagName("w:t");
  for (let i = 0; i < ts.length; i++) {
    text += ts[i].textContent || "";
  }
  return text;
}

function aParagraphText(p) {
  let text = "";
  const ts = p.getElementsByTagName("a:t");
  for (let i = 0; i < ts.length; i++) {
    text += ts[i].textContent || "";
  }
  return text;
}

function extractShapeLines(el) {
  const lines = [];
  // Text box content (DrawingML text boxes): w:txbxContent/w:p
  const boxes = el.getElementsByTagName("w:txbxContent");
  if (boxes.length > 0) {
    for (let b = 0; b < boxes.length; b++) {
      const ps = boxes[b].getElementsByTagName("w:p");
      for (let i = 0; i < ps.length; i++) lines.push(paragraphText(ps[i]));
    }
    return lines;
  }
  // Autoshapes con testo: a:p/a:t
  const ps = el.getElementsByTagName("a:p");
  for (let i = 0; i < ps.length; i++) lines.push(aParagraphText(ps[i]));
  return lines;
}

function removeNode(node) {
  if (node.parentNode) node.parentNode.removeChild(node);
}

function makeTextParagraph(doc, text) {
  const p = doc.createElement("w:p");
  const r = doc.createElement("w:r");
  const t = doc.createElement("w:t");
  t.setAttribute("xml:space", "preserve");
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);
  return p;
}

function hasOtherText(p, excluded) {
  const ts = p.getElementsByTagName("w:t");
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] === excluded) continue;
    if (contains(excluded, ts[i])) continue;
    if ((ts[i].textContent || "").trim() !== "") return true;
  }
  return false;
}

function contains(ancestor, node) {
  let n = node;
  while (n) {
    if (n === ancestor) return true;
    n = n.parentNode;
  }
  return false;
}

function replaceNodeWith(parent, oldNode, newNodes) {
  let anchor = oldNode;
  for (const nn of newNodes) {
    parent.insertBefore(nn, anchor.nextSibling);
    anchor = nn;
  }
  parent.removeChild(oldNode);
}

function patchDrawingOrPict(doc, el, isPict) {
  const hasBlip = el.getElementsByTagName("a:blip").length > 0;
  const hasImageData = isPict && el.getElementsByTagName("v:imagedata").length > 0;
  if (hasBlip || hasImageData) return; // mammoth/gestore estrae l'immagine
  const lines = extractShapeLines(el).filter((l) => l.length > 0);
  if (lines.length === 0) {
    removeNode(el);
    return;
  }
  const run = el.parentNode; // w:r (di solito)
  const p = run && run.parentNode; // w:p (di solito)
  if (run && run.nodeName === "w:r" && p && p.nodeName === "w:p" &&
      !hasOtherText(p, el) && !hasOtherImageOrShape(p, el)) {
    // sostituisce l'intero paragrafo con uno o più paragrafi di testo
    const newParagraphs = lines.map((l) => makeTextParagraph(doc, l));
    replaceNodeWith(p.parentNode, p, newParagraphs);
  } else {
    // contesto misto: inserisce il testo (righe separate da spazio) come w:t
    const t = doc.createElement("w:t");
    t.setAttribute("xml:space", "preserve");
    t.textContent = lines.join(" ");
    if (el.parentNode) el.parentNode.replaceChild(t, el);
  }
}

function hasOtherImageOrShape(p, excluded) {
  const draws = p.getElementsByTagName("w:drawing");
  for (let i = 0; i < draws.length; i++) {
    if (draws[i] === excluded) continue;
    if (draws[i].getElementsByTagName("a:blip").length > 0) return true;
  }
  const picts = p.getElementsByTagName("w:pict");
  for (let i = 0; i < picts.length; i++) {
    if (picts[i] === excluded) continue;
    if (picts[i].getElementsByTagName("v:imagedata").length > 0) return true;
  }
  return false;
}

function patchDocumentForShapes(xml) {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  // Process drawings (copia della lista perché mutiamo il DOM)
  const drawings = Array.from(root.getElementsByTagName("w:drawing"));
  for (const d of drawings) patchDrawingOrPict(doc, d, false);
  const picts = Array.from(root.getElementsByTagName("w:pict"));
  for (const p of picts) patchDrawingOrPict(doc, p, true);
  return serializeXml(root);
}

// --- run -------------------------------------------------------------------

(async () => {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>TESTO CORPO</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                  <wps:txbx><w:txbxContent>
                    <w:p><w:r><w:t>TESTO IN FORMA</w:t></w:r></w:p>
                    <w:p><w:r><w:t>seconda riga</w:t></w:r></w:p>
                  </w:txbxContent></wps:txbx>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p><w:r><w:t>ALTRO TESTO</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  const patched = patchDocumentForShapes(documentXml);
  console.log("=== PATCHED document.xml ===");
  console.log(patched);

  // ricostruisce un docx minimo con il document.xml patchato
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", patched);
  const ab = await zip.generateAsync({ type: "arraybuffer" });

  const result = await mammoth.convertToHtml({ arrayBuffer: ab });
  console.log("=== MAMMOTH OUTPUT (after patch) ===");
  console.log(result.value);

  const ok =
    result.value.includes("TESTO CORPO") &&
    result.value.includes("TESTO IN FORMA") &&
    result.value.includes("seconda riga") &&
    result.value.includes("ALTRO TESTO") &&
    result.value.indexOf("TESTO IN FORMA") < result.value.indexOf("seconda riga") &&
    result.value.indexOf("seconda riga") < result.value.indexOf("ALTRO TESTO");
  console.log(ok ? "PASS: shape text preserved in order" : "FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
