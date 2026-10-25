// Implements `labshelf cite`: picks a paper on the terminal, prints its citation on stdout and updates labshelf.bib.
import { citationSnippet, errorMessage, type PaperRecord, type ProjectFormat } from "@labshelf/core";

import type { AppContext } from "../../compositionRoot.js";
import { UsageError, type Output } from "../usage.js";
import { addToBibliography, locateProject, type ReadyProject } from "./citationProject.js";
import { openDevTty, type CiteTty } from "./tty.js";
import { pickPaper } from "./paperPicker.js";

type CiteFormat = ProjectFormat | "key";

const FORMATS: readonly CiteFormat[] = ["latex", "typst", "key"];

function parseFormat(value: string | boolean | undefined, project: ReadyProject | undefined): CiteFormat {
  if (value === undefined) { return project?.settings.format ?? "latex"; }
  if (typeof value === "string" && (FORMATS as readonly string[]).includes(value)) { return value as CiteFormat; }
  throw new UsageError(`--format takes latex, typst or key, not "${String(value)}".`);
}

/**
 * The picker draws on /dev/tty, so stdout carries the citation alone and an editor can capture it.
 * @param positionals an optional project folder; else the project containing the working directory
 * @param tty the terminal to draw on; the controlling terminal when omitted
 * @returns the exit code: 1 when the picker is cancelled or the library is empty
 */
export async function runCite(
  ctx: Pick<AppContext, "store" | "logger">,
  positionals: string[],
  flags: Record<string, string | boolean>,
  io: Output,
  tty?: CiteTty,
): Promise<number> {
  const papers: PaperRecord[] = [...ctx.store.snapshot.papers.values()]
    .map((entry) => entry.record).filter((record) => record.citeKey !== "");
  if (papers.length === 0) {
    io.err("The library has no papers to cite.");
    return 1;
  }
  const located = await locateProject(positionals[0], ctx.logger);
  const project = "project" in located ? located.project : undefined;
  const format = parseFormat(flags["format"], project);
  const terminal = tty ?? openDevTty();
  let picked: PaperRecord | undefined;
  try {
    picked = await pickPaper(papers, terminal);
  } finally {
    terminal.close();
  }
  if (picked === undefined) { return 1; }
  io.out(format === "key" ? picked.citeKey : citationSnippet(format, picked.citeKey));
  if (project === undefined) {
    io.err(`labshelf.bib not updated: ${"reason" in located ? located.reason : ""}.`);
    return 0;
  }
  try {
    await addToBibliography(project, picked, papers, ctx.logger);
  } catch (error) {
    await ctx.logger.error("terminal.cite", error, { folder: project.folder });
    io.err(`labshelf.bib not updated: ${errorMessage(error)}`);
  }
  return 0;
}
