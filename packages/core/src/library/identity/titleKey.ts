/** Reduces a title to an accent-, case- and punctuation-insensitive key, for matching the same paper across sources. */

export function titleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
