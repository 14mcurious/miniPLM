import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
  type IParagraphOptions,
} from "docx";
import { marked, type Token, type Tokens } from "marked";

/**
 * Markdown → DOCX export (client-side).
 *
 * The markdown source is tokenized with `marked` (the same GFM options the
 * app uses to render "md" fields, see lib/markdown) and the token tree is
 * mapped onto `docx` structures: headings, paragraphs, lists (including
 * nested and task lists), code blocks, blockquotes, tables and horizontal
 * rules. Raw HTML blocks are skipped: they cannot be represented in Word.
 *
 * The generated document is packed in the browser and downloaded as a
 * `.docx` file. No backend round-trip is needed.
 */

const CODE_FONT = "Consolas";
const CODE_FILL = "F2F2F2";
const MUTED = "808080";
const NUMBERED_REF = "md-numbered";
const MAX_LIST_LEVEL = 8;

/** Same scheme the HTML sanitizer uses for href/src validation. */
const SAFE_URL_RE = /^(https?:|mailto:)/i;

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
}

interface RenderState {
  /** Monotonic id so every list token gets its own Word numbering instance. */
  listInstance: number;
}

interface RenderCtx {
  quote: number;
  state: RenderState;
}

function quoteIndent(ctx: RenderCtx): Partial<IParagraphOptions> {
  return ctx.quote > 0 ? { indent: { left: 720 * ctx.quote } } : {};
}

function isSafeUrl(url: string): boolean {
  return SAFE_URL_RE.test(url.trim());
}

/** Map inline marked tokens to Word runs; links become external hyperlinks. */
function inlineToRuns(
  tokens: Token[] | undefined,
  style: RunStyle = {}
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong":
        out.push(
          ...inlineToRuns((token as Tokens.Strong).tokens, {
            ...style,
            bold: true,
          })
        );
        break;
      case "em":
        out.push(
          ...inlineToRuns((token as Tokens.Em).tokens, {
            ...style,
            italics: true,
          })
        );
        break;
      case "del":
        out.push(
          ...inlineToRuns((token as Tokens.Del).tokens, {
            ...style,
            strike: true,
          })
        );
        break;
      case "codespan":
        out.push(
          new TextRun({
            text: (token as Tokens.Codespan).text,
            font: CODE_FONT,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL },
            ...style,
          })
        );
        break;
      case "br":
        out.push(new TextRun({ break: 1, ...style }));
        break;
      case "escape":
        out.push(
          new TextRun({ text: (token as Tokens.Escape).text, ...style })
        );
        break;
      case "link": {
        const link = token as Tokens.Link;
        const label = inlineToRuns(link.tokens, style);
        if (!label.length) {
          out.push(new TextRun({ text: link.href, ...style }));
          break;
        }
        if (isSafeUrl(link.href)) {
          out.push(
            new ExternalHyperlink({
              children: label,
              link: link.href,
            })
          );
        } else {
          out.push(
            ...label,
            new TextRun({
              text: ` (${link.href})`,
              color: MUTED,
              ...style,
            })
          );
        }
        break;
      }
      case "image": {
        const image = token as Tokens.Image;
        const caption = image.text || image.href;
        const runs = [
          new TextRun({
            text: `[${caption}]`,
            italics: true,
            color: MUTED,
            ...style,
          }),
        ];
        if (isSafeUrl(image.href)) {
          out.push(
            new ExternalHyperlink({ children: runs, link: image.href })
          );
        } else {
          out.push(...runs);
        }
        break;
      }
      case "text": {
        const text = token as Tokens.Text;
        // A block-level text token carries the already-tokenized inline
        // children; an inline text token (or one inside a raw HTML block)
        // is literal content.
        if (text.tokens && text.tokens.length > 0 && !text.escaped) {
          out.push(...inlineToRuns(text.tokens, style));
        } else {
          out.push(new TextRun({ text: text.text, ...style }));
        }
        break;
      }
      default:
        // Raw HTML, checkboxes and unknown tokens are not representable.
        break;
    }
  }
  return out;
}

/** Inline runs of the block-level text/paragraph tokens of a list item. */
function itemInlineRuns(itemTokens: Token[]): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  for (const token of itemTokens) {
    if (
      (token.type === "text" || token.type === "paragraph") &&
      !itemBlocks(token)
    ) {
      runs.push(
        ...inlineToRuns((token as Tokens.Text).tokens ?? undefined)
      );
    }
  }
  return runs;
}

/** Whether a list-item token is a nested block (list, code, table, ...). */
function itemBlocks(token: Token): boolean {
  return (
    token.type === "list" ||
    token.type === "code" ||
    token.type === "blockquote" ||
    token.type === "table" ||
    token.type === "hr" ||
    token.type === "heading"
  );
}

