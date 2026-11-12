// Opens a notes file as a live file for a note tab: every tab of the file edits one replica doc, which the disk writer persists.
import { formatError, type ILogger } from "@labshelf/core";
import type { NoteFileOptions } from "@labshelf/core/dom";
import { readPageLiveFiles } from "../../storage/libraryFileSystem";

const MODULE = "tabs.noteFile";

/** The live file a note tab holds: `live` is what mountNoteFile edits; `close` flushes it then lets it go, once however often it is called. */
export interface NoteFileLiveBinding { live: NonNullable<NoteFileOptions["live"]>; close(): Promise<void> }

/** Opens the library file at `path` as a live file; undefined without live files or when the replica fails (released then), and the tab reads the file as before. */
export async function openNoteFileLive(logger: ILogger, path: string): Promise<NoteFileLiveBinding | undefined> {
  const failed = (error: unknown): undefined => { void logger.error(MODULE, error, { action: "openLiveNote", path, message: formatError(error) }); return undefined; };
  const files = await Promise.resolve().then(readPageLiveFiles).catch(failed);
  if (!files) return undefined;
  let opened: ReturnType<typeof files.open>;
  try { opened = files.open(path); } catch (error) { return failed(error); }
  try {
    await opened.replica.ready;
  } catch (error) {
    await opened.release().catch(() => undefined);
    return failed(error);
  }
  let closing: Promise<void> | undefined;
  return {
    live: { doc: opened.replica.doc, persist: () => opened.flush() },
    // INVARIANT: release comes after flush, so the last edits reach the disk before the replica can go.
    close: () => (closing ??= opened.flush().catch((error: unknown) => { failed(error); }).then(() => opened.release())),
  };
}
