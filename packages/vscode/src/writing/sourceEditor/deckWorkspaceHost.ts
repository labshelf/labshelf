// The extension host's side of the talk and poster workspace in the LabShelf Editor: pdf.js assets, the built PDF of the file's root,
// builds and their state, SyncTeX boxes and points of the file and its included files, writes of included files, an image pick and Export PDF.
import * as vscode from "vscode";

import {
  ProjectSynctex, checkRelativePath, findSourceBoxes, findSourcePosition, isInside, readSourceDeckKind, sameSourcePath,
  type FinishedBuild, type ILogger, type ReadyProject, type SynctexFinder,
} from "@labshelf/core";
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

type BuildState = { state: "none" | "building" | "succeeded" | "failed"; errors: number };
interface BuildEvent { folder: string; root: string; state: BuildState }

let services: DeckWorkspaceServices | undefined;
let stylePreview: StylePreviewHandler | undefined;
const buildEvents = new vscode.EventEmitter<BuildEvent>();
const lastStates = new Map<string, BuildState>();
const synctexCache = new Map<string, Promise<SynctexFinder>>();
/** One root of one project folder, as the build state and SyncTeX maps key it. */
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
    const state: BuildState = { state: result.status === "failed" ? "failed" : "succeeded", errors };
    synctexCache.delete(keyOf(project.folder, root));
    lastStates.set(keyOf(project.folder, root), state);
    buildEvents.fire({ folder: project.folder, root, state });
  },
};

/** Whether the document is a talk or poster source the workspace opens. */
export function isDeckSource(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file" && readSourceDeckKind(document.uri.path, document.getText()) !== undefined;
}

/** The pdf.js folders a workspace webview loads from, for its localResourceRoots. */
export function deckResourceRoots(): vscode.Uri[] {
  const pdfjs = services?.locatePdfjs?.();
  return pdfjs ? [pdfjs.root, vscode.Uri.joinPath(pdfjs.pdfjs, "..")] : [];
}

const numberOf = (params: unknown, key: string): number => {
  const value = (params as Record<string, unknown> | null)?.[key];
  if (typeof value !== "number") throw new Error(`missing ${key}`);
  return value;
};

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
  /** Posts the root's build state now and on each change. */
  watch(post: (message: { type: "deckBuild"; state: BuildState["state"]; errors: number }) => void): vscode.Disposable;
}

/** The bridge of one LabShelf Editor panel on `document`. */
export function createDeckWorkspaceBridge(document: vscode.TextDocument, webview: vscode.Webview): DeckWorkspaceBridge {
  const file = document.uri.fsPath;
  const located = (): { project: ReadyProject; root: string; services: DeckWorkspaceServices } => {
    if (!services) throw new Error("builds are not ready");
    const project = findOwningProject(services.projects, file);
    if (!project) throw new Error("This file is not in a writing project.");
    const root = services.projects.paths.relative(project.folder, file).split(services.projects.paths.sep).join("/");
    return { project, root, services };
  };
  const synctex = (): Promise<SynctexFinder> => {
    const { project, root, services: s } = located();
    const key = keyOf(project.folder, root);
    let found = synctexCache.get(key);
    if (!found) {
      found = new ProjectSynctex({ current: () => ({ logger: s.logger }) }, s.projects.paths, s.projects.data).load(project, root);
      synctexCache.set(key, found);
      void found.then((lookup) => { if (lookup.status !== "found" && synctexCache.get(key) === found) synctexCache.delete(key); });
    }
    return found;
  };
  // Kits belong to the library, not the project, so their answers never call located().
  const kits = (): DeckKitsHandler => {
    if (!services?.kits) throw new Error("Kits are not available.");
    return services.kits;
  };
  const pdfPath = async (): Promise<string | undefined> => { const { project, root, services: s } = located(); return await readBuiltPdf(s.projects, project, root); };

  const answers: Record<string, (params: unknown) => Promise<unknown>> = {
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
    deckBoxes: async (params) => {
      const lookup = await synctex();
      if (lookup.status !== "found") return null;
      const path = stringOf(params, "path");
      const target = path === undefined ? file : insideProject(located().project.folder, path).fsPath;
      return findSourceBoxes(lookup.index, target, numberOf(params, "from"), numberOf(params, "to"))
        .map(({ page, box }) => ({ page, left: box.left, top: box.top, right: box.right, bottom: box.bottom }));
    },
    deckSourceAt: async (params) => {
      const lookup = await synctex();
      if (lookup.status !== "found") return null;
      const found = findSourcePosition(lookup.index, { page: numberOf(params, "page"), x: numberOf(params, "x"), y: numberOf(params, "y") });
      if (!found) return undefined;
      // The hit's line with its project path: the root for this file, else the included file's when it is inside the project.
      const { project, root, services: s } = located();
      if (sameSourcePath(found.file, file, project.folder)) return { line: found.line, path: root };
      const native = s.projects.paths.resolve(found.file.split("/").join(s.projects.paths.sep));
      if (!isInside(s.projects.paths, project.folder, native)) return undefined;
      const path = s.projects.paths.relative(project.folder, native).split(s.projects.paths.sep).join("/");
      return checkRelativePath(path) === undefined ? { line: found.line, path } : undefined;
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
    deckExportPdf: async () => {
      const path = await pdfPath();
      if (!path) { void vscode.window.showInformationMessage("Build the file first, then export its PDF."); return null; }
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path), filters: { PDF: ["pdf"] }, saveLabel: "Export PDF" });
      if (target) await vscode.workspace.fs.copy(vscode.Uri.file(path), target, { overwrite: true });
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

  return {
    handle: (method, params) => answers[method]?.(params),
    watch(post) {
      let current: { folder: string; root: string } | undefined;
      try { const { project, root } = located(); current = { folder: project.folder, root }; } catch { current = undefined; }
      const send = (state: BuildState): void => post({ type: "deckBuild", state: state.state, errors: state.errors });
      if (current) send(lastStates.get(keyOf(current.folder, current.root)) ?? { state: "none", errors: 0 });
      return buildEvents.event((event) => { if (current && event.folder === current.folder && event.root === current.root) send(event.state); });
    },
  };
}
