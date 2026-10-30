// Tests that no `language: "python"` placeholder is left in the files that post a run, or in the editor files that build cells.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const FILES = [
  "packages/core/src/reader/dom/cellRuns.ts",
  "packages/core/src/reader/dom/notesTab.ts",
  "packages/core/src/reader/dom/noteBoxes.ts",
  "packages/core/src/reader/dom/floatingNotes.ts",
  "packages/core/src/spaces/dom/mountSpaceNotes.ts",
  "packages/core/src/libraryUi/dom/detailPane/paneState.ts",
  "packages/browser/src/libraryUi/editorArea/projectNoteTab.ts",
  "packages/core/src/qmd/dom/qmdCommands.ts",
  "packages/core/src/qmd/dom/qmdInputRules.ts",
  "packages/core/src/qmd/dom/codeCellView.ts",
];

describe("language placeholders", () => {
  it.each(FILES)('4.2b %s has no language: "python"', (file) => {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
    const hits = lines.flatMap((line, i) => (/language\s*:\s*["']python["']/.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
    expect(hits).toEqual([]);
  });
});
