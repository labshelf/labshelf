// Converts a core insert snippet, written in TextMate syntax, into a CodeMirror snippet template.

/** `$1` and `${1:Caption}` become CodeMirror fields, `$0` the final cursor, and `\\`, `\$`, `\}` their literal characters. */
export function codeMirrorTemplate(textMate: string): string {
  return textMate
    .replace(/\\([\\$}])|\$(\d+)|\$\{(\d+)(?::([^}]*))?\}/g, (_match, literal?: string, bare?: string, field?: string, placeholder?: string) => {
      if (literal !== undefined) return literal;
      if (bare !== undefined) return `\${${bare}}`;
      return placeholder === undefined ? `\${${field}}` : `\${${field}:${placeholder}}`;
    })
    // CodeMirror reads a backslash before a brace as an escape, so a literal one is doubled.
    .replace(/\\(?=[{}])/g, "\\\\");
}
