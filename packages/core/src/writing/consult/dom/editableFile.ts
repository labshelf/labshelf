/**
 * The file a consult window edits in place (plan local-sync D8): no snapshot and no Reload. The browser binds a local-sync replica (collab for a text,
 * live for a qmd item file); VS Code binds a SourceDocument (text) or the notes editor's item save/create channel (qmd).
 */

import type * as Y from "yjs";
import { readFileText } from "../../../collab/sharedFiles.js";
import type { Replica } from "../../../localSync/replicaHub.js";
import type { NoteFileOptions } from "../../../qmd/dom/mountNoteFile.js";
import type { SourceDocument } from "../../dom/sourceEditor/documentMode.js";
import type { ConsultRef } from "../consultRequests.js";

export type EditableFile =
  | {
    kind: "text";
    path: string;
    binding: { collab: { text: Y.Text } } | { document: SourceDocument };
    release(): void;
  }
  | {
    kind: "qmd";
    path: string;
    binding:
      | { live: NonNullable<NoteFileOptions["live"]> }
      | { text: string; save: NoteFileOptions["save"]; create?: NoteFileOptions["create"]; subscribe(listener: (text: string) => void): () => void };
    release(): void;
  };

/** Opens the file a ref names for editing. */
export type EditableFileOpener = (ref: ConsultRef) => Promise<EditableFile>;

/** Binds an open replica; `release` gives it back once however often it is called. */
export function editableFromReplica(replica: Replica, path: string, persist?: () => Promise<void> | void): EditableFile {
  let released = false;
  const release = (): void => {
    if (released) { return; }
    released = true;
    replica.release();
  };
  if (replica.kind === "text") {
    return { kind: "text", path, binding: { collab: { text: readFileText(replica.doc) } }, release };
  }
  return { kind: "qmd", path, binding: { live: { doc: replica.doc, persist: persist ?? (() => undefined) } }, release };
}
