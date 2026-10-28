// Tests the hover on cited keys: the paper's details, reader link, abstract excerpt, highlights and "Also cited in" list.
import { type Annotation, type ChecklistSection } from "@labshelf/core";
import * as vscode from "vscode";
import { CitationHoverProvider } from "../../../src/writing/citations/hover";
import { citationWorkspace, paper, highlight, type FakeSections } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

describe("citationHover", () => {
  async function hover(format: "latex" | "typst", marked: string, papers = [paper({ authors: ["A. B"], year: 2017, summary: "Uses *stars* & [links]." })]) {
    const { text, position } = withCursor(marked);
    const file = format === "latex" ? "/code/repo/a.tex" : "/code/repo/a.typ";
    return new CitationHoverProvider(citationWorkspace(format, papers)).provideHover(fakeDocument(file, text), position);
  }

  describe("citation hover", () => {
    it("shows title, authors, year, abstract and the reader link", async () => {
      const result = (await hover("latex", "\\cite{vasw|ani2017}"))!;
      const markdown = result.contents as unknown as vscode.MarkdownString;
      expect(markdown.value).toContain("**Attention Is All You Need**");
      expect(markdown.value).toContain("A\\. B 2017");
      expect(markdown.value).toContain("Uses \\*stars\\* \\& \\[links\\]\\.");
      expect(markdown.value).toContain("command:labshelf.openPdfViewer?");
      expect(result.range).toMatchObject({ start: { character: 6 }, end: { character: 17 } });
    });

    it("shows the paper for a Typst reference", async () => {
      expect(await hover("typst", "see @vaswani|2017.")).toBeDefined();
    });

    it("shows nothing for a key that is not a library paper", async () => {
      expect(await hover("latex", "\\cite{unk|nown}")).toBeUndefined();
    });

    it("shows nothing outside a cite", async () => {
      expect(await hover("latex", "vaswani|2017")).toBeUndefined();
    });
  });
});

describe("citationHoverContent", () => {
  const section = (id: string, title: string): ChecklistSection => ({ id, title, file: "/code/repo/main.tex", line: 1 });

  async function hoverText(
    over: Parameters<typeof paper>[0] = {}, annotations: Annotation[] = [], sections?: FakeSections,
  ): Promise<{ value: string; markdown: vscode.MarkdownString }> {
    const { text, position } = withCursor("\\cite{vasw|ani2017}");
    const workspace = citationWorkspace("latex", [paper({ authors: ["A. B"], year: 2017, ...over })], { p1: annotations }, sections);
    const result = await new CitationHoverProvider(workspace).provideHover(fakeDocument("/code/repo/a.tex", text), position);
    const markdown = result!.contents as unknown as vscode.MarkdownString;
    return { value: markdown.value, markdown };
  }

  describe("citation hover content", () => {
    it("links to the reader with the paper id and trusts only that command", async () => {
      const { value, markdown } = await hoverText();
      const args = encodeURIComponent(JSON.stringify(["p1"]));
      expect(value).toContain(`[Open paper](command:labshelf.openPdfViewer?${args})`);
      expect(markdown.isTrusted).toEqual({ enabledCommands: ["labshelf.openPdfViewer"] });
    });

    it("orders title, link, byline, abstract, highlights and other sections", async () => {
      const { value } = await hoverText(
        { summary: "Short abstract." }, [highlight({ content: "Quoted text", pageNumber: 7 })],
        { byKey: { vaswani2017: [section("s2", "Methods")] }, current: section("s1", "Intro") },
      );
      const order = ["**Attention", "Open paper", "A\\. B 2017", "Short abstract", "Quoted text", "p\\. 7", "Also cited in", "Methods"].map((part) => value.indexOf(part));
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it("cuts a long abstract at a word boundary with an ellipsis", async () => {
      const summary = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
      const { value } = await hoverText({ summary });
      expect(value).toContain("…");
      expect(value).not.toContain("word79");
      expect(value).not.toMatch(/wor…/);
    });

    it("omits the abstract and highlight blocks when the paper has neither", async () => {
      const { value } = await hoverText();
      expect(value).not.toContain("p\\.");
      expect(value).not.toContain("Also cited in");
      expect(value.split("\n\n").length).toBeLessThanOrEqual(3);
    });

    it("shows three highlights at most, in page order", async () => {
      const list = [9, 2, 5, 1].map((page) => highlight({ id: `h${page}`, pageNumber: page, content: `quote on page ${page}` }));
      const { value } = await hoverText({}, list);
      expect(value).toContain("quote on page 1");
      expect(value).toContain("quote on page 2");
      expect(value).toContain("quote on page 5");
      expect(value).not.toContain("quote on page 9");
      expect(value.indexOf("page 1")).toBeLessThan(value.indexOf("page 2"));
      expect(value.indexOf("page 2")).toBeLessThan(value.indexOf("page 5"));
    });

    it("skips highlights without text", async () => {
      const { value } = await hoverText({}, [highlight({ id: "a", content: "", pageNumber: 1 }), highlight({ id: "b", content: "kept text", pageNumber: 3 })]);
      expect(value).toContain("kept text");
      expect(value).not.toContain("p\\. 1");
    });

    it("lists the other sections citing the key and leaves out the current one", async () => {
      const { value } = await hoverText({}, [], {
        byKey: { vaswani2017: [section("s1", "Intro"), section("s2", "Methods"), section("s3", "Results")] },
        current: section("s1", "Intro"),
      });
      expect(value).toContain("Also cited in");
      expect(value).toContain("Methods");
      expect(value).toContain("Results");
      expect(value).not.toContain("Intro");
    });

    it("omits 'Also cited in' when only the current section cites the key", async () => {
      const { value } = await hoverText({}, [], { byKey: { vaswani2017: [section("s1", "Intro")] }, current: section("s1", "Intro") });
      expect(value).not.toContain("Also cited in");
    });

    it("escapes markdown in the title, abstract, highlight text and section titles", async () => {
      const { value } = await hoverText(
        { title: "Is *this* it", summary: "An *abstract*" }, [highlight({ content: "a *quote*" })],
        { byKey: { vaswani2017: [section("s2", "*Bold* part")] }, current: section("s1", "Intro") },
      );
      for (const raw of ["*this*", "*abstract*", "*quote*", "*Bold*"]) { expect(value).not.toContain(raw); }
      expect(value).toContain("\\*this\\*");
      expect(value).toContain("\\*Bold\\*");
    });
  });
});
