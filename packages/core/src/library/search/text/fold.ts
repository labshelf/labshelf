/** Removes diacritics and case so "Schrödinger" matches "schrodinger". */

/**
 * @returns the folded text
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}
