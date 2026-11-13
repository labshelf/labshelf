// The files Browse… picks outside the library (plan local-sync, spec 9.3): on Chromium the page keeps each picked handle for its life and a consult
// window edits it in a doc of its own, written back whole through the handle. Firefox has no showOpenFilePicker, so the page offers no Browse.
import * as Y from "yjs";
import { readFileText } from "@labshelf/core";
import type { EditableFile } from "@labshelf/core/consult";

export interface PickedFiles { readonly available: boolean; pick(): Promise<{ id: string; name: string } | null>; open(id: string): Promise<EditableFile> }

/** The quiet time after the last change before a picked file is written. */
const WRITE_DELAY_MS = 300;

type PickerWindow = { showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]> };

const pickerWindow = (): PickerWindow | undefined => (typeof window === "undefined" ? undefined : (window as unknown as PickerWindow));

/** PLATFORM: called without an await before it, so the chooser's click still counts as the user gesture the picker needs. */
const nativePicker = (): Promise<FileSystemFileHandle | undefined> => pickerWindow()!.showOpenFilePicker!().then((handles) => handles[0]);

const isAbort = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";

/** Writes the doc's whole text through the handle `WRITE_DELAY_MS` after its last change; `release` writes a pending change once and stops. */
function editPickedHandle(handle: FileSystemFileHandle, initial: string): EditableFile {
  const doc = new Y.Doc();
  const text = readFileText(doc);
  text.insert(0, initial);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let released = false;
  const write = (): void => {
    timer = undefined;
    const content = text.toString();
    // Writes run one after another, so an older text never lands after a newer one.
    writing = writing.then(async () => {
      const stream = await handle.createWritable();
      await stream.write(content);
      await stream.close();
    }).catch(() => {
      // The next change writes the whole text again; the window's view keeps the edit meanwhile.
    });
  };
  const onChange = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(write, WRITE_DELAY_MS);
  };
  text.observe(onChange);
  return {
    kind: "text", path: handle.name, binding: { collab: { text } },
    release: () => {
      if (released) return;
      released = true;
      text.unobserve(onChange);
      if (timer !== undefined) { clearTimeout(timer); write(); }
    },
  };
}

/** @param picker asks the user for one file; the default is the page's showOpenFilePicker. */
export function createPickedFiles(picker: () => Promise<FileSystemFileHandle | undefined> = nativePicker): PickedFiles {
  const handles = new Map<string, FileSystemFileHandle>();
  let picks = 0;
  return {
    available: typeof pickerWindow()?.showOpenFilePicker === "function",
    pick: async () => {
      let handle: FileSystemFileHandle | undefined;
      try {
        handle = await picker();
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
      if (handle === undefined) return null;
      const id = `picked-${(picks += 1)}`;
      handles.set(id, handle);
      return { id, name: handle.name };
    },
    open: async (id) => {
      const handle = handles.get(id);
      if (handle === undefined) throw new Error("The picked file is no longer available; pick it again with Browse…");
      return editPickedHandle(handle, await (await handle.getFile()).text());
    },
  };
}
