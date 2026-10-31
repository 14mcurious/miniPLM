/**
 * DOCX -> HTML import pipeline for the HTML field editor.
 *
 * `mammoth` (browser bundle, lazy-loaded) converts the document body well,
 * including inline images as data URIs, but it silently drops (with no
 * warning message) two kinds of content:
 *
 * 1. text-only shapes (`w:drawing`/`w:pict` without an `a:blip` image) -
 *    e.g. autoshapes with text boxes;
 * 2. header/footer parts (`word/header*.xml`, `word/footer*.xml`).
 *
 * This module compensates for both:
 *
 * - Step 1: pre-process `word/document.xml` - replace drawings/picts
 *   without an image with plain text paragraphs (shape text is kept in
 *   document order);
 * - Step 2: run mammoth on the patched package for the body;
 * - Step 3: convert every referenced header/footer part to HTML (text
 *   runs, bold/italic/underline, font size/color, paragraph alignment,
 *   hyperlinks, images as data URIs resolved through the part's own
 *   rels) and append it after the body.
 *
 * All helpers below were validated against the real mammoth 1.13 browser
 * bundle and synthetic OOXML fixtures (see `.scratch/` probe scripts).
 */

import type JSZip from "jszip";
import type { convertToHtml } from "mammoth";

type MammothBrowserModule = {
  default: { convertToHtml: typeof convertToHtml };
};

// ---------------------------------------------------------------------------
// XML helpers (browser DOMParser; no Node dependency)
// ---------------------------------------------------------------------------

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function escapeAttr(v: string): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(v: string): string {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(v: string): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Serialize an XML element (attributes + element/text children). */
function serializeXml(node: Element): string {
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
      out += serializeXml(child as Element);
    } else if (child.nodeType === 3 || child.nodeType === 4) {
      out += escapeText(child.nodeValue || "");
    }
  }
  out += `</${node.nodeName}>`;
  return out;
}

/** Direct element children of `parent` with the given (namespaced) node name. */
function localChildren(parent: Element | null, name: string): Element[] {
  const out: Element[] = [];
  const children = parent ? parent.childNodes : null;
  if (!children) return out;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1 && child.nodeName === name) out.push(child as Element);
  }
  return out;
}

function contains(ancestor: Node, node: Node): boolean {
  let n: Node | null = node;
  while (n) {
    if (n === ancestor) return true;
    n = n.parentNode;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 1: shape pre-processing (document.xml)
// ---------------------------------------------------------------------------

function paragraphText(p: Element): string {
  const ts = p.getElementsByTagName("w:t");
  let text = "";
  for (let i = 0; i < ts.length; i++) {
    text += ts[i].textContent || "";
  }
  return text;
}

function aParagraphText(p: Element): string {
  const ts = p.getElementsByTagName("a:t");
  let text = "";
  for (let i = 0; i < ts.length; i++) {
    text += ts[i].textContent || "";
  }
  return text;
}

/** Text lines of a shape, in document order (text boxes first, then a:p). */
function extractShapeLines(el: Element): string[] {
  const lines: string[] = [];
  const boxes = el.getElementsByTagName("w:txbxContent");
  if (boxes.length > 0) {
    for (let b = 0; b < boxes.length; b++) {
      const ps = boxes[b].getElementsByTagName("w:p");
      for (let i = 0; i < ps.length; i++) lines.push(paragraphText(ps[i]));
    }
    return lines;
  }
  const ps = el.getElementsByTagName("a:p");
  for (let i = 0; i < ps.length; i++) lines.push(aParagraphText(ps[i]));
  return lines;
}

function makeTextParagraph(doc: Document, text: string): Element {
  const p = doc.createElement("w:p");
  const r = doc.createElement("w:r");
  const t = doc.createElement("w:t");
  t.setAttribute("xml:space", "preserve");
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);
  return p;
}

function hasOtherText(p: Element, excluded: Element): boolean {
  const ts = p.getElementsByTagName("w:t");
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] === excluded) continue;
    if (contains(excluded, ts[i])) continue;
    if ((ts[i].textContent || "").trim() !== "") return true;
  }
  return false;
}

