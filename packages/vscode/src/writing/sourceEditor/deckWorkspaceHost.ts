// The extension host's side of the talk and poster workspace in the LabShelf Editor: pdf.js assets, the built PDF of the file's root,
// builds and their state with the build's page map, writes of included files, an image pick and Export PDF.
import * as vscode from "vscode";

import {
  POSTER_PDF_CHOICES, TALK_PDF_CHOICES, addPrintMarks, checkRelativePath, describeSourceDeck, isInside, keepDeckPageMap, lastDeckPageMap, layoutTalkPdf, readSourceDeckKind, readTalkPages,
  type DeckOverflowMark, type DeckPageMap, type FinishedBuild, type ILogger, type PrintMarksOptions, type ReadyProject, type TalkPdfLayout, type TalkPdfNotes,
} from "@labshelf/core";
import type { DeckBuildState } from "@labshelf/core/deckWorkspace";
import { readRootPageMap } from "@labshelf/core/node";
import { resolvePdfjsUris, type PdfjsLocator } from "../../reader/index.js";
import { readBuiltPdf } from "../preview/index.js";
import { findOwningProject, type WritingProjects } from "../projects/index.js";
import type { DeckKitsHandler, WireKitImage } from "./deckKits.js";
import { createStylePreviewHandler, type StylePreviewHandler, type StylePreviewServices } from "./deckStylePreview.js";

/** What the workspace reaches beyond its file; given once the writing view registers its builds. */
export interface DeckWorkspaceServices {
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "fs">;
  logger: ILogger;
  recompile(folder: string, root: string): Promise<unknown>;
  locatePdfjs?: PdfjsLocator;
  /** What the Style panel's build copies compile with; absent, the panel shows swatches. */
  stylePreview?: StylePreviewServices;
  /** The library's deck Kits, shared with the HTML deck editor; absent, the kits requests reject. */
  kits?: DeckKitsHandler;
}

type BuildState = DeckBuildState;
interface BuildEvent { folder: string; root: string; state: BuildState }

let services: DeckWorkspaceServices | undefined;
let stylePreview: StylePreviewHandler | undefined;
const buildEvents = new vscode.EventEmitter<BuildEvent>();
const lastStates = new Map<string, BuildState>();
/** One root of one project folder, as the build state map keys it. */
const keyOf = (folder: string, root: string): string => `${folder}\n${root}`;

/** Gives the workspace its services; returns the disposable that takes them back. */
export function provideDeckWorkspace(next: DeckWorkspaceServices): vscode.Disposable {
  services = next;
  stylePreview = next.stylePreview && createStylePreviewHandler(next.stylePreview);
  return new vscode.Disposable(() => { if (services === next) { services = undefined; stylePreview = undefined; } });
}

/** The kits handler the writing view provided, for the HTML deck editor that shares it. */
export function deckWorkspaceKits(): DeckKitsHandler | undefined {
  return services?.kits;
}

/** The build listener half the writing view calls, so open workspaces show the state of their root's builds. */
export const deckWorkspaceBuilds = {
  building(folder: string, root: string): void {
    const state: BuildState = { state: "building", errors: 0 };
    lastStates.set(keyOf(folder, root), state);
    buildEvents.fire({ folder, root, state });
  },
  finished(project: ReadyProject, root: string, result: FinishedBuild): void {
    const errors = result.status === "failed" ? result.problems.filter((problem) => problem.severity === "error").length : 0;
    const pageMap = "pageMap" in result ? result.pageMap : undefined;
    // A failed or preview build leaves the last full build's map in place for Present and handouts.
    if (pageMap) keepDeckPageMap(project.folder, root, pageMap);
    const state: BuildState = { state: result.status === "failed" ? "failed" : "succeeded", errors, overflow: overflowMarks(project.folder, result), ...(pageMap && { pageMap }) };
    lastStates.set(keyOf(project.folder, root), state);
    buildEvents.fire({ folder: project.folder, root, state });
  },
};

