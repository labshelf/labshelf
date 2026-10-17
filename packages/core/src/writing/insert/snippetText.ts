// Escapes literal text for TextMate snippet syntax, which VS Code and Monaco both read.

export function snippetText(text: string): string {
  return text.replace(/[\\$}]/g, (char) => `\\${char}`);
}
