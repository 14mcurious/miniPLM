// E2E harness: runs the REAL compiled src/lib/docx-import.ts module
// (bundled by esbuild exactly as Vite would for the browser) against a
// realistic .docx fixture. Only runtime delta vs the browser: DOMParser
// is @xmldom instead of the native engine (same XML DOM semantics).
const esbuild = require("/tmp/workbench/miniplm/node_modules/esbuild");
const path = require("path");

const ROOT = "/tmp/workbench/miniplm";
const OUT = path.join(ROOT, ".scratch", "e2e-docx-import.cjs");

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/docx-import.ts")],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2020",
  outfile: OUT,
  logLevel: "silent",
});

// Browser globals the module relies on
const { DOMParser } = require("/tmp/workbench/miniplm/node_modules/@xmldom/xmldom");
global.DOMParser = DOMParser;

const JSZip = require("/tmp/workbench/miniplm/node_modules/jszip");

const { docxToHtml } = require(OUT);

// --- realistic fixture ------------------------------------------------------
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB" +
  "M6cXAAAAAElFTkSuQmCC";
const PNG_BUF = Buffer.from(PNG_B64, "base64");

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>PRIMO PARAGRAFO</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                  <wps:txbx><w:txbxContent>
                    <w:p><w:r><w:t>TESTO NELLA FORMA</w:t></w:r></w:p>
                  </w:txbxContent></wps:txbx>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"/>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill><a:blip r:embed="rId10"/></pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>punto uno</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>punto due</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>cella A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cella B1</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>cella A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cella B2</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:footerReference w:type="default" r:id="rId3"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>TESTO HEADER</w:t></w:r></w:p>
  <w:p><w:r><w:drawing><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r></w:p>
</w:hdr>`;

const headerRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>TESTO FOOTER</w:t></w:r></w:p>
</w:ftr>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

(async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", docRels);
  zip.file("word/header1.xml", headerXml);
  zip.file("word/_rels/header1.xml.rels", headerRels);
  zip.file("word/footer1.xml", footerXml);
  zip.file("word/numbering.xml", numberingXml);
  zip.file("word/media/image1.png", PNG_BUF);
  const ab = await zip.generateAsync({ type: "arraybuffer" });

  const file = new File([ab], "test.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const html = await docxToHtml(file);
  console.log("=== IMPORTED HTML ===");
  console.log(html);
  console.log("====================");

  assert(html.includes("PRIMO PARAGRAFO"), "body text present");
  assert(html.includes("TESTO NELLA FORMA"), "shape text preserved");
  assert(html.includes("<img src=\"data:image/png;base64,"), "body inline image as data URI");
  assert(html.includes("cella A1") && html.includes("cella B2"), "table cells present");
  assert(html.includes("<table"), "table element present");
  assert(html.includes("<ol") || html.includes("punto uno"), "numbered list present");
  const olCount = (html.match(/<ol[\s>]/g) || []).length;
  assert(olCount <= 1, `single ordered list for shared numId (found ${olCount} <ol>)`);
  assert(html.includes("<strong>TESTO HEADER</strong>"), "header text with bold");
  assert(html.includes("text-align:center"), "header alignment");
  assert(html.includes("TESTO FOOTER"), "footer text appended");
  const imgCount = (html.match(/<img /g) || []).length;
  assert(imgCount >= 2, `images in body AND header (found ${imgCount})`);
  assert(html.indexOf("TESTO HEADER") > html.indexOf("PRIMO PARAGRAFO"), "header after body");
  assert(html.indexOf("TESTO FOOTER") > html.indexOf("TESTO HEADER"), "footer after header");
  console.log("ALL E2E CHECKS PASSED");
  process.exit(0);
})().catch((e) => {
  console.error("E2E ERROR:", e);
  process.exit(1);
});
