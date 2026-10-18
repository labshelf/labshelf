// Turns a catalog snippet written in VS Code snippet syntax into a CodeMirror snippet template.

/** `$1` becomes `${1}`, and a literal brace after a backslash stays literal (CodeMirror reads `\{` as an escape). */
export function snippetTemplate(vscodeSnippet: string): string {
  return vscodeSnippet.replace(/\\([{}])/g, "\\\\$1").replace(/\$(\d+)/g, "$${$1}");
}
