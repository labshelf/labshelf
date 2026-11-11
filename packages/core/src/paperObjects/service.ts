// Answers a note editor's questions about a paper's equations, figures and tables, and builds the Markdown to insert for one.
// CONTRACT: documents/contracts/qmd-items.md#paper-objects
import { formatPaperLink } from "../library/record.js";
import type { ILogger } from "../ports/index.js";
import type { EquationPort } from "../reader/hostPorts.js";
import { analysePdfPage, boxToRegion, deriveRegionLines, listPaperObjects, type PdfPageText } from "./list.js";
import { formatPipeTable, parsePipeTable, tableFromTextItems } from "./tables.js";
import { tableFromTabular } from "./tabular.js";
import type { PageBox, PaperChoice, PaperObject, PaperObjectInsert, PaperObjectInsertOptions, PaperObjectsPort, PaperObjectVia } from "./types.js";

const MODULE = "paperObjects/service";
/** The message of a rejected `list` for a paper without a readable PDF; the picker shows it as is. */
const NO_PDF = "This paper has no PDF.";

// ---- the inserted Markdown ----

/** What was read for the object: LaTeX of an equation, a pipe table, or the PNG of its region. */
export type PaperObjectContent =
  | { kind: "latex"; latex: string }
  | { kind: "table"; markdown: string }
  | { kind: "image"; png: Uint8Array };

export interface PaperObjectMarkdownInput {
  paper: { citeKey: string | null; title: string };
  object: PaperObject;
  content: PaperObjectContent;
  options: PaperObjectInsertOptions;
}

function objectName(object: PaperObject): string {
  if (object.kind === "equation") { return `Eq. (${object.label})`; }
  return `${object.kind === "figure" ? "Figure" : "Table"} ${object.label}`;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The equation label `<cite key slug>-<label>` (`paper-…` without a cite key), with characters outside
 * `[A-Za-z0-9_]` in the printed label turned into `-`, made unique against `taken` by `-2`, `-3`, …
 */
export function derivePaperEquationLabel(citeKey: string | null, label: string, taken: readonly string[]): string {
  const base = `${slug(citeKey ?? "") || "paper"}-${label.replace(/[^A-Za-z0-9_]/g, "-")}`;
  const used = new Set(taken);
  if (!used.has(base)) { return base; }
  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) { return `${base}-${n}`; }
  }
}

