// Decides whether a project file is text that can have a merge base.

const MERGEABLE_EXTENSIONS = new Set([".tex", ".typ", ".bib", ".md", ".yaml", ".json", ".sty", ".cls", ".txt", ".csv"]);

/** Checked before a file is read, so binary project files are never loaded to be rejected. */
export function hasMergeableExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 && MERGEABLE_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Binary and non-UTF-8 files have no base: a line merge of them would corrupt the file. */
export function isMergeableTextFile(fileName: string, bytes: Uint8Array): boolean {
  return hasMergeableExtension(fileName) && isValidUtf8(bytes);
}
