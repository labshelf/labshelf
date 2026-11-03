// The open project's Talks & Posters in the browser sidebar: visual decks and LaTeX or Typst talks and posters with their slides or blocks,
// and New talk or poster, which asks the kind, format, title and size and writes the deck folder itself.
import {
  deleteSourceSlide, deckFolderName, deckRootOf, duplicateSourceSlide, moveSourceSlide, findFreeDeckName, listDeckSizePresets, listDecks, listSourceDeckShapes, listSourceDecks, posixPathOps, readSourceDeckOutline, scaffoldDeck,
  scaffoldSourceDeck, sourceDeckMainFile, type DeckKind, type LibraryFileSystem, type ProjectEntry, type ProjectReadContext, type SidebarTreeNode,
  type SourceDeckFormat, type SourceDeckShape,
} from "@labshelf/core";
import { askDialog, askInputBox, pickQuickEntry } from "@labshelf/core/dom";
import { refreshProjectEditors, writeProjectEditors } from "@labshelf/core/sourceEditor";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const NOUN: Record<DeckKind, string> = { talk: "Talk", poster: "Poster" };
const FORMAT_LABEL: Record<SourceDeckFormat, string> = { latex: "LaTeX", typst: "Typst" };

const SLIDE_MENU: NonNullable<SidebarTreeNode["menu"]> = [
  { label: "Move Up", action: "moveSlideUp" },
  { label: "Move Down", action: "moveSlideDown" },
  { label: "Duplicate", action: "duplicateSlide" },
  { label: "Delete", action: "deleteSlide", danger: true },
];

const formatOf = (project: ReadyProject): SourceDeckFormat => (project.settings.format === "typst" ? "typst" : "latex");

/** A deck row's key: `deck:<project-relative file>`; a slide or block row's: `item:<file>:<zero-based line>`. */
export function parseDeckKey(key: string): { kind: "deck"; path: string } | { kind: "item"; path: string; line: number } | null {
  if (key.startsWith("deck:")) return { kind: "deck", path: key.slice(5) };
  const match = /^item:(.+):(\d+)$/.exec(key);
  return match ? { kind: "item", path: match[1]!, line: Number(match[2]) } : null;
}

/** The Talks & Posters rows of a project: talks first, by name, each source one folding open on its slides or blocks. */
export async function listDeckNodes(context: ProjectReadContext, project: ReadyProject): Promise<SidebarTreeNode[]> {
  const format = formatOf(project);
  const visual = (await listDecks(context, project.folder)).map((deck) => ({ kind: deck.kind, name: deck.name, file: deck.file, format: undefined as SourceDeckFormat | undefined }));
  const source = (await listSourceDecks(context, project.folder, { main: project.main ?? "", format })).map((deck) => ({ kind: deck.kind, name: deck.name, file: deck.file, format: deck.format as SourceDeckFormat | undefined }));
  const decks = [...visual, ...source].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "talk" ? -1 : 1));
  return Promise.all(decks.map(async (deck): Promise<SidebarTreeNode> => {
    const node: SidebarTreeNode = {
      key: `deck:${deck.file}`, label: deck.name, description: `${NOUN[deck.kind]} · ${deck.format ? FORMAT_LABEL[deck.format] : "Visual"}`, clickable: true,
      menu: [deck.kind === "talk" ? { label: "Present", action: "present" } : { label: "Poster Preview", action: "posterPreview" }],
    };
    if (!deck.format) return node;
    const text = await context.fs.readText(context.paths.join(project.folder, ...deck.file.split("/"))).catch(() => "");
    const items = readSourceDeckOutline(deck.format, deck.kind, text);
    node.open = false;
    node.children = items.map((item, index) => ({
      key: `item:${deck.file}:${item.line - 1}`, label: item.title, clickable: true, tooltip: `Line ${item.line}`,
      ...(deck.kind === "talk" ? { description: String(index + 1), menu: SLIDE_MENU } : {}),
    }));
    return node;
  }));
}

/**
 * Asks what to make and writes it into the project: a visual deck (deck.html and theme.css) or the project format's source (main.tex or main.typ)
 * in talks/<name>/ or posters/<name>/. Returns the project-relative path to open, or undefined when the user cancelled.
 */
