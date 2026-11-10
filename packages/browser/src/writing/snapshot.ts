// Builds the sidebar snapshot of an open project: its files, outline and checklist trees, and the talks and posters it marks.
import {
  buildChecklist, deriveChecklistSidebarNodes, deriveCitationSections, deriveNestedHeadings, findOutlineHeadings, posixPathOps, createDeckShortcutRows, listProjectDeckFiles, listProjectFileTree, readChecklistSignals, createSectionPlacer, createLibraryCodeSource,
  type ChecklistGrouping, type DeckKind, type HeadingNode, type NoteTask, type ProjectNotesStore, type ILogger, type LibraryFileSystem, type OutlineHeading, type ProjectEntry, type ProjectReadContext,
  type SidebarOpenProject, type SidebarProjectTree, type SidebarTreeNode,
} from "@labshelf/core";
import { QMD_VOCABULARY } from "@labshelf/core/dom";

const MODULE = "writing.snapshot";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export type OpenProjectSnapshot = (entry: ProjectEntry, grouping: ChecklistGrouping) => Promise<SidebarOpenProject>;

/** The project notes the checklist reads and ticks: the store, and the note tasks of the last checklist built by their row keys. */
export interface SessionNotes {
  store: ProjectNotesStore;
  tasks: Map<string, NoteTask>;
}

export interface OpenProjectSnapshotOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
  /** Without it the checklist shows no note tasks. */
  notes?: SessionNotes;
}

function outlineNodes(main: string, headings: HeadingNode<OutlineHeading>[]): SidebarTreeNode[] {
  return headings.map(({ entry, children }) => ({
    key: `${main}:${entry.line}`,
    label: entry.title || "Untitled",
    clickable: true,
    ...(children.length > 0 ? { children: outlineNodes(main, children), open: true } : {}),
  }));
}

async function readOutline(context: ProjectReadContext, project: ReadyProject): Promise<SidebarTreeNode[]> {
  if (project.main === undefined) { return []; }
  const text = await context.fs.readText(context.paths.join(project.folder, project.main));
  return outlineNodes(project.main, deriveNestedHeadings(findOutlineHeadings(project.settings.format, text)));
}

async function checklistNodes(context: ProjectReadContext, project: ReadyProject, grouping: ChecklistGrouping, notes: SessionNotes | undefined): Promise<SidebarTreeNode[]> {
  const signals = await readChecklistSignals(context, project, notes && { store: notes.store, projectId: project.settings.id }, undefined, createLibraryCodeSource(context, project.folder));
  const main = project.main ?? "";
  const checklist = buildChecklist({
    ...signals, pageOverflow: undefined, reading: [], placeSection: createSectionPlacer(signals.sources, main), citeSections: deriveCitationSections(signals.sources, main),
  }, grouping);
  const tree = deriveChecklistSidebarNodes({ paths: posixPathOps, checklist, grouping, pageCount: undefined, reading: new Map(), noteTitles: signals.noteTitles, isExpanded: (_, byDefault) => byDefault });
  if (notes) {
    notes.tasks.clear();
    for (const [key, item] of tree.items) { if (item.kind === "noteTask") notes.tasks.set(key, item.task); }
  }
  return tree.nodes;
}

export function createOpenProjectSnapshot({ fs, logger, notes }: OpenProjectSnapshotOptions): OpenProjectSnapshot {
  const context: ProjectReadContext = { fs, paths: posixPathOps, logger };

  // One unreadable tree must not blank the others: it is logged and shown empty.
  const guard = async (view: SidebarProjectTree["view"], project: ReadyProject, build: () => Promise<SidebarTreeNode[]>): Promise<SidebarTreeNode[]> => {
    try { return await build(); } catch (error) {
      await logger.error(MODULE, error, { action: "build sidebar tree", view, folder: project.folder });
      return [];
    }
  };

  return async (entry, grouping) => {
    if (entry.kind !== "ready") { throw new Error(`${entry.folder}: a broken project has no sidebar trees`); }
    const [files, outline, checklist] = await Promise.all([
      guard("files", entry, async () => {
        // The talks and posters come first as one-click rows, then the folder tree marking the same files.
        const decks = await readDeckKinds(context, entry, logger);
        return [...createDeckShortcutRows(decks), ...(await listProjectFileTree(context, entry, entry.folder, "", decks))];
      }),
      guard("outline", entry, () => readOutline(context, entry)),
      guard("checklist", entry, () => checklistNodes(context, entry, grouping, notes)),
    ]);
    return {
      id: entry.folder, name: entry.settings.title ?? entry.settings.id, format: entry.settings.format,
      trees: [
        { view: "files", title: "Files", actions: [...(notes ? [{ action: "newNote", label: `New ${QMD_VOCABULARY.item}`, icon: "plus" as const }] : []), { action: "importFiles", label: "Import files from your computer", icon: "upload" }, { action: "history", label: "History", icon: "history" }, { action: "comments", label: "Comments", icon: "message" }], nodes: files, empty: "No files." },
        { view: "outline", title: "Outline", actions: [], nodes: outline, empty: "Open a source file to see its outline." },
        {
          view: "checklist", title: "Checklist", actions: [], nodes: checklist, empty: "Nothing to do.",
          toggle: { options: [{ action: "byKind", label: "By kind" }, { action: "bySection", label: "By section" }], selected: grouping === "kind" ? "byKind" : "bySection" },
        },
      ],
    };
  };
}


// The talks and posters of each project read by its last sidebar snapshot, by project folder then project-relative path.
const deckKinds = new Map<string, ReadonlyMap<string, DeckKind>>();

/** The kind of talk or poster a project file was when the sidebar last read the project; undefined for any other file or before the first read. */
export function knownDeckKind(projectFolder: string, path: string): DeckKind | undefined {
  return deckKinds.get(projectFolder)?.get(path);
}

/** The talks and posters of the project by path, which the Files rows mark and the editor area opens them by; a scan that fails is logged and marks none. */
async function readDeckKinds(context: ProjectReadContext, project: ReadyProject, logger: ILogger): Promise<Map<string, DeckKind>> {
  try {
    const found = new Map((await listProjectDeckFiles(context, project.folder)).map((deck) => [deck.path, deck.kind]));
    deckKinds.set(project.folder, found);
    return found;
  } catch (error) {
    await logger.error(MODULE, error, { action: "find talks and posters", folder: project.folder });
    return new Map();
  }
}
