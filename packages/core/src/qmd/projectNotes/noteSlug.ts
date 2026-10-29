// Derives the file slug of a project note from its title.
/** @returns lowercase ASCII words of the title joined by `-`, suffixed `-2`, `-3` while taken; `note` when the title has no words. */
export function deriveNoteSlug(title: string, taken: ReadonlySet<string>): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  const base = words && words.length > 0 ? words.join("-") : "note";
  if (!taken.has(base)) { return base; }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) { return candidate; }
  }
}
