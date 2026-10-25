// Escapes literal text for TextMate snippet syntax, which VS Code and Monaco both read.

export function escapeSnippetText(text: string): string {
  return text.replace(/[\\$}]/g, (char) => `\\${char}`);
}
