// The linked outputs of a manuscript in the native editor: the hover of each reference (the copy's image, its origin, its update, its state and the actions) and a lens per reference, refreshed when the outputs change.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import * as vscode from "vscode";

import { IMAGE_OUTPUT_EXTENSIONS, createOutputLinks, extensionOf, type ILogger, type OutputLinks, type ResolvedOutputReference } from "@labshelf/core";
import { findCitingProject } from "../citations/backlinks.js";
import { readManuscriptLanguage } from "../citations/linkMarks.js";
import type { ReadyProject, WritingProjects } from "../projects/index.js";
import { deriveOutputActions, describeOutputUpdate, type OutputAction } from "./outputChoices.js";
import { openProjectOutputs, type OutputSourceHost, type ProjectOutputs } from "./projectOutputs.js";

export const OUTPUT_COMMANDS = {
  run: "labshelf.writing.runOutputSource",
  update: "labshelf.writing.updateOutput",
  link: "labshelf.writing.linkOutputSource",
  settings: "labshelf.writing.outputSourceSettings",
} as const satisfies Record<OutputAction, string>;

const ACTION_TITLES: Record<OutputAction, string> = { run: "Run", update: "Update", link: "Link to code", settings: "Source settings" };

export interface NativeOutputDeps {
  projects: Pick<WritingProjects, "list" | "paths" | "fs">;
  sources: OutputSourceHost;
  logger: ILogger;
}

/** One manuscript's project, its outputs on this machine and the service over them. */
export interface ManuscriptOutputs {
  project: ReadyProject;
  outputs: ProjectOutputs;
  links: OutputLinks;
  /** The manuscript relative to the project folder, POSIX. */
  manuscriptPath: string;
}

/** The outputs of the project whose source the file is; undefined for any other file. */
export function openManuscriptOutputs(deps: NativeOutputDeps, file: string): ManuscriptOutputs | undefined {
  const project = findCitingProject(deps.projects, file);
  if (!project) { return undefined; }
  const outputs = openProjectOutputs(deps.sources, { folder: project.folder, projectId: project.settings.id }, deps.projects.fs, deps.projects.paths.join);
  const links = createOutputLinks({ files: outputs.files, sources: outputs.sources, logger: deps.logger, format: project.settings.format, projectId: project.settings.id });
  const manuscriptPath = deps.projects.paths.relative(project.folder, file).split(deps.projects.paths.sep).join("/");
  return { project, outputs, links, manuscriptPath };
}

/** The references of the document with their links and states; none outside a project's manuscript or when the outputs cannot be read. */
async function resolveDocument(deps: NativeOutputDeps, document: vscode.TextDocument): Promise<{ opened: ManuscriptOutputs; resolved: ResolvedOutputReference[] } | undefined> {
  if (!readManuscriptLanguage(document)) { return undefined; }
  const opened = openManuscriptOutputs(deps, document.uri.fsPath);
  if (!opened) { return undefined; }
  try {
    return { opened, resolved: await opened.links.resolve(document.getText(), opened.manuscriptPath) };
  } catch (error) {
    void deps.logger.error("writing/outputs", error, { action: "resolveOutputs" });
    return undefined;
  }
}

/** A markdown link that runs one of the output commands on the document and the reference's source or link. */
function actionLink(action: OutputAction, document: vscode.TextDocument, { link }: ResolvedOutputReference): string {
  const argument = action === "update" ? link.id : link.source;
  return `[${ACTION_TITLES[action]}](command:${OUTPUT_COMMANDS[action]}?${encodeURIComponent(JSON.stringify([document.uri.toString(), argument]))})`;
}

function outputHover(project: ReadyProject, paths: NativeOutputDeps["projects"]["paths"], document: vscode.TextDocument, resolved: ResolvedOutputReference): vscode.MarkdownString {
  const { link, status } = resolved;
  const markdown = new vscode.MarkdownString();
  if (!status.copyMissing && IMAGE_OUTPUT_EXTENSIONS.includes(extensionOf(link.copy))) {
    const image = vscode.Uri.file(paths.join(project.folder, ...link.copy.split("/")));
    markdown.appendMarkdown(`![${link.path.replace(/[[\]]/g, "")}](${image.toString()}|width=360)\n\n`);
  }
  markdown.appendText(`${link.source} › ${link.path}`).appendMarkdown("\n\n").appendText(describeOutputUpdate(link)).appendMarkdown("\n\n").appendText(resolved.sentence);
  const actions = deriveOutputActions(status);
  markdown.appendMarkdown(`\n\n${actions.map((action) => actionLink(action, document, resolved)).join(" · ")}`);
  markdown.isTrusted = { enabledCommands: actions.map((action) => OUTPUT_COMMANDS[action]) };
  markdown.supportHtml = false;
  return markdown;
}

export function createOutputHoverProvider(deps: NativeOutputDeps): vscode.HoverProvider {
  return {
    async provideHover(document, position) {
      const found = await resolveDocument(deps, document);
      const offset = document.offsetAt(position);
      const hit = found?.resolved.find(({ reference }) => reference.start <= offset && offset <= reference.end);
      if (!found || !hit) { return undefined; }
      const range = new vscode.Range(document.positionAt(hit.reference.start), document.positionAt(hit.reference.end));
      return new vscode.Hover(outputHover(found.opened.project, deps.projects.paths, document, hit), range);
    },
  };
}

/** The lenses of one reference: Run or Link to code, plus Update when the copy is stale or missing. */
function referenceLenses(document: vscode.TextDocument, { reference, link, status }: ResolvedOutputReference): vscode.CodeLens[] {
  const range = document.lineAt(document.positionAt(reference.start).line).range;
  return deriveOutputActions(status).filter((action) => action !== "settings").map((action) => new vscode.CodeLens(range, {
    title: action === "run" ? `Run ${link.source}` : ACTION_TITLES[action],
    command: OUTPUT_COMMANDS[action],
    arguments: [document.uri, action === "update" ? link.id : link.source],
  }));
}

export function createOutputLensProvider(deps: NativeOutputDeps): vscode.CodeLensProvider & vscode.Disposable & { refresh(): void } {
  const changed = new vscode.EventEmitter<void>();
  return {
    onDidChangeCodeLenses: changed.event,
    refresh: () => changed.fire(),
    dispose: () => changed.dispose(),
    async provideCodeLenses(document) {
      const found = await resolveDocument(deps, document);
      const seen = new Set<string>();
      // A link referenced twice on one line gets one set of lenses.
      return (found?.resolved ?? []).flatMap((each) => {
        const key = `${document.positionAt(each.reference.start).line}\u0000${each.link.id}`;
        if (seen.has(key)) { return []; }
        seen.add(key);
        return referenceLenses(document, each);
      });
    },
  };
}
