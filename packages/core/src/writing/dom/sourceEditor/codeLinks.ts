// Marks the listings a manuscript copied from code files with the state of their copy, and runs "Insert code", "Update from code" and "Show differences" on the source editor.
// CONTRACT: documents/contracts/library-format.md#code-listings
import type { Text } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  buildCodeInsert, buildCodeUpdate, deriveListingStyle, describeCodeLinkState, diffCodeLink, findCodeLinkLines, formatError, resolveCodeLinks, scanCodeLinks,
  type CodeExcerpt, type ILogger, type ManuscriptCodeLink, type ResolvedCodeLink,
} from "../../../index.js";
import { showToast } from "../../../ui/dom/index.js";
import { pickCodeExcerpt, type CodePickMemory, type CodePickSource } from "./codePickDialog.js";
import { blockButton } from "./blockButton.js";
import { applyRangeEdit, createLinkController, insertBlock, openDiffDialog, type LinkActions, type LinkButton, type LinkController, type LinkMark, type LinkRuntime } from "./linkMarks.js";

const MODULE = "editor.codeLinks";

/** Where the code files are read, listed and browsed from (see CodePickSource): paths relative to the project folder. */
export type CodeFileSource = CodePickSource & {
  /** Opens a code file at a 1-based line, or at its start without one; a host that cannot open code files leaves it out and the editor shows no Open source button. */
  open?(path: string, line?: number): Promise<void>;
};

export interface CodeLinkDeps {
  language: "latex" | "typst";
  source: CodeFileSource;
  /** The project's own files, read for the preamble that decides between minted and listings. */
  files: { list(): Promise<string[]>; read(path: string): Promise<string> };
  logger: ILogger;
}

/** What the editor's actions run; each one acts on the editor it was made for. */
/** What the editor's code-link actions run: Insert code at the cursor, and Update from code and Show differences on the listing under it. */
export type CodeLinkActions = LinkActions;

export type CodeLinks = LinkController;

type Runtime = LinkRuntime<CodeLinkDeps>;

/** The opening comment of each listing with a state other than fresh; an unread file gives none. */
function toMarks(doc: Text, resolved: readonly ResolvedCodeLink[]): LinkMark[] {
  const marks: LinkMark[] = [];
  for (const entry of resolved) {
    const { state } = entry;
    const sentence = describeCodeLinkState(entry);
    if (state === undefined || state === "fresh" || sentence === undefined || entry.link.beginLine + 1 > doc.lines) continue;
    const line = doc.line(entry.link.beginLine + 1);
    const start = line.text.length - line.text.trimStart().length;
    if (start < line.length) marks.push({ from: line.from + start, to: line.to, state, sentence });
  }
  return marks;
}

/** The listing that starts on `line` with its state, or undefined (after a new refresh) when the text changed while the file was read. */
async function resolveLine(rt: Runtime, view: EditorView, line: number): Promise<ResolvedCodeLink | undefined> {
  const doc = view.state.doc;
  const found = (await resolveCodeLinks(rt.deps.language, doc.toString(), rt.deps.source)).find((entry) => entry.link.beginLine === line);
  if (found && view.state.doc === doc) return found;
  void rt.refresh(view);
  return undefined;
}

async function applyUpdate(rt: Runtime, view: EditorView, line: number): Promise<void> {
  const doc = view.state.doc;
  const found = await resolveLine(rt, view, line);
  if (!found) return;
  if (found.state !== "stale") {
    showToast(describeCodeLinkState(found) ?? "This listing is the same as the file's code.", "info");
    return;
  }
  const update = await buildCodeUpdate(rt.deps.language, doc.toString(), found);
  if (!update || view.state.doc !== doc) { void rt.refresh(view); return; }
  applyRangeEdit(view, doc, update);
  await rt.refresh(view);
}

async function showDiff(rt: Runtime, view: EditorView, line: number): Promise<void> {
  const found = await resolveLine(rt, view, line);
  if (!found) return;
  const { link, state } = found;
  if (state !== "stale" && state !== "diverged" && state !== "both") {
    showToast(describeCodeLinkState(found) ?? "This listing is the same as the file's code.", "info");
    return;
  }
  const texts = diffCodeLink(found);
  const name = link.anchor.kind === "symbol" ? link.anchor.name : link.path;
  openDiffDialog({
    view, title: `${name}: manuscript ↔ code`, subtitle: link.path,
    columns: [{ heading: "In the manuscript", text: texts.manuscript }, { heading: "In the file", text: texts.file }], updateLabel: "Update from code",
    update: state === "stale" ? () => void rt.guarded("update from the code", () => applyUpdate(rt, view, line)) : undefined,
  });
}

/** The hover's actions: Update from code for a stale listing, Show differences for any listing the file still has. */
const buttonsFor = (rt: Runtime) => (view: EditorView, mark: LinkMark, line: number): LinkButton[] => [
  ...(mark.state === "stale" ? [{ label: "Update from code", primary: true, run: () => applyUpdate(rt, view, line) }] : []),
  ...(mark.state !== "missing" ? [{ label: "Show differences", primary: false, run: () => showDiff(rt, view, line) }] : []),
];

