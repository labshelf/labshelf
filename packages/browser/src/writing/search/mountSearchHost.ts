// Answers the shared project search page in the same page: searches the project's saved files and applies its opens and replacements.
import {
  emptySearchRun,
  matchesIn,
  posixPathOps,
  searchProjectTexts,
  type HostToSearch,
  type ILogger,
  type LibraryFileSystem,
  type MatchLocation,
  type MessageEnd,
  type SearchOptions,
  type SearchToHost,
  isSearchableFile,
  listProjectFiles,
  type ProjectText,
  matchReplacement,
} from "@labshelf/core";
import { confirmDialog, toast } from "@labshelf/core/dom";
import { flushProjectEditors, reloadProjectEditors } from "../session";
import { recordProjectEdit } from "../history";

/** Replaces the matches in their files; a match whose text changed since the search is left alone. */
export async function replaceInFiles(fs: LibraryFileSystem, matches: readonly MatchLocation[], pattern: RegExp, replacement: string): Promise<number> {
  const byPath = new Map<string, MatchLocation[]>();
  for (const match of matches) byPath.set(match.path, [...(byPath.get(match.path) ?? []), match]);
  let count = 0;
  for (const [path, inFile] of byPath) {
    const original = await fs.readText(path);
    // The capture group keeps each line's own ending; text sits at even indexes.
    const parts = original.split(/(\r?\n)/);
    const lines = [...parts];
    // Highest column first, so an edit never shifts the columns of those still to apply.
    for (const { line, column, length } of [...inFile].sort((a, b) => b.line - a.line || b.column - a.column)) {
      const text = lines[line * 2];
      if (text === undefined) continue;
      // Computed against the original line, so one edit never changes what another match expands to.
      const replaced = matchReplacement(text, pattern, { column, length }, replacement);
      if (replaced === undefined) continue;
      const current = parts[line * 2]!;
      parts[line * 2] = current.slice(0, column) + replaced + current.slice(column + length);
      count += 1;
    }
    const next = parts.join("");
    if (next !== original) await fs.writeText(path, next);
  }
  return count;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The project's searchable files with their saved text; files over 2 MB are skipped. */
async function projectSearchTexts(fs: LibraryFileSystem, folder: string): Promise<ProjectText[]> {
  const relatives = (await listProjectFiles({ fs, paths: posixPathOps }, folder)).filter(isSearchableFile);
  const texts: ProjectText[] = [];
  for (const relative of relatives) {
    const path = posixPathOps.join(folder, relative);
    if (((await fs.stat(path))?.size ?? 0) > MAX_FILE_BYTES) continue;
    texts.push({ path, text: await fs.readText(path) });
  }
  return texts;
}

const MODULE = "writing.search";
const DEBOUNCE_MS = 150;

export interface SearchHostOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
  endpoint: MessageEnd<HostToSearch, SearchToHost>;
  project: { id: string; folder: string };
  /** Opens the file (relative to the project folder) with the 0-based line in view. */
  openMatch(relative: string, line: number): void;
}

type Replacing = Extract<SearchToHost, { type: "replace" | "replaceFile" | "replaceAll" }>;

export function mountSearchHost({ fs, logger, endpoint, project, openMatch }: SearchHostOptions): { dispose(): void } {
  let request: { query: string; options: SearchOptions } | undefined;
  let pattern: RegExp | undefined;
  let searched: ReadonlySet<string> = new Set();
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function search(): Promise<void> {
    const mine = ++ticket;
    if (!request) return;
    const { query, options } = request;
    if (query === "") { ({ pattern, paths: searched } = emptySearchRun()); endpoint.post(emptySearchRun().message); return; }
    // Unsaved editor text reaches the disk first, so the search reads what the editors show.
    await flushProjectEditors(project.id);
    const run = searchProjectTexts(query, options, { folder: project.folder, paths: posixPathOps }, await projectSearchTexts(fs, project.folder));
    if (mine !== ticket) return;
    pattern = run.pattern;
    searched = run.paths;
    endpoint.post(run.message);
  }

  const searchLater = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      search().catch((error: unknown) => {
        void logger.error(MODULE, error, { action: "search", projectId: project.id, folder: project.folder });
        endpoint.post({ type: "invalid", message: `Search failed: ${error instanceof Error ? error.message : String(error)}` });
      });
    }, DEBOUNCE_MS);
  };

  async function matchesToReplace(message: Replacing, regex: RegExp): Promise<MatchLocation[]> {
    if (message.type === "replace") return [message];
    const texts = await projectSearchTexts(fs, project.folder);
    return matchesIn(texts, regex, message.type === "replaceFile" ? message.path : undefined);
  }

  async function replace(message: Replacing): Promise<void> {
    const regex = pattern;
    if (!regex) return;
    if (!(await flushProjectEditors(project.id))) {
      void logger.log("WARN", MODULE, "replace aborted: an open file could not be saved", { projectId: project.id });
      toast(`Could not save an open file of ${project.id}, so nothing was replaced.`, "error");
      return;
    }
    const matches = await matchesToReplace(message, regex);
    // The page is not trusted with arbitrary paths: only files the last search covered change.
    if (matches.length === 0 || matches.some(({ path }) => !searched.has(path))) return;
    if (message.type === "replaceAll") {
      const files = new Set(matches.map(({ path }) => path)).size;
      const question = `Replace ${matches.length} ${matches.length === 1 ? "match" : "matches"} in ${files} ${files === 1 ? "file" : "files"}?`;
      if (!(await confirmDialog(question, "The change is saved to the files at once. The project history keeps the previous text.", "Replace All"))) return;
    }
    const count = await replaceInFiles(fs, matches, regex, message.replacement);
    await reloadProjectEditors(project.id);
    await recordProjectEdit({ fs, logger }, project);
    void logger.log("INFO", MODULE, "replaced matches in a project", { projectId: project.id, matches: count });
    await search();
  }

  async function handle(message: SearchToHost): Promise<void> {
    if (message.type === "ready") {
      request = undefined;
      endpoint.post({ type: "scope", scope: { project: project.id, folder: project.folder, file: null } });
    } else if (message.type === "search") {
      request = { query: message.query, options: message.options };
      searchLater();
    } else if (message.type === "open") {
      if (searched.has(message.path)) openMatch(posixPathOps.relative(project.folder, message.path), message.line);
    } else {
      await replace(message);
    }
  }

  const stop = endpoint.subscribe((message) => {
    handle(message).catch((error: unknown) => {
      void logger.error(MODULE, error, { action: message.type, projectId: project.id, folder: project.folder });
      toast(`Search: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  });
  return { dispose: () => { ticket += 1; clearTimeout(timer); stop(); } };
}
