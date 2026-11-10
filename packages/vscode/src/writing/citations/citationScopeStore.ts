// The project's .labshelf/citations.json on the host: appending a citation's scope, reading a file's records, and
// re-anchoring a source's records when it is saved (plan editor-cite-popup D2, D4).
import * as vscode from "vscode";

import {
  CITATION_SCOPES_FILE, formatCitationScopes, parseCitationScopes, pruneCitationScopes, reanchorCitationScopes,
  type CitationScopeRecord, type IFileSystem, type ILogger, type PathOps, type ProjectFormat,
} from "@labshelf/core";
import { findOwningProject, type WritingProjects } from "../projects/index.js";

/** The disk the store is read from and written to, and the path style of the project folder. */
export interface CitationScopeStoreDeps {
  fs: Pick<IFileSystem, "readText" | "writeText" | "exists" | "ensureDir">;
  paths: Pick<PathOps, "join" | "dirname">;
  logger?: Pick<ILogger, "log">;
}

const pathIn = ({ paths }: CitationScopeStoreDeps, folder: string, relative: string): string => paths.join(folder, ...relative.split("/"));

/** The store's records; a missing file has none, and a broken one none with a WARN. */
async function readStore(deps: CitationScopeStoreDeps, folder: string): Promise<CitationScopeRecord[]> {
  const path = pathIn(deps, folder, CITATION_SCOPES_FILE);
  if (!(await deps.fs.exists(path))) { return []; }
  return parseCitationScopes(await deps.fs.readText(path), deps.logger);
}

async function writeStore(deps: CitationScopeStoreDeps, folder: string, records: readonly CitationScopeRecord[]): Promise<void> {
  const path = pathIn(deps, folder, CITATION_SCOPES_FILE);
  await deps.fs.ensureDir(deps.paths.dirname(path));
  await deps.fs.writeText(path, formatCitationScopes(records));
}

/** Appends the record to the project's store; the records of files that no longer exist go with this write. */
export async function appendCitationScope(deps: CitationScopeStoreDeps, folder: string, record: CitationScopeRecord): Promise<void> {
  const records = await readStore(deps, folder);
  const files = [...new Set(records.map((stored) => stored.file))];
  const existing = new Set<string>();
  for (const file of files) {
    if (await deps.fs.exists(pathIn(deps, folder, file))) { existing.add(file); }
  }
  await writeStore(deps, folder, [...pruneCitationScopes(records, existing), record]);
}

/** The records of one project-relative file. */
export async function readCitationScopesOf(deps: CitationScopeStoreDeps, folder: string, file: string): Promise<CitationScopeRecord[]> {
  return (await readStore(deps, folder)).filter((record) => record.file === file);
}

/**
 * Re-finds the records of the saved `file` in its `text` and rewrites the store only when something changed.
 * @returns whether the store was written
 */
export async function reanchorStoredScopes(deps: CitationScopeStoreDeps, folder: string, file: string, text: string, format: ProjectFormat): Promise<boolean> {
  const records = await readStore(deps, folder);
  if (!records.some((record) => record.file === file)) { return false; }
  const next = reanchorCitationScopes(records, file, text, format);
  if (formatCitationScopes(next) === formatCitationScopes(records)) { return false; }
  await writeStore(deps, folder, next);
  return true;
}

const SOURCE_EXTENSION: Record<ProjectFormat, string> = { latex: ".tex", typst: ".typ" };

/** Re-anchors the scopes of every project source the user saves; a failure is logged and leaves the store as it was. */
export function registerCitationScopeReanchor(projects: Pick<WritingProjects, "list" | "paths" | "fs">, logger: ILogger): vscode.Disposable {
  return vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.uri.scheme !== "file") { return; }
    const project = findOwningProject(projects, document.uri.fsPath);
    const format = project?.settings.format;
    if (!project || !format || !document.uri.fsPath.endsWith(SOURCE_EXTENSION[format])) { return; }
    const { paths } = projects;
    const file = paths.relative(project.folder, document.uri.fsPath).split(paths.sep).join("/");
    void reanchorStoredScopes({ fs: projects.fs, paths, logger }, project.folder, file, document.getText().replace(/\r\n/g, "\n"), format)
      .catch((error: unknown) => logger.error("writing/citationScopes", error, { action: "reanchor", file }));
  });
}
