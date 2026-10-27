// Sends an open preview the build roots with their problems, word counts, check findings and build options, and sends them again when any of those changes.
import * as vscode from "vscode";

import { createPublishedVersionFinder, type RegistryEnv } from "@labshelf/core";
import type { ReaderPanel } from "../../reader/index.js";
import { buildOptions, onAutoCompileChange } from "../build/index.js";
import { createProjectSourceReader } from "../../latex/project/index.js";
import type { ReadyProject } from "../buildRootDocument.js";
import { countBuildRootWords } from "./limits.js";
import { readPdfProblems } from "./diagnostics.js";
import { PREVIEW_LOG_MODULE, type BuildPreviewsDeps } from "./panel.js";
import { readActiveProjectEditor, readFocusedBuildRoot, createPreviewBuildRootsMessage, createProjectPreprints, createProjectSources, type BuildRootBuilds } from "./buildRoots.js";
import type { ProjectSynctex } from "./synctex.js";
import { disposeAll } from "../../disposables/index.js";

export class MeasureCache {
  private readonly measures = new Map<string, Promise<unknown>>();

  /** The measure of a root, taken once; a failed measure is forgotten so the next call tries again. */
  get<T>(projectFolder: string, root: string, kind: string, measure: () => Promise<T>): Promise<T> {
    const key = `${projectFolder}\0${root}\0${kind}`;
    const known = this.measures.get(key);
    if (known) { return known as Promise<T>; }
    const taken = measure();
    this.measures.set(key, taken);
    taken.catch(() => { if (this.measures.get(key) === taken) { this.measures.delete(key); } });
    return taken;
  }

  /** Forgets the measures of one root, whose build finished. */
  invalidate(projectFolder: string, root: string): void {
    const prefix = `${projectFolder}\0${root}\0`;
    for (const key of this.measures.keys()) { if (key.startsWith(prefix)) { this.measures.delete(key); } }
  }

  clear(): void {
    this.measures.clear();
  }
}

/** The preview state of BuildPreviews that a publish reads. */
export interface BuildRootsPublisherState {
  panels: ReadonlyMap<string, ReaderPanel>;
  /** The root each project's open preview shows. */
  shown: ReadonlyMap<string, string>;
  builds: BuildRootBuilds;
  synctex: ProjectSynctex;
}

export class BuildRootsPublisher implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[];
  // INVARIANT: a root's measures change only with its build or a project reload, which invalidate them.
  private readonly measures = new MeasureCache();
  private readonly preprints: ReturnType<typeof createProjectPreprints>;
  private readonly readerFor = (folder: string) => createProjectSourceReader(vscode.Uri.file(folder), () => this.deps.host.current()?.logger);

  constructor(private readonly deps: BuildPreviewsDeps, private readonly state: BuildRootsPublisherState) {
    // The library root, and with it the logger, can change after activation.
    const env: RegistryEnv = { fetch: globalThis.fetch, get logger() { return deps.host.current()?.logger; } };
    this.preprints = createProjectPreprints({ logger: () => deps.host.current()?.logger, lookup: createPublishedVersionFinder(env) });
    this.subscriptions = [
      onAutoCompileChange(() => this.resendAll()),
      vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration("labshelf.writing.haltOnError")) { this.resendAll(); } }),
      deps.projects.onDidChange(() => { this.measures.clear(); this.resendAll(); }),
      deps.checkCounts.onChange((folder) => this.resend(folder)),
      vscode.window.onDidChangeActiveTextEditor(() => this.resendAll()),
    ];
  }

  dispose(): void {
    disposeAll(this.subscriptions);
  }

  /** Sends the roots of every open preview again. */
  resendAll(): void {
    for (const folder of this.state.panels.keys()) { this.resend(folder); }
  }

  /** Forgets what was measured of a root whose build finished. */
  invalidate(folder: string, root: string): void {
    this.measures.invalidate(folder, root);
  }

  // The project entry is read again because a reload can change its settings.
  resend(folder: string): void {
    if (!this.state.panels.has(folder)) { return; }
    const entry = this.deps.projects.list().find((candidate) => candidate.kind === "ready" && candidate.folder === folder);
    if (entry?.kind === "ready") { void this.publish(entry); }
  }

  async publish(project: ReadyProject): Promise<void> {
    const panel = this.state.panels.get(project.folder);
    const shown = this.state.shown.get(project.folder);
    if (!panel || shown === undefined) { return; }
    const { paths, data, buildRootOf, checkCounts } = this.deps;
    const { builds } = this.state;
    const checks = checkCounts.get(project.folder);
    const logger = this.deps.host.current()?.logger;
    try {
      const focused = await readFocusedBuildRoot(paths, buildRootOf, project);
      panel.controller.setPreviewRoots(await createPreviewBuildRootsMessage({
        paths, data, project, focused, shown, built: builds.builtRoots(project.folder),
        problemsOf: (root) => builds.problemsOf(project.folder, root) ?? [],
        failed: (root) => builds.stateOf(project.folder, root)?.state === "failed",
        options: await this.optionsOf(project, shown),
        pdfProblemsOf: (root) => this.pdfProblems(project, root),
        wordsOf: (root) => this.measures.get(project.folder, root, "words", () => countBuildRootWords({ readerFor: this.readerFor }, project, root)),
        ...(checks !== undefined && { checks }),
        ...(logger && { logger }),
      }));
    } catch (error) {
      void logger?.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, shown });
    }
  }

  private pdfProblems(project: ReadyProject, root: string): ReturnType<typeof readPdfProblems> {
    const logger = this.deps.host.current()?.logger;
    if (!logger) { return Promise.resolve({ pdfProblems: [], cites: 0 }); }
    return this.measures.get(project.folder, root, "pdfProblems", () => readPdfProblems({
      logger, paths: this.deps.paths, problemsOf: (of) => this.state.builds.problemsOf(project.folder, of) ?? [],
      preprints: this.preprints, synctex: () => this.state.synctex.load(project, root),
      typstCites: () => this.state.builds.citesOf(project.folder, root) ?? [],
      readSources: createProjectSources(this.readerFor),
    }, project, root));
  }

  // The include-only toggle exists for the shown root when the editor focuses a file that root `\include`s.
  private async optionsOf(project: ReadyProject, shown: string) {
    const { paths, includeOnly } = this.deps;
    const editor = readActiveProjectEditor(paths, project.folder);
    const focusedFile = editor && paths.relative(project.folder, editor.document.uri.fsPath).split(paths.sep).join("/");
    const chapter = focusedFile === undefined ? undefined : await includeOnly?.option(project, shown, focusedFile);
    return { ...buildOptions(project), ...(chapter && { includeOnly: chapter }) };
  }
}
