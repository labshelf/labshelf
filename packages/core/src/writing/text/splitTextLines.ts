// Splits text into lines with line-ending differences excluded.
export function splitTextLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
}
