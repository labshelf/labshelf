// Stores a file's tracked changes for the editor's review mode: over comments.qmd in a local project, over the share's suggestions in a shared one, and the routing between them.
// CONTRACT: documents/contracts/collaboration.md#comments
import {
  addSuggestions, COMMENTS_PATH, deriveSuggestionAnchor, deriveSuggestions, findSuggestion, loadCommentsDocument, removeSuggestions, toFileSuggestion, toSuggestion,
  type FileSuggestion, type ILogger, type LibraryFileSystem, type SharedProjectSuggestions, type Suggestion, type TextRange,
} from "@labshelf/core";
import type { EditorSuggestions } from "@labshelf/core/dom";
import { accessOf, createChangeEmitter, editComments, openFolder, readFileText, type Session } from "./comments";
import type { PageShares } from "./pageShares";

const SUGGESTIONS_MODULE = "collab.suggestions";

/** The suggestions of one file of a project, as the editor's review port. */
export interface ProjectSuggestions {
  suggestionsFor(projectId: string, path: string): EditorSuggestions;
}

export interface FileSuggestionsOptions {
  fs: LibraryFileSystem;
  session: Session;
  logger: ILogger;
}

/** The suggestions of `path` that still sit in the text, with their positions; the detached ones are left out. */
function locatedIn(all: readonly Suggestion[], path: string, locate: (s: Suggestion) => TextRange | "detached"): FileSuggestion[] {
  const found: FileSuggestion[] = [];
  for (const each of all) {
    if (each.file !== path) { continue; }
    const range = locate(each);
    if (range !== "detached") { found.push(toFileSuggestion(each, range)); }
  }
  return found;
}

/** The suggestions over comments.qmd of the open project. */
export function createFileSuggestions({ fs, session, logger }: FileSuggestionsOptions): ProjectSuggestions {
  const { notify, onDidChange } = createChangeEmitter();

  const read = async (projectId: string, path: string): Promise<FileSuggestion[]> => {
    const folder = openFolder(session, projectId);
    const doc = await loadCommentsDocument(accessOf(fs, folder));
    if (!doc) { throw new Error(`${COMMENTS_PATH} is not a valid comments file. Fix the file to see suggestions.`); }
    const text = await readFileText(fs, folder, path);
    return text === undefined ? [] : locatedIn(deriveSuggestions(doc), path, (each) => findSuggestion(each, text));
  };

  const edit = editComments(fs, logger, SUGGESTIONS_MODULE, notify);

  return {
    suggestionsFor: (projectId, path) => ({
      subscribe(listener) {
        const push = (): void => {
          read(projectId, path).then(listener, (error: unknown) => { void logger.error(SUGGESTIONS_MODULE, error, { action: "read suggestions", projectId, path }); });
        };
        push();
        return onDidChange(push);
      },
      async add(suggestions) {
        if (suggestions.length === 0) { return; }
        const folder = openFolder(session, projectId);
        // The editor adds after its save flush, so the file's text is the one its offsets are in.
        const source = await readFileText(fs, folder, path);
        if (source === undefined) { throw new Error(`${path} does not exist in the project, so it cannot hold suggestions`); }
        const added = suggestions.map((each) => toSuggestion(each, path, deriveSuggestionAnchor(source, each.kind, each.start, each.end)));
        await edit(folder, (doc) => addSuggestions(removeSuggestions(doc, added.map((each) => each.id)), added), "add suggestions");
      },
      async remove(ids) {
        if (ids.length === 0) { return; }
        await edit(openFolder(session, projectId), (doc) => removeSuggestions(doc, ids), "remove suggestions");
      },
    }),
  };
}

/** The editor's port over a share's suggestions. */
function sharedEditorSuggestions(shared: SharedProjectSuggestions, path: string): EditorSuggestions {
  const list = (): FileSuggestion[] => locatedIn(shared.suggestions(), path, (each) => shared.locate(each));
  return {
    subscribe(listener) {
      listener(list());
      return shared.onChange(() => listener(list()));
    },
    async add(suggestions) {
      if (suggestions.length === 0) { return; }
      const added = suggestions.map((each) => toSuggestion(each, path, shared.anchor(path, each.kind, { start: each.start, end: each.end })));
      const present = new Set(shared.suggestions().map((each) => each.id));
      shared.remove(added.filter((each) => present.has(each.id)).map((each) => each.id));
      shared.add(added);
    },
    async remove(ids) {
      shared.remove(ids);
    },
  };
}

export interface RoutedSuggestionsOptions {
  /** The store over comments.qmd. */
  files: ProjectSuggestions;
  shares: Pick<PageShares, "live" | "onChange">;
}

/** Uses the share's suggestions while the project is shared and connected here, and comments.qmd otherwise. */
export function createRoutedSuggestions({ files, shares }: RoutedSuggestionsOptions): ProjectSuggestions {
  const storeFor = (projectId: string, path: string): EditorSuggestions => {
    const live = shares.live(projectId)?.suggestions;
    return live ? sharedEditorSuggestions(live, path) : files.suggestionsFor(projectId, path);
  };
  return {
    suggestionsFor: (projectId, path) => ({
      subscribe(listener) {
        let stop = storeFor(projectId, path).subscribe(listener);
        const stopShares = shares.onChange(() => { stop(); stop = storeFor(projectId, path).subscribe(listener); });
        return () => { stopShares(); stop(); };
      },
      add: (suggestions) => storeFor(projectId, path).add(suggestions),
      remove: (ids) => storeFor(projectId, path).remove(ids),
    }),
  };
}