/** The located Overfull \\vbox problems of a build, with their files relative to the project folder ('/' separated). */
function overflowMarks(folder: string, result: FinishedBuild): DeckOverflowMark[] {
  const paths = services?.projects.paths;
  if (!paths) return [];
  return result.problems.flatMap((problem) => (problem.kind === "overfullPage" && problem.line !== undefined && isInside(paths, folder, problem.file)
    ? [{ file: paths.relative(folder, problem.file).split(paths.sep).join("/"), line: problem.line }] : []));
}

/** Whether the document is a talk or poster source the workspace opens. */
export function isDeckSource(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file" && readSourceDeckKind(document.uri.path, document.getText()) !== undefined;
}

/** The pdf.js folders a workspace webview loads from, for its localResourceRoots. */
export function deckResourceRoots(): vscode.Uri[] {
  const pdfjs = services?.locatePdfjs?.();
  return pdfjs ? [pdfjs.root, vscode.Uri.joinPath(pdfjs.pdfjs, "..")] : [];
}


function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

const stringOf = (params: unknown, key: string): string | undefined => {
  const value = (params as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : undefined;
};

/** The file of a project-relative posix path; a path that leaves the project throws. */
function insideProject(folder: string, path: string): vscode.Uri {
  if (checkRelativePath(path) !== undefined) throw new Error("outside the project");
  return vscode.Uri.joinPath(vscode.Uri.file(folder), ...path.split("/"));
}

/** Replaces a project file's whole text through a workspace edit, so an open editor of it stays in sync, then saves it. */
async function writeProjectFile(target: vscode.Uri, text: string): Promise<void> {
  const key = target.toString();
  const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === key) ?? await vscode.workspace.openTextDocument(target);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(target, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error(`Could not write ${target.fsPath}.`);
  if (!await document.save()) throw new Error(`Could not save ${target.fsPath}.`);
}

export interface DeckWorkspaceBridge {
  /** Answers a workspace request; undefined when `method` is not one. */
  handle(method: string, params: unknown): Promise<unknown> | undefined;
  /**
   * Posts the root's build state now and on each change, and the cursor of every other file of the project a VS Code editor moves
   * (project-relative posix path, 1-based line), so Split selects the slide under it.
   */
  watch(post: (message: DeckWorkspaceMessage) => void): vscode.Disposable;
}

type DeckWorkspaceMessage =
  | { type: "deckBuild" } & BuildState
  | { type: "deckCursor"; path: string; line: number };

interface LocatedDeck { project: ReadyProject; root: string; services: DeckWorkspaceServices }

/** The deck of one panel's file: its owning project and root, and its built PDF. */
interface PanelDeck {
  file: string;
  located(): LocatedDeck;
  pdfPath(): Promise<string | undefined>;
}

function panelDeckOf(document: vscode.TextDocument): PanelDeck {
  const file = document.uri.fsPath;
  const located = (): LocatedDeck => {
    if (!services) throw new Error("builds are not ready");
    const project = findOwningProject(services.projects, file);
    if (!project) throw new Error("This file is not in a writing project.");
    const root = services.projects.paths.relative(project.folder, file).split(services.projects.paths.sep).join("/");
    return { project, root, services };
  };
  const pdfPath = async (): Promise<string | undefined> => { const { project, root, services: s } = located(); return await readBuiltPdf(s.projects, project, root); };
  return { file, located, pdfPath };
}

/** The map of the root's last full build: the one kept this session, else the one its build folder holds; none when unreadable. */
async function lastPageMap(deck: PanelDeck): Promise<DeckPageMap | undefined> {
  try {
    const { project, root, services: s } = deck.located();
    return lastDeckPageMap(project.folder, root) ?? await readRootPageMap(project, root, s.projects.data, s.logger);
  } catch {
    return undefined;
  }
}

/** The workspace requests a panel answers, by method. */
function deckAnswers(document: vscode.TextDocument, webview: vscode.Webview, deck: PanelDeck): Record<string, (params: unknown) => Promise<unknown>> {
  const { located, pdfPath } = deck;
  // Kits belong to the library, not the project, so their answers never call located().
  const kits = (): DeckKitsHandler => {
    if (!services?.kits) throw new Error("Kits are not available.");
    return services.kits;
  };
  return {
    deckAssets: async () => {
      const urls = resolvePdfjsUris(webview, services?.locatePdfjs?.() ?? null);
      if (!urls) throw new Error("PDF.js is not installed, so the PDF cannot be shown.");
      return { pdfjsUrl: urls.pdfjsWebviewUri.toString(), workerUrl: urls.workerWebviewUri.toString(), cMapUrl: urls.cMapWebviewUrl, stdFontUrl: urls.standardFontWebviewUrl, wasmUrl: urls.wasmWebviewUrl, iccUrl: urls.iccWebviewUrl };
    },
    deckPdf: async () => {
      const path = await pdfPath();
      return path ? base64(await vscode.workspace.fs.readFile(vscode.Uri.file(path))) : null;
    },
    deckBuild: async () => {
      const { project, root, services: s } = located();
      await s.recompile(project.folder, root);
      return null;
    },
    writeFile: async (params) => {
      const path = stringOf(params, "path"); const text = stringOf(params, "text");
      if (path === undefined || text === undefined) throw new Error("missing path or text");
      await writeProjectFile(insideProject(located().project.folder, path), text);
      return null;
    },
    deckPickImage: async () => {
      const folder = vscode.Uri.joinPath(document.uri, "..");
      const { project } = located();
      const picked = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(project.folder), canSelectMany: false, openLabel: "Use image", filters: { Images: ["png", "jpg", "jpeg", "pdf", "svg", "eps"] } });
      if (!picked?.[0]) return null;
      const relative = services!.projects.paths.relative(folder.fsPath, picked[0].fsPath).split(services!.projects.paths.sep).join("/");
      return relative;
    },
    // An image dropped from the Explorer: the first file uri inside the project that the format can show, relative to this file's folder.
    deckDropImage: async (params) => {
      const uris = (params as { uris?: unknown } | null)?.uris;
      if (!Array.isArray(uris)) return null;
      const { project, services: s } = located();
      const { paths } = s.projects;
      const image = file.endsWith(".typ") ? /\.(png|jpe?g|svg|gif|webp)$/i : /\.(png|jpe?g|pdf|svg|eps|gif|webp)$/i;
      for (const raw of uris) {
        if (typeof raw !== "string") continue;
        const uri = vscode.Uri.parse(raw);
        if (uri.scheme !== "file" || !image.test(uri.fsPath) || !isInside(paths, project.folder, uri.fsPath)) continue;
        return paths.relative(paths.dirname(file), uri.fsPath).split(paths.sep).join("/");
      }
      return null;
    },
    deckExportPdf: async () => {
      const path = await pdfPath();
      if (!path) { void vscode.window.showInformationMessage("Build the file first, then export its PDF."); return null; }
      let marks: PrintMarksOptions | null = null;
      let talk: { layout: TalkPdfLayout; notes: TalkPdfNotes } | null = null;
      const format = file.endsWith(".typ") ? "typst" : "latex";
      const text = document.getText();
      const kind = readSourceDeckKind(file, text);
      if (kind === "poster") {
        const items = POSTER_PDF_CHOICES.map((choice) => ({ label: choice.label, detail: choice.detail, marks: choice.marks }));
        const picked = await vscode.window.showQuickPick(items, { title: "Export poster PDF" });
        if (!picked) return null;
        marks = picked.marks;
      } else if (kind === "talk") {
        const items = TALK_PDF_CHOICES.map((choice) => ({ label: choice.label, detail: choice.detail, layout: choice.layout }));
        const picked = await vscode.window.showQuickPick(items, { title: "Export talk PDF" });
        if (!picked) return null;
        const { root } = located();
        const source = describeSourceDeck(format, root, text);
        // Without the build's page map no page is placed: the notes stay off the pages rather than land on the wrong ones.
        const pages = readTalkPages(await lastPageMap(deck), root, text) ?? { slideOfPage: [] };
        if (picked.layout) talk = { layout: picked.layout, notes: { notes: source?.notes ?? [], ...pages, format } };
      }
      // A handout or notes pages default to <name>-handout.pdf or <name>-notes.pdf beside the built PDF.
      const suffix = talk ? (talk.layout.kind === "handout" ? "-handout" : "-notes") : "";
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.replace(/\.pdf$/i, `${suffix}.pdf`)), filters: { PDF: ["pdf"] }, saveLabel: "Export PDF" });
      if (!target) return null;
      if (marks || talk) {
        const built = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
        await vscode.workspace.fs.writeFile(target, talk ? await layoutTalkPdf(built, talk.layout, talk.notes) : await addPrintMarks(built, marks!));
      } else await vscode.workspace.fs.copy(vscode.Uri.file(path), target, { overwrite: true });
      return null;
    },
    deckStylePreview: async (params) => {
      const { project, root } = located();
      const text = (params as { text?: unknown } | null)?.text;
      const key = (params as { key?: unknown } | null)?.key;
      const from = (params as { path?: unknown } | null)?.path;
      if (!stylePreview || typeof text !== "string" || typeof key !== "string") return null;
      const pdf = await stylePreview({ project, root, path: typeof from === "string" ? from : file, text, key });
      return pdf ?? null;
    },
    deckKits: async () => await kits().list(),
    deckSaveKit: async (params) => {
      const { kit, logo } = (params ?? {}) as { kit?: unknown; logo?: WireKitImage };
      return await kits().save(kit, logo);
    },
    deckPickKitImage: async () => await kits().pickImage(),
    showProblems: async () => { await vscode.commands.executeCommand("workbench.actions.view.problems"); return null; },
  };
}