// Plain text that must read back as the same text: no emphasis, links, code or block markers.
function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, "\\$&").replace(/^([#>+-])/, "\\$1").replace(/\s+/g, " ").trim();
}

function linkLine(input: PaperObjectMarkdownInput): string {
  const { paper, object } = input;
  const text = `${objectName(object)}, p. ${object.page}`;
  if (paper.citeKey === null) { return `${escapeText(paper.title)}, ${text}`; }
  return `[${paper.citeKey}, ${text}](${formatPaperLink({ citeKey: paper.citeKey, page: object.page, box: object.box })})`;
}

/**
 * The blocks a note inserts for a paper object, separated by one blank line, the paper link line last:
 * - LaTeX: `$$` … `$$ {#eq-<label>}`;
 * - a table: the pipe table as given;
 * - an image: `![<cite key>, Figure 2](assets/<asset name>.png)` and that PNG among the assets.
 */
export function buildPaperObjectMarkdown(input: PaperObjectMarkdownInput): Omit<PaperObjectInsert, "via"> {
  const { paper, object, content, options } = input;
  const link = linkLine(input);
  switch (content.kind) {
    case "latex": {
      const label = derivePaperEquationLabel(paper.citeKey, object.label, options.takenLabels);
      return { markdown: `$$\n${content.latex.trim()}\n$$ {#eq-${label}}\n\n${link}`, assets: [] };
    }
    case "table":
      return { markdown: `${content.markdown.trim()}\n\n${link}`, assets: [] };
    case "image": {
      const path = `assets/${options.assetName}.png`;
      const alt = `${paper.citeKey ?? paper.title}, ${objectName(object)}`.replace(/\s+/g, " ").replace(/[[\]\\]/g, "\\$&");
      return { markdown: `![${alt}](${path})\n\n${link}`, assets: [{ path, bytes: content.png }] };
    }
  }
}

// ---- the service ----

/** Renders a page region as a PNG, black on white, like the reader's equation crop. */
export type RegionRenderer = (page: number, box: PageBox) => Promise<Uint8Array>;

/** What a host supplies: library lookups, the PDF's text and rendering, and the optional exact sources. */
export interface PaperObjectServiceDeps {
  papers(query: string): Promise<PaperChoice[]>;
  /** The paper's cite key and title; null when the library has no such paper. */
  paperInfo(paperId: string): Promise<{ citeKey: string | null; title: string } | null>;
  /** The text of the paper's PDF pages (`readPdfPages` over pdf.js); null when the paper has no readable PDF. Read once per paper. */
  pages(paperId: string): Promise<PdfPageText[] | null>;
  /** The `RegionRenderer` of the paper's PDF. */
  render(paperId: string, page: number, box: PageBox): Promise<Uint8Array>;
  /** The host's equation chain (arXiv, pix2tex, AI vision). */
  equation?: EquationPort;
  /** Reads a table image as a pipe table (`createAiVisionTableReader`). */
  tableVision?: (png: Uint8Array) => Promise<string | null>;
  /** The paper's flattened main TeX file from its arXiv source. */
  eprintTex?: (paperId: string) => Promise<string | null>;
  logger: ILogger;
}

interface Read { content: PaperObjectContent; via: PaperObjectVia }

export function createPaperObjectService(deps: PaperObjectServiceDeps): PaperObjectsPort {
  const pageCache = new Map<string, Promise<PdfPageText[] | null>>();
  const listCache = new Map<string, Promise<PaperObject[]>>();

  function pagesOf(paperId: string): Promise<PdfPageText[] | null> {
    let cached = pageCache.get(paperId);
    if (!cached) {
      cached = deps.pages(paperId);
      pageCache.set(paperId, cached);
      cached.catch(() => { pageCache.delete(paperId); });
    }
    return cached;
  }

  async function step<T>(name: string, paperId: string, object: PaperObject, run: () => Promise<T | null>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      void deps.logger.error(MODULE, error, { step: name, paperId, kind: object.kind, label: object.label });
      return null;
    }
  }

  async function pageOf(paperId: string, pageNumber: number): Promise<PdfPageText | null> {
    return (await pagesOf(paperId))?.find((p) => p.pageNumber === pageNumber) ?? null;
  }

  async function readEquation(paperId: string, object: PaperObject, png: () => Promise<Uint8Array>): Promise<Read | null> {
    const port = deps.equation;
    if (!port) { return null; }
    const page = await pageOf(paperId, object.page);
    if (!page) { return null; }
    const rect = boxToRegion(object.box, page.width, page.height);
    const text = deriveRegionLines(analysePdfPage(page).lines, rect).map((l) => l.text).join("\n");
    const outcome = await port.extract({ paperId, pageNumber: object.page, rect, text, png: await png().catch(() => new Uint8Array()) }, () => {});
    return outcome.kind === "latex" ? { content: { kind: "latex", latex: outcome.latex }, via: outcome.source } : null;
  }

  async function readTable(paperId: string, object: PaperObject, png: () => Promise<Uint8Array>): Promise<Read | null> {
    const asTable = (rows: string[][] | null, via: PaperObjectVia): Read | null =>
      rows ? { content: { kind: "table", markdown: formatPipeTable(rows) }, via } : null;
    const tex = deps.eprintTex;
    const fromSource = tex
      ? await step("arxiv", paperId, object, async () => {
        const source = await tex(paperId);
        return source === null ? null : asTable(tableFromTabular(source, object.label), "arxiv");
      })
      : null;
    if (fromSource) { return fromSource; }
    const fromText = await step("pdf-text", paperId, object, async () => {
      const page = await pageOf(paperId, object.page);
      return page ? asTable(tableFromTextItems(page.items, boxToRegion(object.box, page.width, page.height)), "pdf-text") : null;
    });
    if (fromText) { return fromText; }
    const vision = deps.tableVision;
    if (!vision) { return null; }
    return step("ai", paperId, object, async () => {
      const reply = await vision(await png());
      const rows = reply === null ? null : parsePipeTable(reply);
      return rows && rows[0]!.length >= 2 ? asTable(rows, "ai") : null;
    });
  }

  return {
    papers: (query) => deps.papers(query),

    list(paperId) {
      let cached = listCache.get(paperId);
      if (!cached) {
        cached = pagesOf(paperId).catch((error: unknown) => {
          void deps.logger.error(MODULE, error, { step: "list", paperId });
          return null;
        }).then((pages) => {
          if (pages === null) { throw new Error(NO_PDF); }
          return listPaperObjects(pages);
        });
        // A paper whose PDF arrives later is listed on the next call.
        cached.catch(() => { listCache.delete(paperId); });
        listCache.set(paperId, cached);
      }
      return cached;
    },

    async preview(paperId, object) {
      try {
        return await deps.render(paperId, object.page, object.box);
      } catch (error) {
        void deps.logger.error(MODULE, error, { step: "preview", paperId, kind: object.kind, label: object.label });
        return null;
      }
    },

    async insert(paperId, object, options): Promise<PaperObjectInsert> {
      const paper = (await step("paperInfo", paperId, object, () => deps.paperInfo(paperId))) ?? { citeKey: null, title: "Untitled paper" };
      let rendered: Promise<Uint8Array> | null = null;
      const png = (): Promise<Uint8Array> => (rendered ??= deps.render(paperId, object.page, object.box));
      let read: Read | null = null;
      if (!options.asImage && object.kind === "equation") { read = await step("equation", paperId, object, () => readEquation(paperId, object, png)); }
      if (!options.asImage && object.kind === "table") { read = await readTable(paperId, object, png); }
      // Only the image itself may fail the insert: there is nothing left to fall back to.
      const final = read ?? { content: { kind: "image", png: await png() }, via: "image" as const };
      return { ...buildPaperObjectMarkdown({ paper, object, content: final.content, options }), via: final.via };
    },
  };
}