const atCursor = (rt: Runtime, view: EditorView, act: (line: number) => Promise<void>): Promise<void> => rt.guarded("read the listing", async () => {
  const { doc } = view.state;
  const line = doc.lineAt(view.state.selection.main.head).number - 1;
  const found = scanCodeLinks(rt.deps.language, doc.toString()).find((link) => link.beginLine <= line && line <= link.endLine);
  if (!found) { showToast("Place the cursor on a listing inserted from a code file.", "info"); return; }
  await act(found.beginLine);
});

/** The manuscript texts that decide the listing style: this one and the project's LaTeX files with a preamble. */
async function preambleTexts(deps: CodeLinkDeps, current: string): Promise<string[]> {
  const paths = (await deps.files.list()).filter((path) => path.endsWith(".tex"));
  const texts = await Promise.all(paths.map((path) => deps.files.read(path).catch(() => "")));
  return [current, ...texts.filter((text) => text.includes("\\documentclass"))];
}

/** Writes the excerpt's listing at the cursor on lines of its own; resolves false when the code cannot be listed (said in a toast). */
async function insertExcerptBlock(deps: CodeLinkDeps, view: EditorView, excerpt: CodeExcerpt): Promise<boolean> {
  const { style, needsPackage } = deriveListingStyle(deps.language === "latex" ? await preambleTexts(deps, view.state.doc.toString()) : []);
  let block: string;
  try {
    block = await buildCodeInsert(deps.language, style, excerpt);
  } catch (error) {
    showToast(formatError(error), "info");
    return false;
  }
  insertBlock(view, block);
  if (deps.language === "latex" && needsPackage) showToast(`Add \\usepackage{${style === "minted" ? "minted" : "listings"}} to the preamble.`, "info");
  return true;
}

/** Insert code: the popup picks the file and the lines, and the listing goes at the cursor on lines of its own. */
const insertCode = (rt: Runtime, view: EditorView, memory: CodePickMemory): Promise<void> => rt.guarded("insert the code", async () => {
  const excerpt = await pickCodeExcerpt(rt.deps.source, memory);
  if (!excerpt) return;
  if (await insertExcerptBlock(rt.deps, view, excerpt)) await rt.refresh(view);
});

/** The code links of an editor, plus writing an excerpt picked elsewhere (a consult window) as Insert code writes it. */
export type CodeLinksWithExcerpts = CodeLinks & { insertExcerpt(view: EditorView, excerpt: CodeExcerpt): Promise<void> };

export function createCodeLinks(deps: CodeLinkDeps): CodeLinksWithExcerpts {
  // The file last picked opens first the next time, for this editor's life.
  const memory: CodePickMemory = {};
  const controller = createLinkController(deps, {
    module: MODULE, subject: "read the listing", refreshAction: "refreshCodeLinks",
    compute: async (_rt, text, doc) => toMarks(doc, await resolveCodeLinks(deps.language, text, deps.source)),
    buttonsFor, insert: (rt, view) => insertCode(rt, view, memory), atCursor, update: applyUpdate, showDiff,
  });
  return {
    ...controller,
    async insertExcerpt(view, excerpt) {
      try {
        if (await insertExcerptBlock(deps, view, excerpt)) await controller.refresh(view);
      } catch (error) {
        void deps.logger.error(MODULE, error, { action: "insertExcerpt", path: excerpt.path });
        showToast(`Could not insert the code: ${formatError(error)}`, "error");
      }
    },
  };
}

/** A listing's block, from its opening comment's line start to its closing comment's line end. */
interface ListingSpan { from: number; to: number; link: ManuscriptCodeLink }

function listingSpans(language: CodeLinkDeps["language"], text: string): ListingSpan[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  const lineEnd = (line: number): number => (line + 1 < starts.length ? starts[line + 1]! - 1 : text.length);
  return scanCodeLinks(language, text).map((link) => ({ from: starts[link.beginLine]!, to: lineEnd(link.endLine), link }));
}

/** Opens the listing's file at its definition or lines as they are now, or at the file's start when the file cannot be read or the code is gone. */
async function openSource(source: CodeFileSource, link: ManuscriptCodeLink, logger: ILogger): Promise<void> {
  let line: number | undefined;
  try {
    const text = await source.read(link.path);
    line = text === undefined ? undefined : findCodeLinkLines(link, text)?.start;
  } catch {
    line = undefined;
  }
  try {
    await source.open!(link.path, line);
  } catch (error) {
    void logger.error(MODULE, error, { action: "openCodeSource", path: link.path });
    showToast(`Could not open ${link.path}: ${formatError(error)}`, "error");
  }
}

/** The Open source button over the listings copied from code files; none when the host cannot open code files. */
export function codeSourceButton(language: CodeLinkDeps["language"], source: CodeFileSource, logger: ILogger): Extension {
  if (!source.open) return [];
  return blockButton<ListingSpan>({
    className: "ls-code-source", label: "Open source", title: "Open the code this listing was copied from", icon: "external", readOnly: true,
    spans: (text) => listingSpans(language, text), run: (_view, span) => void openSource(source, span.link, logger),
  });
}
