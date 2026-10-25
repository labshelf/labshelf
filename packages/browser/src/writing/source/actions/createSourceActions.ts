// Lists the source tab's title-bar actions in the order the VS Code editor shows them.
import type { ILogger, LibraryFileSystem, PaperRecord, ProjectEntry } from "@labshelf/core";
import type { EditorTabAction } from "@labshelf/core/dom";
import type { SourceUpdates, SourceLanguage } from "../sourceUpdates";
import { addCitationFromLibrary } from "./citationFromLibrary";
import { addSymbol, addTable } from "./insertActions";
import { addImage } from "./insertFigure";

/** What the actions edit once the editor and its project have loaded. */
interface ActionTarget {
  edits: SourceUpdates;
  /** Saves the file; resolves whether it is saved afterwards. */
  flush(): Promise<boolean>;
  entry: ProjectEntry;
}

export interface SourceActionDeps {
  projectId: string;
  path: string;
  language: SourceLanguage;
  fs: LibraryFileSystem;
  logger: ILogger;
  /** Undefined until the editor and project have loaded; an action that needs them then does nothing. */
  target(): ActionTarget | undefined;
  openHistory(): void;
  openSearch(): void;
  papers(): Promise<PaperRecord[]>;
}

export function createSourceActions({ path, language, fs, logger, target, openHistory, openSearch, papers }: SourceActionDeps): EditorTabAction[] {
  const withEdits = (act: (edits: SourceUpdates) => void): (() => void) => () => {
    const current = target();
    if (current) act(current.edits);
  };
  return [
    { id: "history", icon: "history", label: "Show Project History", run: openHistory },
    { id: "insertSymbol", icon: "symbol-operator", label: "Insert Symbol", run: withEdits((edits) => void addSymbol(edits, language)) },
    { id: "insertTable", icon: "table", label: "Insert Table", run: withEdits((edits) => void addTable(edits, language)) },
    { id: "insertImage", icon: "file-media", label: "Insert Image", run: () => {
      const current = target();
      if (current?.entry.kind === "ready") void addImage({ edits: current.edits, language, entry: current.entry, path, fs, logger });
    } },
    { id: "searchInProject", icon: "search", label: "Search in Project", run: openSearch },
    { id: "citeFromLibrary", icon: "quote", label: "Cite from Library", run: () => {
      const current = target();
      if (current?.entry.kind === "ready") void addCitationFromLibrary({ edits: current.edits, flush: current.flush, entry: current.entry, fs, logger, papers });
    } },
    { id: "bold", icon: "bold", label: "Bold", overflow: true, run: withEdits((edits) => edits.wrap("bold")) },
    { id: "italic", icon: "italic", label: "Italic", overflow: true, run: withEdits((edits) => edits.wrap("italic")) },
  ];
}