export async function createDeck(fs: Pick<LibraryFileSystem, "exists" | "ensureDir" | "writeText">, project: ReadyProject): Promise<string | undefined> {
  const kind = await pickQuickEntry<DeckKind>([
    { label: "Talk", description: "Slides to present, with a presenter view", value: "talk" },
    { label: "Poster", description: "One page to print, with a real-size preview", value: "poster" },
  ], { title: "New talk or poster", placeholder: "What do you want to make?" });
  if (!kind) return undefined;
  const source = formatOf(project);
  const format = await pickQuickEntry<"html" | SourceDeckFormat>([
    { label: "Visual", description: "Drag-and-drop editor: click to edit text, drag and resize blocks. Saved as HTML.", value: "html" },
    { label: FORMAT_LABEL[source], description: `Write the source; compiled to PDF like the paper${source === "latex" ? (kind === "talk" ? " (Beamer)" : " (tikzposter)") : ""}`, value: source },
  ], { title: `New ${NOUN[kind].toLowerCase()}: how do you want to make it?` });
  if (!format) return undefined;
  const title = (await askInputBox({ title: `${NOUN[kind]} title`, prompt: `${NOUN[kind]} title`, validate: (value) => (value.trim() ? undefined : "Enter a title.") }))?.trim();
  if (!title) return undefined;
  const root = posixPathOps.join(project.folder, deckRootOf(kind));
  const name = await findFreeDeckName({ fs, paths: posixPathOps }, root, deckFolderName(title));
  const folder = posixPathOps.join(root, name);
  const relative = `${deckRootOf(kind)}/${name}`;
  if (format === "html") {
    const size = await pickQuickEntry(listDeckSizePresets(kind).map((preset) => ({ label: preset.label, value: preset.size })), { title: `${NOUN[kind]} size` });
    if (!size) return undefined;
    const { html, theme } = scaffoldDeck(kind, name, size);
    await fs.ensureDir(folder);
    await fs.writeText(posixPathOps.join(folder, "deck.html"), html);
    await fs.writeText(posixPathOps.join(folder, "theme.css"), theme);
    return `${relative}/deck.html`;
  }
  const shape = await pickQuickEntry<SourceDeckShape>(listSourceDeckShapes(kind, format).map((choice) => ({ label: choice.label, ...(choice.description ? { description: choice.description } : {}), value: choice.shape })), { title: `${NOUN[kind]} size` });
  if (!shape) return undefined;
  const file = sourceDeckMainFile(format);
  await fs.ensureDir(folder);
  await fs.writeText(posixPathOps.join(folder, file), scaffoldSourceDeck(format, title, shape));
  return `${relative}/${file}`;
}

/** What a Talks & Posters row menu needs: the project's files, its tabs and the audience tab of a talk. */
export interface DeckMenuDeps {
  fs: Pick<LibraryFileSystem, "readText" | "writeText">;
  openTab(kind: "deck", params: { projectId: string; path: string; view: string }): void;
  openAudience?(deck: { projectId: string; path: string }): Promise<void>;
}

type SlideEdit = (text: string, slides: ReturnType<typeof readSourceDeckOutline>, index: number) => string | null;

const SLIDE_EDITS: Record<string, SlideEdit> = {
  moveSlideUp: (text, slides, index) => moveSourceSlide(text, slides, index, -1),
  moveSlideDown: (text, slides, index) => moveSourceSlide(text, slides, index, 1),
  duplicateSlide: duplicateSourceSlide,
  deleteSlide: deleteSourceSlide,
};

/** Edits a slide of a source talk in its file: open editors are saved first and reloaded after, so the edit lands on what the user sees. */
async function editSlide(deps: DeckMenuDeps, project: ReadyProject, path: string, line: number, action: string): Promise<boolean> {
  const edit = SLIDE_EDITS[action];
  if (!edit) return false;
  const id = project.settings.id;
  await writeProjectEditors(id);
  const file = posixPathOps.join(project.folder, ...path.split("/"));
  const text = await deps.fs.readText(file);
  const slides = readSourceDeckOutline(formatOf(project), "talk", text);
  const index = slides.findIndex((slide) => slide.line - 1 === line);
  if (index < 0) return false;
  if (action === "deleteSlide" && !(await askDialog("Delete slide", `Delete the slide "${slides[index]!.title}"?`, "Delete", true))) return false;
  const next = edit(text, slides, index);
  if (next === null || next === text) return false;
  await deps.fs.writeText(file, next);
  await refreshProjectEditors(id);
  return true;
}

/** Runs a Talks & Posters row menu action; true when the project's files changed. */
export async function runDeckMenu(deps: DeckMenuDeps, project: ReadyProject, key: string, action: string): Promise<boolean> {
  const row = parseDeckKey(key);
  if (!row) return false;
  const projectId = project.settings.id;
  if (row.kind === "item") return editSlide(deps, project, row.path, row.line, action);
  if (action === "posterPreview") deps.openTab("deck", { projectId, path: row.path, view: "poster" });
  if (action === "present") {
    deps.openTab("deck", { projectId, path: row.path, view: "presenter" });
    await deps.openAudience?.({ projectId, path: row.path });
  }
  return false;
}
