// Finds the citing command of each key on one source line, with its project-relative file and the page it names.
import { findCiteKeyOccurrences, type CitingCommand, type PathOps, type ProjectFormat } from "@labshelf/core";
import type { LocatedSourceLine } from "./findSourceLine.js";

/** Where a key is cited and the page its `[p.~N]` argument names, if any. */
export interface CitedCommand {
  command: CitingCommand;
  page?: number;
}

/** The first command on the line that cites each key; a key not cited on the line has no site. */
export function listCitingSites(paths: PathOps, format: ProjectFormat, projectFolder: string, source: LocatedSourceLine, keys: readonly string[]): Map<string, CitedCommand> {
  const file = paths.relative(projectFolder, source.file).split(paths.sep).join("/");
  const sites = new Map<string, CitedCommand>();
  for (const cited of findCiteKeyOccurrences(format, source.text)) {
    const line = source.text.slice(0, cited.start).split("\n").length;
    if (line !== source.line || !keys.includes(cited.key) || sites.has(cited.key)) { continue; }
    sites.set(cited.key, { command: { file, line, text: cited.command }, ...(cited.page !== undefined ? { page: cited.page } : {}) });
  }
  return sites;
}
