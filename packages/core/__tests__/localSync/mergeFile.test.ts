import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

import { mergeLocalFile } from "../../src/localSync/mergeFile.js";
import { mergeItemFiles, type TextMerge, type TextMergeInput } from "../../src/qmd/index.js";
import { createTextMerge } from "../../src/writing/textMerge.js";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads (as itemFileMerge.ts does).
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;
const textMerge = createTextMerge(diff3Merge);

const COPY_ID = "11111111-2222-4333-8444-555555555555";
const MARKERS = /^(<<<<<<<|=======|>>>>>>>)/m;

/** A text merge that fails the test when called: the shortcuts must not reach it. */
const forbidden: TextMerge = () => { throw new Error("textMerge must not be called"); };

const A = "n-01JB2QN0000000000000000000";
const B = "n-01JB2QP0000000000000000000";
const C = "n-01JB2QQ0000000000000000000";
const item = (id: string, body: string) => `::: {#${id} .labshelf-item}\n${body}:::\n`;
const QMD_BASE = `${item(A, "First.\n")}\n${item(B, "Second.\n")}`;

describe("mergeLocalFile", () => {
  it("1.1a returns local for identical sides without a conflict or a merge", () => {
    const result = mergeLocalFile({ path: "main.tex", base: "old\n", local: "same\n", other: "same\n" }, forbidden);
    expect(result).toEqual({ text: "same\n" });
    expect(result).not.toHaveProperty("conflict");
  });

  it("1.1a returns local when other is unchanged since base", () => {
    const result = mergeLocalFile({ path: "main.tex", base: "base\n", local: "local edit\n", other: "base\n" }, forbidden);
    expect(result).toEqual({ text: "local edit\n" });
    expect(result).not.toHaveProperty("conflict");
  });

  it("1.1a returns other when local is unchanged since base", () => {
    const result = mergeLocalFile({ path: "main.tex", base: "base\n", local: "base\n", other: "other edit\n" }, forbidden);
    expect(result).toEqual({ text: "other edit\n" });
    expect(result).not.toHaveProperty("conflict");
  });

  it("1.1a applies the same shortcuts to a .qmd path", () => {
    expect(mergeLocalFile({ path: "notes.qmd", base: QMD_BASE, local: QMD_BASE, other: QMD_BASE }, forbidden)).toEqual({ text: QMD_BASE });
    const edited = `${item(A, "First, edited.\n")}\n${item(B, "Second.\n")}`;
    expect(mergeLocalFile({ path: "notes.qmd", base: QMD_BASE, local: edited, other: QMD_BASE }, forbidden)).toEqual({ text: edited });
    expect(mergeLocalFile({ path: "notes.qmd", base: QMD_BASE, local: QMD_BASE, other: edited }, forbidden)).toEqual({ text: edited });
  });

  it("1.1a prefers local when both sides are equal even if both differ from base", () => {
    const result = mergeLocalFile({ path: "a.txt", base: "base\n", local: "x\n", other: "x\n" }, forbidden);
    expect(result).toEqual({ text: "x\n" });
  });

  it("1.1b keeps both changes of a .tex whose sides changed different paragraphs", () => {
    const base = "para one\n\npara two\n\npara three\n";
    const local = "para ONE by local\n\npara two\n\npara three\n";
    const other = "para one\n\npara two\n\npara THREE by other\n";
    const result = mergeLocalFile({ path: "chapters/intro.tex", base, local, other }, textMerge, COPY_ID);
    expect(result.text).toBe("para ONE by local\n\npara two\n\npara THREE by other\n");
    expect(result).not.toHaveProperty("conflict");
    expect(result.text).not.toMatch(MARKERS);
  });

  it("1.1b merges a non-qmd, non-tex path line by line too", () => {
    const base = "a\nb\nc\nd\ne\n";
    const result = mergeLocalFile({ path: "notes/todo.md", base, local: "A\nb\nc\nd\ne\n", other: "a\nb\nc\nd\nE\n" }, textMerge, COPY_ID);
    expect(result).toEqual({ text: "A\nb\nc\nd\nE\n" });
  });

  it("1.1c keeps local and hands back other with a conflict copy path when the same line changed differently", () => {
    const base = "one\ntwo\nthree\n";
    const local = "one\nTWO local\nthree\n";
    const other = "one\nTWO other\nthree\n";
    const result = mergeLocalFile({ path: "chapters/intro.tex", base, local, other }, textMerge, COPY_ID);
    expect(result.text).toBe(local);
    expect(result.conflict).toEqual({ copyPath: `chapters/intro.tex.labshelf-conflict-${COPY_ID}`, text: other });
  });

  it("1.1c never puts conflict markers in the text or in the conflict copy text", () => {
    const result = mergeLocalFile(
      { path: "main.tex", base: "x\ny\nz\n", local: "x\nlocal\nz\n", other: "x\nother\nz\n" }, textMerge, COPY_ID,
    );
    expect(result.text).not.toMatch(MARKERS);
    expect(result.conflict?.text).not.toMatch(MARKERS);
  });

  it("1.1c picks a random copy id when none is given, in the conflict copy path format", () => {
    const input = { path: "main.tex", base: "x\ny\nz\n", local: "x\nlocal\nz\n", other: "x\nother\nz\n" };
    const first = mergeLocalFile(input, textMerge).conflict?.copyPath;
    const second = mergeLocalFile(input, textMerge).conflict?.copyPath;
    expect(first).toMatch(/^main\.tex\.labshelf-conflict-[0-9a-f-]{36}$/);
    expect(second).toMatch(/^main\.tex\.labshelf-conflict-[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });

  it("1.1c treats any merge result flagged conflicted as a conflict, whatever its text", () => {
    const flagged: TextMerge = () => ({ text: "whatever the merge produced", conflicted: true });
    const result = mergeLocalFile({ path: "a.txt", base: "b\n", local: "l\n", other: "o\n" }, flagged, COPY_ID);
    expect(result).toEqual({ text: "l\n", conflict: { copyPath: `a.txt.labshelf-conflict-${COPY_ID}`, text: "o\n" } });
  });

  it("1.1c returns a clean merge's text without a conflict field", () => {
    const clean: TextMerge = () => ({ text: "merged\n", conflicted: false });
    const result = mergeLocalFile({ path: "a.txt", base: "b\n", local: "l\n", other: "o\n" }, clean, COPY_ID);
    expect(result).toEqual({ text: "merged\n" });
    expect(result).not.toHaveProperty("conflict");
  });

  it("1.1c passes the other side's label \"other\" to the line merge", () => {
    const seen: TextMergeInput[] = [];
    const spy: TextMerge = (input) => { seen.push(input); return { text: "m\n", conflicted: false }; };
    mergeLocalFile({ path: "a.txt", base: "b\n", local: "l\n", other: "o\n" }, spy, COPY_ID);
    expect(seen).toEqual([{ base: "b\n", local: "l\n", other: "o\n", otherLabel: "other" }]);
  });

  it("1.1d keeps both when local edited one item of a .qmd and other appended a new item", () => {
    const local = `${item(A, "First, edited locally.\n")}\n${item(B, "Second.\n")}`;
    const other = `${QMD_BASE}\n${item(C, "Appended elsewhere.\n")}`;
    const result = mergeLocalFile({ path: "paper/notes.qmd", base: QMD_BASE, local, other }, textMerge, COPY_ID);
    expect(result).not.toHaveProperty("conflict");
    expect(result.text).toContain("First, edited locally.");
    expect(result.text).toContain("Appended elsewhere.");
    expect(result.text).toContain(`#${C}`);
    expect(result.text).not.toMatch(MARKERS);
    expect(result.text).toBe(mergeItemFiles({ base: QMD_BASE, local, other, otherLabel: "other" }, textMerge).text);
  });

  it("1.1d treats an upper-case .QMD extension as an item file", () => {
    const local = `${item(A, "First, edited locally.\n")}\n${item(B, "Second.\n")}`;
    const other = `${QMD_BASE}\n${item(C, "Appended elsewhere.\n")}`;
    const lower = mergeLocalFile({ path: "notes.qmd", base: QMD_BASE, local, other }, textMerge, COPY_ID);
    const upper = mergeLocalFile({ path: "NOTES.QMD", base: QMD_BASE, local, other }, textMerge, COPY_ID);
    expect(upper).not.toHaveProperty("conflict");
    expect(upper.text).toBe(lower.text);
    expect(upper.text).toContain("Appended elsewhere.");
  });

  it("1.1d keeps local and hands back other when an item merge conflicts", () => {
    const base = item(A, "one\ntwo\nthree\n");
    const local = item(A, "one\nmine\nthree\n");
    const other = item(A, "one\ntheirs\nthree\n");
    const result = mergeLocalFile({ path: "notes.qmd", base, local, other }, textMerge, COPY_ID);
    expect(result.text).toBe(local);
    expect(result.conflict).toEqual({ copyPath: `notes.qmd.labshelf-conflict-${COPY_ID}`, text: other });
  });

  /** A merge that answers the item merge's loose-text merges with an extra item, so mergeItemFiles throws, and the whole file with `fallbackText`. */
  function refusingMerge(base: string, local: string, other: string, fallbackText: string, calls: TextMergeInput[]): TextMerge {
    return (input) => {
      if (input.base === base && input.local === local && input.other === other) {
        calls.push(input);
        return { text: fallbackText, conflicted: false };
      }
      return { text: item(C, "smuggled\n"), conflicted: false };
    };
  }

  const LOOSE_BASE = `${item(A, "First.\n")}loose base\n`;
  const LOOSE_LOCAL = `${item(A, "First.\n")}loose local\n`;
  const LOOSE_OTHER = `${item(A, "First.\n")}loose other\n`;

  it("1.1d falls back to the line merge of the whole file when mergeItemFiles refuses", () => {
    const calls: TextMergeInput[] = [];
    const merge = refusingMerge(LOOSE_BASE, LOOSE_LOCAL, LOOSE_OTHER, "line merged\n", calls);
    expect(() => mergeItemFiles({ base: LOOSE_BASE, local: LOOSE_LOCAL, other: LOOSE_OTHER, otherLabel: "other" }, merge)).toThrow();
    calls.length = 0;
    const result = mergeLocalFile({ path: "notes.qmd", base: LOOSE_BASE, local: LOOSE_LOCAL, other: LOOSE_OTHER }, merge, COPY_ID);
    expect(result).toEqual({ text: "line merged\n" });
    expect(calls).toEqual([{ base: LOOSE_BASE, local: LOOSE_LOCAL, other: LOOSE_OTHER, otherLabel: "other" }]);
  });

  it("1.1d falls back for .QMD too, and a conflicted fallback keeps local with a conflict copy", () => {
    const merge: TextMerge = (input) => (
      input.local === LOOSE_LOCAL ? { text: "<<<<<<< local\nx\n=======\ny\n>>>>>>> other\n", conflicted: true } : { text: item(C, "smuggled\n"), conflicted: false }
    );
    const result = mergeLocalFile({ path: "NOTES.QMD", base: LOOSE_BASE, local: LOOSE_LOCAL, other: LOOSE_OTHER }, merge, COPY_ID);
    expect(result.text).toBe(LOOSE_LOCAL);
    expect(result.conflict).toEqual({ copyPath: `NOTES.QMD.labshelf-conflict-${COPY_ID}`, text: LOOSE_OTHER });
  });

  it("1.1d does not use the item merge for a non-qmd path", () => {
    const seen: TextMergeInput[] = [];
    const spy: TextMerge = (input) => { seen.push(input); return { text: "m\n", conflicted: false }; };
    mergeLocalFile({ path: "notes.qmd.txt", base: QMD_BASE, local: `${QMD_BASE}x\n`, other: `y\n${QMD_BASE}` }, spy, COPY_ID);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.base).toBe(QMD_BASE);
  });
});
