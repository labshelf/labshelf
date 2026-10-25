// Tells whether a project file is text that Search in Project reads.
const SEARCHABLE = /\.(?:tex|typ|bib|cls|sty|bst|txt|md|ya?ml|json|csv)$/i;

export function isSearchTextFile(path: string): boolean {
  return SEARCHABLE.test(path);
}
