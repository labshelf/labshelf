// Marks the listings a manuscript copied from code files with the state of their copy, and runs "Insert code", "Update from code" and "Show differences" on the source editor.
// CONTRACT: documents/contracts/library-format.md#code-listings
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  buildCodeInsert, buildCodeUpdate, deriveCodeLanguage, deriveListingStyle, describeCodeLinkState, diffCodeLink, formatError, listCodeSymbols, readCodeExcerpt, resolveCodeLinks, scanCodeLinks,
  type CodeExcerpt, type CodeLinkSource, type ILogger, type ResolvedCodeLink,
} from "../../../index.js";
import { pickQuickEntry, showToast, type QuickPickEntry } from "../../../ui/dom/index.js";
import { applyRangeEdit, createLinkController, insertBlock, openDiffDialog, type LinkActions, type LinkButton, type LinkController, type LinkMark, type LinkRuntime } from "./linkMarks.js";

const MODULE = "editor.codeLinks";

/** Where the code files are read and listed from: paths relative to the project folder. */
export type CodeFileSource = CodeLinkSource & {
  /** The project's code files. */
  list(): Promise<string[]>;
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

/** The code file the user picks with its text, or undefined when nothing was picked or there is nothing to pick. */
async function pickFile({ deps }: Runtime): Promise<{ path: string; text: string } | undefined> {
  const paths = await deps.source.list();
  if (paths.length === 0) { showToast("No code files found in this project.", "info"); return undefined; }
  const path = await pickQuickEntry(paths.map((value) => ({ label: value, icon: "code" as const, value })), { title: "Insert code", placeholder: "Search code files" });
  if (path === undefined) return undefined;
  const text = await deps.source.read(path);
  if (text === undefined) { showToast(`${path} no longer exists.`, "info"); return undefined; }
  return { path, text };
}

/** The whole file or one of its definitions; a file whose language has no definitions is taken whole. */
async function pickAnchor(path: string, text: string): Promise<CodeExcerpt["anchor"] | undefined> {
  const language = deriveCodeLanguage(path)?.symbols;
  const symbols = language ? listCodeSymbols(language, text) : [];
  if (symbols.length === 0) return { kind: "file" };
  const entries: QuickPickEntry<CodeExcerpt["anchor"]>[] = [
    { label: "Whole file", icon: "file", value: { kind: "file" } },
    { kind: "separator", label: "Definitions" },
    ...symbols.map((symbol) => ({
      label: symbol.name, description: `lines ${symbol.startLine + 1}–${symbol.endLine + 1}`, icon: "code" as const, value: { kind: "symbol", name: symbol.name } as const,
    })),
  ];
  return pickQuickEntry(entries, { title: `Insert code from ${path}`, placeholder: "Whole file or a definition" });
}

/** The manuscript texts that decide the listing style: this one and the project's LaTeX files with a preamble. */
async function preambleTexts({ deps }: Runtime, current: string): Promise<string[]> {
  const paths = (await deps.files.list()).filter((path) => path.endsWith(".tex"));
  const texts = await Promise.all(paths.map((path) => deps.files.read(path).catch(() => "")));
  return [current, ...texts.filter((text) => text.includes("\\documentclass"))];
}

const insertCode = (rt: Runtime, view: EditorView): Promise<void> => rt.guarded("insert the code", async () => {
  const file = await pickFile(rt);
  if (!file) return;
  const anchor = await pickAnchor(file.path, file.text);
  if (!anchor) return;
  const excerpt = readCodeExcerpt(file.path, file.text, anchor);
  if (!excerpt) { showToast(`Could not find that code in ${file.path}.`, "info"); return; }
  const { style, needsPackage } = deriveListingStyle(rt.deps.language === "latex" ? await preambleTexts(rt, view.state.doc.toString()) : []);
  let block: string;
  try {
    block = await buildCodeInsert(rt.deps.language, style, excerpt);
  } catch (error) {
    showToast(formatError(error), "info");
    return;
  }
  insertBlock(view, block);
  if (rt.deps.language === "latex" && needsPackage) showToast(`Add \\usepackage{${style === "minted" ? "minted" : "listings"}} to the preamble.`, "info");
  await rt.refresh(view);
});

export function createCodeLinks(deps: CodeLinkDeps): CodeLinks {
  return createLinkController(deps, {
    module: MODULE, subject: "read the listing", refreshAction: "refreshCodeLinks",
    compute: async (_rt, text, doc) => toMarks(doc, await resolveCodeLinks(deps.language, text, deps.source)),
    buttonsFor, insert: insertCode, atCursor, update: applyUpdate, showDiff,
  });
}
