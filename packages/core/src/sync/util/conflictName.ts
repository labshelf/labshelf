// Derives a keep-both sibling rename for a conflicting file path.

// Pads a number to two digits.
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a Date as YYYY-MM-DD in UTC. */
export function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Returns a sibling path preserving the extension (e.g. "paper.pdf" → "paper (conflict 2026-05-22).pdf"). */
export function conflictPath(path: string, date: Date): string {
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  const file = slash < 0 ? path : path.slice(slash + 1);

  const dot = file.lastIndexOf(".");
  const stem = dot <= 0 ? file : file.slice(0, dot);
  const ext = dot <= 0 ? "" : file.slice(dot);

  return `${dir}${stem} (conflict ${isoDate(date)})${ext}`;
}
