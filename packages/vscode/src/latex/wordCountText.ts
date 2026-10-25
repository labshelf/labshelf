// Words the status bar item says: the project total in its text and the active file in its tooltip.
export function wordsLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "word" : "words"}`;
}

export function wordCountTooltip(fileCount: number, mainFile: string): string {
  return `Words in the whole project, counted from ${mainFile}. This file: ${wordsLabel(fileCount)}.`;
}