/** The bridge of one LabShelf Editor panel on `document`. */
export function createDeckWorkspaceBridge(document: vscode.TextDocument, webview: vscode.Webview): DeckWorkspaceBridge {
  const deck = panelDeckOf(document);
  const answers = deckAnswers(document, webview, deck);
  /** The project-relative posix path of another file of this file's project; undefined for this file, a file outside the project, or before builds are ready. */
  const projectPathOf = (other: vscode.TextDocument): string | undefined => {
    if (other.uri.scheme !== "file" || other.uri.toString() === document.uri.toString() || !services) return undefined;
    const project = findOwningProject(services.projects, deck.file);
    const { paths } = services.projects;
    if (!project || !isInside(paths, project.folder, other.uri.fsPath)) return undefined;
    const path = paths.relative(project.folder, other.uri.fsPath).split(paths.sep).join("/");
    return checkRelativePath(path) === undefined ? path : undefined;
  };
  return {
    handle: (method, params) => answers[method]?.(params),
    watch(post) {
      let current: { folder: string; root: string } | undefined;
      try { const { project, root } = deck.located(); current = { folder: project.folder, root }; } catch { current = undefined; }
      const send = (state: BuildState): void => post({ type: "deckBuild", ...state });
      // The first state carries the last full build's map, so a PDF built before this panel opened is linked too.
      let built = false;
      if (current) {
        const last = lastStates.get(keyOf(current.folder, current.root)) ?? { state: "none", errors: 0 };
        void lastPageMap(deck).then((pageMap) => { if (!built) send(pageMap ? { ...last, pageMap } : last); });
      }
      const builds = buildEvents.event((event) => { if (current && event.folder === current.folder && event.root === current.root) { built = true; send(event.state); } });
      const cursors = vscode.window.onDidChangeTextEditorSelection((event) => {
        const path = projectPathOf(event.textEditor.document);
        const head = event.selections[0]?.active;
        if (path !== undefined && head) post({ type: "deckCursor", path, line: head.line + 1 });
      });
      return vscode.Disposable.from(builds, cursors);
    },
  };
}
