/** Tells real titles from filenames, print-job names and placeholders in PDF metadata. */

/**
 * Normalizes a raw title string by collapsing underscores, hyphens, and whitespace.
 * @returns The cleaned title string.
 */
export function normalizeTitle(rawValue: string): string {
  return rawValue
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Producers routinely dump the source filename or a print-job name into
// Info.Title ("15200863156991 1..46 - 28383.pdf", "Microsoft Word - ms.doc").
const FILENAME_TITLE = /\.(pdf|docx?|rtf|tex|ps|eps|indd|qxd|pages|odt)$/i;
const PLACEHOLDER_TITLE = /^(untitled|unknown|document\d*|no job name|microsoft word|print(out)?|paper|manuscript|main|ms|final|draft|template|layout|article)[\s\d.\-_]*$/i;

// A page printed from a viewer inherits the viewer's window title, not the
// paper's: Firefox stamps "PDF.js viewer" on everything printed from its reader.
const VIEWER_TITLE = /^(pdf\.?js viewer|pdf viewer|adobe (acrobat|reader)\b.*|preview|google (docs|drive)\b.*|(mozilla )?firefox|google chrome|safari|microsoft edge|about:blank|new tab)$/i;

/**
 * Reports whether a title from PDF metadata is a real title rather than a
 * filename, a print-job name, or a numeric identifier.
 * @returns The cleaned title when usable, otherwise undefined.
 */
export function deriveUsableTitle(rawValue: string | undefined): string | undefined {
  const value = rawValue?.trim();
  if (!value || value.length < 6 || value.length > 400) {
    return undefined;
  }
  if (FILENAME_TITLE.test(value) || PLACEHOLDER_TITLE.test(value) || VIEWER_TITLE.test(value)) {
    return undefined;
  }

  const letters = (value.match(/[a-zà-ÿ]/gi) ?? []).length;
  // Mostly digits and separators — an internal article or job number.
  if (letters < value.length * 0.5) {
    return undefined;
  }
  // A single long unbroken token is a slug or an identifier, not a title.
  if (!/\s/.test(value) && value.length > 40) {
    return undefined;
  }
  return value;
}
