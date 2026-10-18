// Names downloaded files from untrusted manifest fields: one safe file name each, unique within a .zip.

// TRAP: cite keys and folder names come from whoever made the share; a "/" or ".." in a name would escape the folder
// a .zip is unpacked into.
function safeStem(text: string): string {
  return text.replace(/[^A-Za-z0-9 ._-]+/g, "_").replace(/^[._ ]+|[._ ]+$/g, "").slice(0, 120);
}

export function pdfFileName(metadata: { id: string; citeKey: string }): string {
  return `${safeStem(metadata.citeKey) || safeStem(metadata.id) || "paper"}.pdf`;
}

export function zipFileName(folder: string): string {
  return `${safeStem(folder) || "shared papers"}.zip`;
}

/** The names in order, a repeated one numbered from -2 before its extension. */
export function zipEntryNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) { return name; }
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)}-${count}${name.slice(dot)}` : `${name}-${count}`;
  });
}