function hasOtherImageOrShape(p: Element, excluded: Element): boolean {
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

function replaceNodeWith(parent: Node, oldNode: Node, newNodes: Element[]): void {
  let anchor: Node = oldNode;
  for (const nn of newNodes) {
    parent.insertBefore(nn, anchor.nextSibling);
    anchor = nn;
  }
  parent.removeChild(oldNode);
}

function patchDrawingOrPict(doc: Document, el: Element, isPict: boolean): void {
  const hasBlip = el.getElementsByTagName("a:blip").length > 0;
  const hasImageData = isPict && el.getElementsByTagName("v:imagedata").length > 0;
  if (hasBlip || hasImageData) return; // an image is present: mammoth extracts it
  const lines = extractShapeLines(el).filter((l) => l.length > 0);
  if (lines.length === 0) {
    if (el.parentNode) el.parentNode.removeChild(el);
    return;
  }
  const run = el.parentNode as Element | null; // w:r (usually)
  const p = run ? (run.parentNode as Element | null) : null; // w:p (usually)
  if (
    run &&
    run.nodeName === "w:r" &&
    p &&
    p.nodeName === "w:p" &&
    p.parentNode &&
    !hasOtherText(p, el) &&
    !hasOtherImageOrShape(p, el)
  ) {
    // The paragraph holds only this shape: replace the whole paragraph.
    const newParagraphs = lines.map((l) => makeTextParagraph(doc, l));
    replaceNodeWith(p.parentNode as Node, p, newParagraphs);
  } else {
    // Mixed context: inline the text as a single w:t (space-joined lines).
    const t = doc.createElement("w:t");
    t.setAttribute("xml:space", "preserve");
    t.textContent = lines.join(" ");
    if (el.parentNode) el.parentNode.replaceChild(t, el);
  }
}

/**
 * Patch `word/document.xml` so mammoth keeps shape text.
 * Drawings first, then picts (the DOM mutates while walking).
 */
function patchDocumentForShapes(xml: string): string {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const drawings = Array.from(root.getElementsByTagName("w:drawing"));
  for (const d of drawings) patchDrawingOrPict(doc, d, false);
  const picts = Array.from(root.getElementsByTagName("w:pict"));
  for (const p of picts) patchDrawingOrPict(doc, p, true);
  return serializeXml(root);
}

// ---------------------------------------------------------------------------
// Step 3a/3b: section references + relationship resolution
// ---------------------------------------------------------------------------

/**
 * Parse document.xml and return the ordered, deduplicated list of
 * section-part relationship ids (`w:headerReference` /
 * `w:footerReference`), in document order.
 */
function getSectionReferences(docXml: string, kind: "header" | "footer"): string[] {
  const tagName = kind === "header" ? "w:headerReference" : "w:footerReference";
  const doc = parseXml(docXml);
  const refs = doc.getElementsByTagName(tagName);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const rid = refs[i].getAttribute("r:id") || "";
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);
    out.push(rid);
  }
  return out;
}

/** Parse a `.rels` part and return `{ Id: Target }`. */
function relsTargetMap(relsXml: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!relsXml) return out;
  const doc = parseXml(relsXml);
  const rels = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const id = rels[i].getAttribute("Id") || "";
    const target = rels[i].getAttribute("Target") || "";
    if (id) out[id] = target;
  }
  return out;
}

/** Normalize a package path, collapsing `.` and `..` segments. */
function normalizePath(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Resolve a relationship Target against the directory of the part that owns
 * the rels. A leading "/" means package-root absolute.
 */
function resolvePartPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) {
    return normalizePath(target.slice(1));
  }
  return normalizePath(baseDir + "/" + target);
}

// ---------------------------------------------------------------------------
// Step 3c: header/footer part -> HTML
// ---------------------------------------------------------------------------

