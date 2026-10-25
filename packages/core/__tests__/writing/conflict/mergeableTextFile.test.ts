/** Verifies which project files get a merge base: known text extensions with valid UTF-8 content. */
import { isMergeableTextFile } from "../../../src/writing/conflict/index";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("isMergeableTextFile", () => {
  it.each(["main.tex", "paper.typ", "refs.bib", "notes.md", "meta.yaml", "x.json", "a.sty", "a.cls", "a.txt", "d.csv", "notes.qmd"])(
    "accepts UTF-8 %s", (name) => { expect(isMergeableTextFile(name, utf8("café"))).toBe(true); },
  );

  it("matches the extension case-insensitively", () => {
    expect(isMergeableTextFile("MAIN.TEX", utf8("\\documentclass{article}"))).toBe(true);
  });

  it("rejects a binary extension", () => {
    expect(isMergeableTextFile("figure.pdf", utf8("%PDF-1.7"))).toBe(false);
  });

  it("rejects a file without an extension", () => {
    expect(isMergeableTextFile("Makefile", utf8("all:"))).toBe(false);
  });

  it("rejects a text extension whose bytes are not valid UTF-8", () => {
    expect(isMergeableTextFile("main.tex", new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe(false);
  });
});
