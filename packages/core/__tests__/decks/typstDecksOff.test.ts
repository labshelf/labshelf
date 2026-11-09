// Talks and posters are HTML or LaTeX while TYPST_DECKS_ENABLED is false: a Typst source is never a deck and the gallery never offers or accepts Typst.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDeckFileCandidate, listProjectDeckFiles, readDeckFileKind } from "../../src/decks/deckFiles.js";
import { deckTemplateFormats, listDeckTemplates, listTemplateSizes, parseDeckTemplateChoice, scaffoldDeckFromTemplate } from "../../src/decks/deckTemplates.js";
import { describeSourceDeck, detectSourceDeckKind, readSourceDeckKind } from "../../src/decks/sourceDecks.js";
import { TYPST_DECKS_ENABLED } from "../../src/decks/typstDecks.js";
import { readDeckKindOf } from "../../src/writing/dom/sourceEditor/deckTools.js";
import { nodeFileReads } from "../../src/writing/project/node/projectReads.js";
import { A0, TALK_16_9, choice } from "./deckTemplatesHarness";

const MARKED = "// labshelf: talk\n= Intro\n";
const IMPORTED = '#import "@preview/touying:0.5.0": *\n';

describe("with Typst decks off", () => {
  it("is off by default", () => {
    expect(TYPST_DECKS_ENABLED).toBe(false);
  });

  it("never reads a Typst source as a talk or poster, in any folder", () => {
    expect(detectSourceDeckKind("typst", MARKED)).toBeNull();
    expect(detectSourceDeckKind("typst", IMPORTED)).toBeNull();
    expect(describeSourceDeck("typst", "talks/t/main.typ", MARKED)).toBeUndefined();
    expect(readSourceDeckKind("talks/t/main.typ", MARKED)).toBeUndefined();
    expect(readDeckFileKind("poster.typ", MARKED)).toBeUndefined();
    expect(readDeckKindOf("projects/x/talks/t/main.typ", "= Intro\n")).toBeUndefined();
    expect(isDeckFileCandidate("main.typ")).toBe(false);
  });

  it("still reads HTML and LaTeX decks", () => {
    expect(detectSourceDeckKind("latex", "\\documentclass{beamer}")).toBe("talk");
    expect(readSourceDeckKind("talks/t/main.tex", "\\documentclass{beamer}")).toBe("talk");
    expect(readDeckKindOf("talks/t/main.tex", "\\documentclass{beamer}")).toBe("talk");
    expect(isDeckFileCandidate("deck.html")).toBe(true);
    expect(isDeckFileCandidate("main.tex")).toBe(true);
  });

  it("does not list a Typst source among a project's talks and posters", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-typst-off-"));
    try {
      fs.mkdirSync(path.join(root, "talks", "t"), { recursive: true });
      fs.writeFileSync(path.join(root, "talks", "t", "main.typ"), MARKED);
      fs.writeFileSync(path.join(root, "talks", "t", "main.tex"), "\\documentclass{beamer}");
      const found = await listProjectDeckFiles(nodeFileReads, root);
      expect(found.map((file) => file.path)).toEqual(["talks/t/main.tex"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("offers HTML and LaTeX only, whatever the project's format", () => {
    expect(deckTemplateFormats("latex")).toEqual(["html", "latex"]);
    expect(deckTemplateFormats("typst")).toEqual(["html"]);
    expect(listDeckTemplates("talk", "typst")).toEqual([]);
    expect(listDeckTemplates("poster", "typst")).toEqual([]);
    expect(listTemplateSizes("poster", "typst")).toEqual([]);
    expect(listDeckTemplates("talk", "latex").length).toBeGreaterThan(0);
  });

  it("refuses a Typst choice", () => {
    const typst = choice("talk", "typst", "blank");
    expect(parseDeckTemplateChoice(typst)).toBeNull();
    expect(parseDeckTemplateChoice(choice("poster", "typst", "generic", { size: A0 }))).toBeNull();
    expect(() => scaffoldDeckFromTemplate(typst, "t")).toThrow(RangeError);
    expect(parseDeckTemplateChoice(choice("talk", "latex", "blank", { size: TALK_16_9 }))).not.toBeNull();
  });
});