function contentTypeFor(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function jcValue(pPr: Element | undefined): string {
  const jc = pPr ? pPr.getElementsByTagName("w:jc") : null;
  if (!jc || jc.length === 0) return "";
  const v = (jc[0].getAttribute("w:val") || "").toLowerCase();
  if (v === "center" || v === "right" || v === "justify") return v;
  if (v === "both") return "justify";
  return "";
}

async function imageToHtml(
  el: Element,
  zip: JSZip,
  rels: Record<string, string>,
  baseDir: string
): Promise<string> {
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

async function runToHtml(
  r: Element,
  zip: JSZip,
  rels: Record<string, string>,
  baseDir: string
): Promise<string> {
  let openTags = "";
  let closeTags = "";
  const styles: string[] = [];
  const rPr = localChildren(r, "w:rPr")[0];
  if (rPr) {
    if (localChildren(rPr, "w:b").length > 0) {
      openTags += "<strong>";
      closeTags = "</strong>" + closeTags;
    }
    if (localChildren(rPr, "w:i").length > 0) {
      openTags += "<em>";
      closeTags = "</em>" + closeTags;
    }
    const u = localChildren(rPr, "w:u")[0];
    if (u && (u.getAttribute("w:val") || "").toLowerCase() !== "none") {
      openTags += "<u>";
      closeTags = "</u>" + closeTags;
    }
    const sz = localChildren(rPr, "w:sz")[0];
    if (sz) {
      const half = parseInt(sz.getAttribute("w:val") || "0", 10);
      if (half > 0) styles.push("font-size:" + half / 2 + "pt");
    }
    const color = localChildren(rPr, "w:color")[0];
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
    const ce = c as Element;
    if (ce.nodeName === "w:t") content += escapeHtml(ce.textContent || "");
    else if (ce.nodeName === "w:tab") content += "\u00A0\u00A0";
    else if (ce.nodeName === "w:br") content += "<br>";
    else if (ce.nodeName === "w:fldSimple") {
      const runs = ce.getElementsByTagName("w:r");
      for (let k = 0; k < runs.length; k++) {
        content += await runToHtml(runs[k], zip, rels, baseDir);
      }
    } else if (ce.nodeName === "w:drawing" || ce.nodeName === "w:pict") {
      content += await imageToHtml(ce, zip, rels, baseDir);
    }
  }
  const styleAttr = styles.length ? ` style="${styles.join(";")}"` : "";
  return `<span${styleAttr}>${openTags}${content}${closeTags}</span>`;
}

async function paragraphToHtml(
  p: Element,
  zip: JSZip,
  rels: Record<string, string>,
  baseDir: string
): Promise<string> {
  const pPr = localChildren(p, "w:pPr")[0];
  const align = jcValue(pPr);
  let html = "";
  const cs = p.childNodes;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.nodeType !== 1) continue;
    const ce = c as Element;
    if (ce.nodeName === "w:r") html += await runToHtml(ce, zip, rels, baseDir);
    else if (ce.nodeName === "w:hyperlink") {
      const hid = ce.getAttribute("r:id") || "";
      const href = hid && rels[hid] ? ` href="${escapeHtml(rels[hid])}"` : "";
      html += `<a${href}>`;
      const innerRuns = ce.getElementsByTagName("w:r");
      for (let k = 0; k < innerRuns.length; k++) {
        html += await runToHtml(innerRuns[k], zip, rels, baseDir);
      }
      html += `</a>`;
    }
  }
  const style = align ? ` style="text-align:${align}"` : "";
  return `<p${style}>${html}</p>`;
}

/** Convert a `w:hdr` / `w:ftr` part to HTML (its rels resolve its images). */
async function headerFooterToHtml(partXml: string, zip: JSZip, partPath: string): Promise<string> {
  const baseDir = partPath.includes("/") ? partPath.slice(0, partPath.lastIndexOf("/")) : "";
  const fileName = partPath.slice(partPath.lastIndexOf("/") + 1);
  const relsPath = (baseDir ? baseDir + "/" : "") + "_rels/" + fileName + ".rels";
  const relsFile = zip.file(relsPath);
  const rels = relsTargetMap(relsFile ? await relsFile.async("string") : null);
  const doc = parseXml(partXml);
  const root = doc.documentElement;
  let html = "";
  const cs = root.childNodes;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.nodeType !== 1) continue;
    if ((c as Element).nodeName === "w:p") {
      html += await paragraphToHtml(c as Element, zip, rels, baseDir);
    }
  }
  return html;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a .docx file to an HTML body fragment (appended to the editor
 * document). Throws on invalid or empty documents.
 *
 * Note: the mammoth 1.13 browser bundle only accepts `{ arrayBuffer }`
 * (see its `browser/unzip.js`); passing `{ buffer }` makes every import
 * fail with "Could not find file in options".
 */
export async function docxToHtml(file: File): Promise<string> {
  // Lazy-load so the zip library stays out of the main bundle.
  const { default: JSZipCtor } = await import("jszip");
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZipCtor.loadAsync(arrayBuffer);

  const docEntry = zip.file("word/document.xml");
  if (!docEntry) {
    throw new Error("invalid document: word/document.xml missing");
  }
  let docXml = await docEntry.async("string");

  // Step 1: keep shape text that mammoth would drop.
  docXml = patchDocumentForShapes(docXml);
  zip.file("word/document.xml", docXml);

  // Step 2: body via mammoth on the patched package.
  const patched = await zip.generateAsync({ type: "arraybuffer" });
  const mod = (await import("mammoth/mammoth.browser")) as MammothBrowserModule;
  const result = await mod.default.convertToHtml({ arrayBuffer: patched });
  let html = result.value || "";

  // Step 3: header/footer parts that mammoth drops silently.
  const relsEntry = zip.file("word/_rels/document.xml.rels");
  const rels = relsTargetMap(relsEntry ? await relsEntry.async("string") : null);
  const sectionRefs = [
    ...getSectionReferences(docXml, "header"),
    ...getSectionReferences(docXml, "footer"),
  ];
  const parts: string[] = [];
  for (const rid of sectionRefs) {
    const target = rels[rid];
    if (!target) continue;
    const partPath = resolvePartPath("word", target);
    const partEntry = zip.file(partPath);
    if (!partEntry) continue;
    const partXml = await partEntry.async("string");
    const partHtml = await headerFooterToHtml(partXml, zip, partPath);
    if (partHtml.trim()) parts.push(partHtml);
  }
  html += parts.join("");

  if (!html.trim()) {
    throw new Error("empty document");
  }
  return html;
}
