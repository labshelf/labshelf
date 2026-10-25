/** Verifies the three-way line merge of project text: clean merges, conflict markers, line endings, no lost text. */
import { mergeFileText, mergeText } from "../../../../src/writing/conflict/node/mergeText";

const PARAGRAPHS = [
  "\\section{Introduction}\nDeep networks learn hierarchical features from raw data.\nWe study their robustness.",
  "Prior work measures robustness with adversarial examples~\\cite{goodfellow2015}.\nThese attacks are cheap to compute.",
  "\\section{Method}\nWe train a ResNet-50 on ImageNet with standard augmentation.\nThe learning rate follows a cosine schedule.",
  "Each model is evaluated under five corruption types.\nWe report the mean corruption error.",
  "\\section{Results}\nRobust training lowers the corruption error by 12\\%.\nClean accuracy drops by one point.",
  "\\section{Conclusion}\nRobustness and accuracy trade off mildly.\nFuture work studies larger models.",
];

function doc(paragraphs: readonly string[], eol = "\n"): string {
  return `${paragraphs.join("\n\n")}\n`.replace(/\n/g, eol);
}

function edit(index: number, text: string): string[] {
  return PARAGRAPHS.map((paragraph, i) => i === index ? text : paragraph);
}

describe("mergeText", () => {
  it("merges edits to different paragraphs without markers", () => {
    const local = edit(0, "\\section{Introduction}\nDeep networks learn features.\nWe study their robustness.");
    const other = edit(4, "\\section{Results}\nRobust training lowers the corruption error by 15\\%.\nClean accuracy drops by one point.");
    const result = mergeText({ base: doc(PARAGRAPHS), local: doc(local), other: doc(other), otherLabel: "syncthing" });
    expect(result.conflicted).toBe(false);
    expect(result.text).toBe(doc([local[0]!, ...PARAGRAPHS.slice(1, 4), other[4]!, PARAGRAPHS[5]!]));
  });

  it("marks overlapping edits and keeps both versions in full", () => {
    const local = doc(edit(2, "\\section{Method}\nWe train a ViT-B/16 on ImageNet with standard augmentation.\nThe learning rate follows a cosine schedule."));
    const other = doc(edit(2, "\\section{Method}\nWe train a ResNet-101 on ImageNet with standard augmentation.\nThe learning rate follows a cosine schedule."));
    const result = mergeText({ base: doc(PARAGRAPHS), local, other, otherLabel: "dropbox" });
    expect(result.conflicted).toBe(true);
    expect(result.text).toContain([
      "<<<<<<< local",
      "We train a ViT-B/16 on ImageNet with standard augmentation.",
      "=======",
      "We train a ResNet-101 on ImageNet with standard augmentation.",
      ">>>>>>> dropbox",
    ].join("\n"));
    expect(result.text).toContain(PARAGRAPHS[5]);
  });

  it("does not mark the same change made on both sides", () => {
    const both = doc(edit(3, "Each model is evaluated under fifteen corruption types.\nWe report the mean corruption error."));
    expect(mergeText({ base: doc(PARAGRAPHS), local: both, other: both, otherLabel: "rclone" })).toEqual({ text: both, conflicted: false });
  });

  it("keeps local CRLF line endings and its missing trailing newline", () => {
    const base = doc(PARAGRAPHS);
    const local = doc(edit(0, "\\section{Intro}\nDeep networks learn hierarchical features from raw data.\nWe study their robustness."), "\r\n").replace(/\r\n$/, "");
    const other = doc(edit(5, "\\section{Conclusion}\nRobustness and accuracy trade off.\nFuture work studies larger models."));
    const { text, conflicted } = mergeText({ base, local, other, otherLabel: "nextcloud" });
    expect(conflicted).toBe(false);
    expect(text).toContain("\\section{Intro}\r\n");
    expect(text).toContain("trade off.\r\nFuture work");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text.endsWith("larger models.")).toBe(true);
  });
});

describe("mergeFileText", () => {
  const item = (id: string, body: string) => `::: {#${id} .labshelf-item}\n${body}\n:::\n`;

  it("merges a qmd file item by item, also without a base", () => {
    const local = item("n-01JB2QN0000000000000000000", "Mine.");
    const other = item("n-01JB2QQ0000000000000000000", "Theirs.");
    expect(mergeFileText("Notes.QMD", { base: undefined, local, other, otherLabel: "x" })).toEqual({ text: `${local}\n${other}`, conflicted: false });
  });

  it("refuses to merge any other file without a base", () => {
    expect(() => mergeFileText("main.tex", { base: undefined, local: "a\n", other: "b\n", otherLabel: "x" })).toThrow("without a base");
  });
});
