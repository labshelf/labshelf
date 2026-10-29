// Lists, creates, reads and edits the .qmd notes of a project through an injected file port, one queued load-modify-save per file.
// CONTRACT: documents/contracts/qmd-items.md#items
import { KeyedQueue } from "../../async/index.js";
import { stemOf } from "../../path/index.js";
import type { ILogger } from "../../ports/index.js";
import {
  addItem,
  newItemId,
  parseItemFile,
  removeItem,
  serializeItemFile,
  setItemBody,
  type ItemFile,
} from "../item/index.js";
import { deriveNoteSlug } from "./noteSlug.js";

/** Paths are relative to the project folder, e.g. `notes/<slug>.qmd`. */
export interface IProjectNoteFiles {
  /** Any project file paths; the store keeps only the names ending exactly in `.qmd`. */
  list(projectId: string): Promise<string[]>;
  /** The file text, or null when the file does not exist. */
  read(projectId: string, path: string): Promise<string | null>;
  /** Writes the whole file atomically. */
  write(projectId: string, path: string, text: string): Promise<void>;
}

export interface ProjectNoteEntry { path: string; title: string }

export interface ProjectNotesStore {
  list(projectId: string): Promise<ProjectNoteEntry[]>;
  /** @returns the path of the new note file. */
  create(projectId: string, title: string): Promise<string>;
  /** @returns the file text, or null when the file does not exist. */
  read(projectId: string, path: string): Promise<string | null>;
  /** @returns the item id: `id` when given, else a new one. A missing file is created with that one item. */
  addItem(projectId: string, path: string, body: string, author?: string, id?: string): Promise<string>;
  /** Rejects, writing nothing, when no item has the id. */
  editItem(projectId: string, path: string, id: string, body: string): Promise<void>;
  /** Rejects, writing nothing, when no item has the id. */
  removeItem(projectId: string, path: string, id: string): Promise<void>;
}

const NOTES_DIR = "notes";

function isNotePath(path: string): boolean {
  return path.endsWith(".qmd");
}

/** @returns the text of the first heading line of the first item, else the file base name. */
function titleOf(text: string, path: string): string {
  for (const segment of parseItemFile(text).segments) {
    if (segment.kind !== "item") { continue; }
    const match = /^#[ \t]+(.+?)[ \t]*$/m.exec(segment.body);
    if (match?.[1]) { return match[1]; }
    break;
  }
  return stemOf(path);
}

export function createProjectNotesStore(files: IProjectNoteFiles, logger: ILogger): ProjectNotesStore {
  const queue = new KeyedQueue();

  const mutate = <T>(
    projectId: string,
    path: string,
    change: (file: ItemFile) => { file: ItemFile; result: T },
  ): Promise<T> =>
    queue.run(`${projectId}\u0000${path}`, async () => {
      const { file, result } = change(parseItemFile((await files.read(projectId, path)) ?? ""));
      try {
        await files.write(projectId, path, serializeItemFile(file));
      } catch (error) {
        void logger.error("projectNotes", error, { projectId, path });
        throw error;
      }
      return result;
    });

  const listPaths = async (projectId: string): Promise<string[]> => (await files.list(projectId)).filter(isNotePath);

  const add = (projectId: string, path: string, body: string, author?: string, id?: string): Promise<string> =>
    mutate(projectId, path, (file) => {
      const itemId = id ?? newItemId();
      const next = addItem(file, {
        id: itemId,
        body,
        created: new Date().toISOString(),
        ...(author ? { author } : {}),
      });
      return { file: next, result: itemId };
    });

  return {
    async list(projectId) {
      const paths = await listPaths(projectId);
      return Promise.all(
        paths.map(async (path) => ({ path, title: titleOf((await files.read(projectId, path)) ?? "", path) })),
      );
    },
    async create(projectId, title) {
      // Serialised per project so two creates with one title get distinct slugs.
      return queue.run(`${projectId}\u0000create`, async () => {
        const taken = new Set((await listPaths(projectId)).map(stemOf));
        const path = `${NOTES_DIR}/${deriveNoteSlug(title, taken)}.qmd`;
        await add(projectId, path, `# ${title}\n`);
        return path;
      });
    },
    read: (projectId, path) => files.read(projectId, path),
    addItem: add,
    editItem: (projectId, path, id, body) =>
      mutate(projectId, path, (file) => ({ file: setItemBody(file, id, body), result: undefined })),
    removeItem: (projectId, path, id) =>
      mutate(projectId, path, (file) => ({ file: removeItem(file, id), result: undefined })),
  };
}
