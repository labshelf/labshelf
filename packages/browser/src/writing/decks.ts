// New Presentation and New Poster of the project menu in the browser: asks the format, title and size and writes the deck folder itself.
import {
  deckFolderName, deckRootOf, findFreeDeckName, listDeckSizePresets, listSourceDeckShapes, posixPathOps, scaffoldDeck, scaffoldSourceDeck, sourceDeckMainFile,
  type DeckKind, type LibraryFileSystem, type ProjectEntry, type SourceDeckFormat, type SourceDeckShape,
} from "@labshelf/core";
import { askInputBox, pickQuickEntry } from "@labshelf/core/dom";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const NOUN: Record<DeckKind, string> = { talk: "Presentation", poster: "Poster" };
const FORMAT_LABEL: Record<SourceDeckFormat, string> = { latex: "LaTeX", typst: "Typst" };

const formatOf = (project: ReadyProject): SourceDeckFormat => (project.settings.format === "typst" ? "typst" : "latex");

/**
 * Writes a new presentation or poster into the project: a visual deck (deck.html and theme.css) or the project format's source (main.tex or main.typ)
 * in talks/<name>/ or posters/<name>/. Returns the project-relative path to open, or undefined when the user cancelled.
 */
export async function createDeck(fs: Pick<LibraryFileSystem, "exists" | "ensureDir" | "writeText">, project: ReadyProject, kind: DeckKind): Promise<string | undefined> {
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
