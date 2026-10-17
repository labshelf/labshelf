// Calls back, debounced, when a source file of a project folder changes; the build's own output files do not count.
import { watch } from "node:fs";

// PDFs, logs and aux files are written by the build itself, so only sources trigger a rebuild.
const SOURCE = /\.(tex|typ|bib|sty|cls)$/i;
const HIDDEN_FOLDER = /(^|[\\/])\./;
const DEBOUNCE_MS = 200;

/** @returns a function that stops watching */
export function watchSources(folder: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(folder, { recursive: true, persistent: true }, (_event, file) => {
    if (typeof file !== "string" || !SOURCE.test(file) || HIDDEN_FOLDER.test(file)) { return; }
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  });
  return () => { clearTimeout(timer); watcher.close(); };
}
