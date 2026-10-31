// Step 3c: convert a w:hdr / w:ftr part to HTML (text + alignment +
// image as data URI resolved from the part's own rels).
const { DOMParser } = require("/tmp/workbench/miniplm/node_modules/@xmldom/xmldom");
const JSZip = require("/tmp/workbench/miniplm/node_modules/jszip");

function children(parent, name) {
  const out = [];
  if (!parent) return out;
  const cs = parent.childNodes;
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].nodeType === 1 && cs[i].nodeName === name) out.push(cs[i]);
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jcValue(pPr) {
  const jc = pPr ? pPr.getElementsByTagName("w:jc") : null;
  if (!jc || jc.length === 0) return "";
  const v = (jc[0].getAttribute("w:val") || "").toLowerCase();
  if (v === "center" || v === "right" || v === "justify") return v;
  if (v === "both") return "justify";
  return "";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(binary, "binary").toString("base64");
}

function contentTypeFor(ext) {
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

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

function resolvePartPath(baseDir, target) {
  if (target.startsWith("/")) return normalizePath(target.slice(1));
  return normalizePath(baseDir + "/" + target);
}

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

async function imageToHtml(el, zip, rels, baseDir) {
  let rid = "";
  const blip = el.getElementsByTagName("a:blip");
  for (let i = 0; i < blip.length; i++) {
    rid = blip[i].getAttribute("r:embed") || "";
    if (rid) break;
  }
  if (!rid) {
    const vid = el.getElementsByTagName("v:imagedata");
    for (let i = 0; i < vid.length; i++) {
      rid = vid[i].getAttribute("r:id") || "";
      if (rid) break;
    }
  }
  if (!rid) return "";
  const target = rels[rid];
  if (!target) return "";
  const path = resolvePartPath(baseDir, target);
  const file = zip.file(path);
  if (!file) return "";
  const bytes = await file.async("uint8array");
  const ext = (path.split(".").pop() || "").toLowerCase();
  return `<img src="data:${contentTypeFor(ext)};base64,${bytesToBase64(bytes)}">`;
}

async function runToHtml(r, zip, rels, baseDir) {
  let openTags = "";
  let closeTags = "";
  const styles = [];
  const rPr = children(r, "w:rPr")[0];
  if (rPr) {
    if (children(rPr, "w:b").length > 0) { openTags += "<strong>"; closeTags = "</strong>" + closeTags; }
    if (children(rPr, "w:i").length > 0) { openTags += "<em>"; closeTags = "</em>" + closeTags; }
    const u = children(rPr, "w:u")[0];
    if (u && (u.getAttribute("w:val") || "").toLowerCase() !== "none") {
      openTags += "<u>"; closeTags = "</u>" + closeTags;
    }
    const sz = children(rPr, "w:sz")[0];
    if (sz) {
      const half = parseInt(sz.getAttribute("w:val") || "0", 10);
      if (half > 0) styles.push("font-size:" + (half / 2) + "pt");
    }
    const color = children(rPr, "w:color")[0];
    if (color) {
      const v = color.getAttribute("w:val") || "";
      if (v) styles.push("color:#" + v);
    }
  }
  let content = "";
  const cs = r.childNodes;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.nodeType !== 1) continue;
    if (c.nodeName === "w:t") content += escapeHtml(c.textContent || "");
    else if (c.nodeName === "w:tab") content += "\u00A0\u00A0";
    else if (c.nodeName === "w:br") content += "<br>";
    else if (c.nodeName === "w:fldSimple") {
      const runs = c.getElementsByTagName("w:r");
      for (let k = 0; k < runs.length; k++) content += await runToHtml(runs[k], zip, rels, baseDir);
    } else if (c.nodeName === "w:drawing" || c.nodeName === "w:pict") {
      content += await imageToHtml(c, zip, rels, baseDir);
    }
  }
  const styleAttr = styles.length ? ` style="${styles.join(";")}"` : "";
  return `<span${styleAttr}>${openTags}${content}${closeTags}</span>`;
}

async function paragraphToHtml(p, zip, rels, baseDir) {
  const pPr = children(p, "w:pPr")[0];
  const align = jcValue(pPr);
  let html = "";
  const cs = p.childNodes;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.nodeType !== 1) continue;
    if (c.nodeName === "w:r") html += await runToHtml(c, zip, rels, baseDir);
    else if (c.nodeName === "w:hyperlink") {
      const hid = c.getAttribute("r:id") || "";
      const href = hid && rels[hid] ? ` href="${escapeHtml(rels[hid])}"` : "";
      html += `<a${href}>`;
      const innerRuns = c.getElementsByTagName("w:r");
      for (let k = 0; k < innerRuns.length; k++) html += await runToHtml(innerRuns[k], zip, rels, baseDir);
      html += `</a>`;
    }
  }
  const style = align ? ` style="text-align:${align}"` : "";
  return `<p${style}>${html}</p>`;
}

async function headerFooterToHtml(partXml, zip, partPath) {
  const baseDir = partPath.includes("/") ? partPath.slice(0, partPath.lastIndexOf("/")) : "";
  const fileName = partPath.slice(partPath.lastIndexOf("/") + 1);
  const relsPath = (baseDir ? baseDir + "/" : "") + "_rels/" + fileName + ".rels";
  const relsFile = zip.file(relsPath);
  const rels = relsFile ? relsTargetMap(await relsFile.async("string")) : {};
  const doc = new DOMParser().parseFromString(partXml, "application/xml");
  const root = doc.documentElement;
  let html = "";
  const cs = root.childNodes;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.nodeType !== 1) continue;
    if (c.nodeName === "w:p") html += await paragraphToHtml(c, zip, rels, baseDir);
  }
  return html;
}

function assert(cond, msg) {
  if (!cond) { throw new Error("FAIL: " + msg); }
  console.log("PASS: " + msg);
}

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB" +
  "M6cXAAAAAElFTkSuQmCC";
const PNG_BUF = Buffer.from(PNG_B64, "base64");

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>TESTO HEADER</w:t></w:r></w:p>
  <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> italic</w:t></w:r></w:p>
  <w:p><w:r><w:drawing><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r></w:p>
</w:hdr>`;

const headerRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

(async () => {
  const zip = new JSZip();
  zip.file("word/header1.xml", headerXml);
  zip.file("word/_rels/header1.xml.rels", headerRels);
  zip.file("word/media/image1.png", PNG_BUF);

  const html = await headerFooterToHtml(headerXml, zip, "word/header1.xml");

  assert(html.includes('<p style="text-align:center">'), "center alignment");
  assert(html.includes("<strong><em>TESTO HEADER</em></strong>"), "bold+italic wrapping");
  assert(html.includes('<p style="text-align:right">'), "right alignment");
  assert(html.includes("<strong>bold</strong>"), "bold run");
  assert(html.includes("<em> italic</em>"), "italic run with leading space");
  assert(html.includes('<img src="data:image/png;base64,'), "image resolved as data URI");

  const justXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p></w:hdr>`;
  assert((await headerFooterToHtml(justXml, zip, "word/header1.xml")).includes("text-align:justify"), "both -> justify");

  const noAlign = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:hdr>`;
  assert((await headerFooterToHtml(noAlign, zip, "word/header1.xml")) === "<p><span>plain</span></p>", "no alignment -> plain paragraph");

  console.log("ALL 3c CHECKS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
