// Moves paper notes from the old `.research/papers/<id>/notes.qmd` into each paper's own folder, once per library open.
// CONTRACT: documents/contracts/library-format.md#layout
import { sameBytes } from "../encoding/index.js";
import type { PaperRecord } from "../model/index.js";
import type { ILogger, LibraryFileSystem } from "../ports/index.js";
import { PAPER_NOTES_FILE, createLibraryLayout, type Join } from "./layout.js";

const MODULE = "paperNotesMove";

export interface PaperNotesMoveOptions {
  logger?: ILogger;
  /** The UUID a conflict copy's name carries; a random one by default. */
  newCopyId?: () => string;
}

/** The ids of the papers each step touched. */
export interface PaperNotesMoveResult {
  /** Old notes moved into a paper folder that had none (or only an empty one). */
  moved: string[];
  /** Old notes deleted because the paper folder held the same text. */
  removed: string[];
  /** Old notes put beside the paper folder's own as a conflict copy, for the item-file merge. */
  conflicts: string[];
  /** Papers that got an empty notes.qmd. */
  created: string[];
}

type MoveFs = Pick<LibraryFileSystem, "stat" | "readFile" | "writeFile" | "deleteFile">;

async function readIfFile(fs: MoveFs, file: string): Promise<Uint8Array | undefined> {
  return (await fs.stat(file))?.isFile ? await fs.readFile(file) : undefined;
}

/** Writes `bytes` to `file` and reads them back; throws when they differ, so the caller keeps its source. */
async function writeChecked(fs: MoveFs, file: string, bytes: Uint8Array): Promise<void> {
  await fs.writeFile(file, bytes);
  if (!sameBytes(await fs.readFile(file), bytes)) { throw new Error(`${file} reads back different content`); }
}

/**
 * For each indexed paper with an old notes.qmd: moves it into the paper folder when that has no notes.qmd or an empty
 * one, deletes it when the paper folder holds the same text, and otherwise keeps the paper folder's file and puts the
 * old one beside it as a `.labshelf-conflict-<UUID>` copy, which the item-file merge folds in. Then gives every indexed
 * paper whose folder exists an empty notes.qmd if it has none. A paper the index does not hold keeps its old file.
 * Idempotent; the old file is deleted only after its text is written and read back elsewhere, and a failure for one
 * paper is logged and leaves it as it was.
 * @param papers the library index: each paper's id and folder
 */
export async function movePaperNotesToPaperFolders(
  fs: MoveFs, root: string, join: Join<string>, papers: Iterable<Pick<PaperRecord, "id" | "path">>, options: PaperNotesMoveOptions = {},
): Promise<PaperNotesMoveResult> {
  const layout = createLibraryLayout(root, join);
  const newCopyId = options.newCopyId ?? (() => globalThis.crypto.randomUUID());
  const result: PaperNotesMoveResult = { moved: [], removed: [], conflicts: [], created: [] };
  for (const paper of papers) {
    const oldFile = join(layout.paperDataDir(paper.id), PAPER_NOTES_FILE);
    const newFile = join(paper.path, PAPER_NOTES_FILE);
    try {
      if (!(await fs.stat(paper.path))?.isDirectory) { continue; }
      const old = await readIfFile(fs, oldFile);
      const current = await readIfFile(fs, newFile);
      if (old !== undefined) {
        if (current === undefined || new TextDecoder().decode(current).trim() === "") {
          await writeChecked(fs, newFile, old);
          result.moved.push(paper.id);
        } else if (sameBytes(old, current)) {
          result.removed.push(paper.id);
        } else {
          await writeChecked(fs, `${newFile}.labshelf-conflict-${newCopyId()}`, old);
          result.conflicts.push(paper.id);
        }
        await fs.deleteFile(oldFile);
      } else if (current === undefined) {
        await fs.writeFile(newFile, new Uint8Array());
        result.created.push(paper.id);
      }
    } catch (error) {
      void options.logger?.error(MODULE, error, { paperId: paper.id, action: "move paper notes into the paper folder" });
    }
  }
  if (result.moved.length + result.removed.length + result.conflicts.length > 0) {
    void options.logger?.log("INFO", MODULE, "Moved paper notes into the paper folders", {
      moved: result.moved.length, removed: result.removed.length, conflicts: result.conflicts.length,
    });
  }
  return result;
}
