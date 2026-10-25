// Collects the files of a project zip or an arXiv zip from the workspace file system.
import * as vscode from "vscode";

import {
  arxivBundle, bibliographyFiles, DEFAULT_BIBLIOGRAPHY, projectFiles, scanCitationKeys,
  type PathOps,
} from "@labshelf/core";

import type { ReadyProject } from "./buildRootDocument.js";

/** Zip entries by project-relative POSIX path. */
export type ZipEntries = Record<string, Uint8Array>;

const SOURCE_EXTENSION = { latex: ".tex", typst: ".typ" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readBytes(project: ReadyProject, relative: string): Promise<Uint8Array> {
  return await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.file(project.folder), relative));
}

async function readText(project: ReadyProject, relative: string): Promise<string> {
  return decoder.decode(await readBytes(project, relative));
}

/** The files to export: every file of the folder except build output, tool state and the generated bibliography. */
async function exportableFiles(paths: PathOps, project: ReadyProject): Promise<{ sources: string[]; generated: string }> {
  const found = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(project.folder), "**/*"));
  const list = found.map((uri) => paths.relative(project.folder, uri.fsPath).split(paths.sep).join("/")).sort();
  // TRAP: core drops only the literal labshelf.bib; a custom `bibliography:` path is removed here.
  const generated = project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  return { sources: projectFiles(list).filter((path) => path !== generated), generated };
}

async function readAll(project: ReadyProject, relatives: string[]): Promise<ZipEntries> {
  const bytes = await Promise.all(relatives.map((relative) => readBytes(project, relative)));
  return Object.fromEntries(relatives.map((relative, index) => [relative, bytes[index]!]));
}

export async function projectZipEntries(paths: PathOps, project: ReadyProject): Promise<ZipEntries> {
  return await readAll(project, (await exportableFiles(paths, project)).sources);
}

/** The project's files with each .bib cut to the entries the sources cite. */
export async function arxivZipEntries(paths: PathOps, project: ReadyProject, root: string): Promise<ZipEntries> {
  const { sources, generated } = await exportableFiles(paths, project);
  const bibPaths = bibliographyFiles(await readText(project, root), generated).filter((path) => sources.includes(path));
  const bibs = await Promise.all(bibPaths.map(async (path) => ({ path, text: await readText(project, path) })));
  const { format } = project.settings;
  const texts = await Promise.all(sources.filter((path) => path.endsWith(SOURCE_EXTENSION[format])).map((path) => readText(project, path)));
  const cited = [...new Set(texts.flatMap((text) => scanCitationKeys(format, text)))];
  const bundle = arxivBundle(sources, bibs, cited);
  const entries = await readAll(project, bundle.files);
  for (const bib of bundle.bibs) { entries[bib.path] = encoder.encode(bib.text); }
  return entries;
}