function renderTable(token: Tokens.Table, ctx: RenderCtx): Table {
  const makeCell = (cell: Tokens.TableCell, isHeader: boolean) =>
    new TableCell({
      children: [
        new Paragraph({
          children: inlineToRuns(cell.tokens, isHeader ? { bold: true } : {}),
          ...quoteIndent(ctx),
        }),
      ],
    });
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: token.header.map((cell) => makeCell(cell, true)),
    }),
    ...token.rows.map(
      (row) =>
        new TableRow({ children: row.map((cell) => makeCell(cell, false)) })
    ),
  ];
  const border = { style: BorderStyle.SINGLE, size: 4, color: "auto" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows,
  });
}

function renderList(
  token: Tokens.List,
  level: number,
  ctx: RenderCtx
): Array<Paragraph | Table> {
  const listLevel = Math.min(level, MAX_LIST_LEVEL);
  const instance = ctx.state.listInstance++;
  const out: Array<Paragraph | Table> = [];
  for (const item of token.items) {
    const listItem = item as Tokens.ListItem;
    let checkbox: Tokens.Checkbox | null = null;
    const content: Token[] = [];
    for (const t of listItem.tokens ?? []) {
      if (t.type === "checkbox" && !checkbox) {
        checkbox = t as Tokens.Checkbox;
      } else {
        content.push(t);
      }
    }
    const itemRuns = itemInlineRuns(content.filter((t) => !itemBlocks(t)));
    const prefix: ParagraphChild[] = [];
    if (checkbox) {
      prefix.push(
        new TextRun({
          text: checkbox.checked ? "☑ " : "☐ ",
          color: checkbox.checked ? "1F7A1F" : MUTED,
        })
      );
    }
    const itemProps: Partial<IParagraphOptions> = token.ordered
      ? {
          numbering: {
            reference: NUMBERED_REF,
            level: listLevel,
            instance,
          },
        }
      : { bullet: { level: listLevel } };
    if (itemRuns.length || prefix.length) {
      out.push(
        new Paragraph({
          children: [...prefix, ...itemRuns],
          ...itemProps,
        })
      );
    }
    for (const nested of content) {
      if (nested.type === "list") {
        out.push(...renderList(nested as Tokens.List, listLevel + 1, ctx));
      } else if (itemBlocks(nested)) {
        out.push(...renderBlocks([nested], ctx));
      }
    }
  }
  return out;
}

/** Map marked block tokens to Word paragraphs (and tables). */
function renderBlocks(
  tokens: Token[],
  ctx: RenderCtx
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const heading = token as Tokens.Heading;
        const depth = Math.min(Math.max(heading.depth, 1), 6);
        out.push(
          new Paragraph({
            heading: HEADING_LEVELS[depth - 1],
            children: inlineToRuns(heading.tokens),
          })
        );
        break;
      }
      case "paragraph":
      case "text": {
        const runs = inlineToRuns(
          (token as Tokens.Paragraph).tokens ?? undefined
        );
        if (runs.length) {
          out.push(
            new Paragraph({
              children: runs,
              ...quoteIndent(ctx),
            })
          );
        }
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        const lines = code.text.replace(/\n+$/, "").split("\n");
        for (const line of lines) {
          out.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: line.length ? line : " ",
                  font: CODE_FONT,
                  size: 18,
                }),
              ],
              shading: {
                type: ShadingType.CLEAR,
                color: "auto",
                fill: CODE_FILL,
              },
              spacing: { before: 0, after: 0, line: 276 },
              ...quoteIndent(ctx),
            })
          );
        }
        break;
      }
      case "blockquote":
        out.push(
          ...renderBlocks((token as Tokens.Blockquote).tokens, {
            ...ctx,
            quote: ctx.quote + 1,
          })
        );
        break;
      case "list":
        out.push(...renderList(token as Tokens.List, 0, ctx));
        break;
      case "table":
        out.push(renderTable(token as Tokens.Table, ctx));
        break;
      case "hr":
        out.push(
          new Paragraph({
            children: [],
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: "auto",
              },
            },
            ...quoteIndent(ctx),
          })
        );
        break;
      default:
        // space / html / def / unknown tokens are skipped.
        break;
    }
  }
  return out;
}

/** Build a Word document from a markdown source. */
export function markdownToDocx(source: string): Document {
  const tokens = marked.lexer(source, { gfm: true, breaks: true });
  const children = renderBlocks(tokens, { quote: 0, state: { listInstance: 0 } });
  if (!children.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
  }
  return new Document({
    numbering: {
      config: [
        {
          reference: NUMBERED_REF,
          levels: Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: 360 + level * 360, hanging: 360 },
              },
            },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
}

/** Sanitize a file-system friendly export file name. */
export function docxFileName(base: string): string {
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${cleaned || "documento"}.docx`;
}

/** Generate the .docx file and trigger a browser download. */
export async function exportMarkdownToDocx(
  source: string,
  fileName: string
): Promise<void> {
  const doc = markdownToDocx(source);
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
