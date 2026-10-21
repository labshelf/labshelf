// Splits text into lines with line-ending differences excluded.
export function textLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
}
