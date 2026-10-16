// Imports the papers a writing project lists in labshelf.yaml and the library lacks, so its citations resolve.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  describeInstall, keyResolves, parseProjectFile, planInstall, PROJECT_FILE, summarizeInstall,
  type ILogger, type ImportOutcome, type InstallResult, type LibraryStore, type ListedPaper,
} from "@labshelf/core";

import { UsageError, type Output } from "../usage.js";

/** What the command needs of the opened library. */
export interface InstallContext {
  store: Pick<LibraryStore, "snapshot">;
  papers: { importDoi(doi: string, citeKey: string): Promise<ImportOutcome> };
  logger: ILogger;
}

async function listedPapers(projectDir: string): Promise<ListedPaper[]> {
  const file = path.join(projectDir, PROJECT_FILE);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    throw new UsageError(`No ${PROJECT_FILE} in ${projectDir}. Run install inside a writing project.`);
  }
  const parsed = parseProjectFile(text);
  if (!parsed.ok) { throw new UsageError(`${file}: ${parsed.reason}`); }
  return parsed.settings.papers ?? [];
}

/**
 * Imports, one at a time, each listed paper whose cite key the library lacks; one at a time so a DOI listed twice
 * is found by the second import's duplicate check.
 * @returns the exit code: 1 when a listed key still does not resolve
 */
export async function runInstall(ctx: InstallContext, positionals: string[], io: Output): Promise<number> {
  const projectDir = path.resolve(positionals[0] ?? process.cwd());
  const records = [...ctx.store.snapshot.papers.values()].map((entry) => entry.record);
  const plan = planInstall(await listedPapers(projectDir), records);
  const results: InstallResult[] = [];
  for (const entry of plan) {
    const outcome = entry.kind === "import" ? await ctx.papers.importDoi(entry.doi, entry.key) : undefined;
    results.push({ entry, outcome });
    io.out(describeInstall({ entry, outcome }).text);
  }
  const summary = summarizeInstall(results);
  io.out(summary.text);
  await ctx.logger.log("INFO", "terminal.install", "Project papers installed", { projectDir, summary: summary.text });
  return results.some((result) => !keyResolves(result)) ? 1 : 0;
}
