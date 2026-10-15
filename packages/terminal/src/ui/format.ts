/** Formats the collection breadcrumb for display in the terminal. */

/**
 * Collection path for display: "papers › ML › Transformers".
 * @returns the breadcrumb parts
 */
export function crumbs(rel: string): string[] {
  return ["papers", ...rel.split("/").filter(Boolean)];
}
