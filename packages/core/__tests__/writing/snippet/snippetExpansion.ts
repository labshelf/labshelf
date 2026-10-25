// Expands a snippet the way an editor does when every tab stop keeps its default, for tests.

export function expandSnippet(snippet: string): string {
  return snippet
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "x")
    .replace(/\$0/g, "")
    .replace(/\\([\\$}])/g, "$1");
}
