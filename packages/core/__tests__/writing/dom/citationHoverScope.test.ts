/** @jest-environment jsdom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation, ItemFile, PaperRecord } from "../../../src/index.js";
import { recordCitationScope, type CitationScope, type CitationScopeRecord } from "../../../src/writing/citations/citationScopes.js";
import { createCitationHoverSource, deriveCitationHoverContent, renderCitationHover } from "../../../src/writing/dom/sourceEditor/citationHover.js";
import { renderPageThumbnail } from "../../../src/writing/dom/sourceEditor/paperPages.js";

jest.mock("../../../src/writing/dom/sourceEditor/paperPages.js", () => ({ renderPageThumbnail: jest.fn() }));
const thumbnail = renderPageThumbnail as jest.MockedFunction<typeof renderPageThumbnail>;

// jsdom has no layout; CodeMirror measures text ranges after an edit.
Range.prototype.getClientRects ??= (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as unknown as () => DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const paper = { id: "p1", title: "Attention", citeKey: "smith", status: "reading", authors: ["A. Smith"], year: 2020, summary: `${"abstract ".repeat(60)}end` } as unknown as PaperRecord;
const highlight: Annotation = { id: "a", paperId: "p1", type: "highlight", pageNumber: 4, content: "first quote", createdAt: "2020-01-01", updatedAt: "" };
const notes = { segments: [{ kind: "item", id: "n1", body: "Remember this", anchor: { kind: "point", page: 4 } }] } as unknown as ItemFile;
const pdf = { kind: "bytes", data: new Uint8Array() } as never;
const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe("deriveCitationHoverContent with a scope", () => {
  it("is today's content without a scope", () => {
    const content = deriveCitationHoverContent(paper, [highlight], notes);
    expect(content.scoped).toBeUndefined();
    expect(content.summary.length).toBeLessThanOrEqual(201);
  });

  it("adds the passage of a passage scope and keeps the summary", () => {
    const content = deriveCitationHoverContent(paper, [highlight], notes, undefined, { kind: "passage", page: 4, text: "the quoted words" });
    expect(content.scoped).toMatchObject({ kind: "passage", title: "Cited passage, p. 4", body: "the quoted words" });
    expect(content.summary).not.toBe("");
  });

  it("shows the whole abstract once for a paper scope", () => {
    const content = deriveCitationHoverContent(paper, [], undefined, undefined, { kind: "paper" });
    expect(content.scoped?.body).toBe(paper.summary!.trim());
    expect(content.summary).toBe("");
  });

  it("lists the marks of a page scope", () => {
    const content = deriveCitationHoverContent(paper, [highlight], notes, undefined, { kind: "page", page: 4 });
    expect(content.scoped).toMatchObject({ kind: "page", page: 4, marks: [{ kind: "highlight", text: "first quote" }, { kind: "note", text: "Remember this" }] });
  });
});

describe("renderCitationHover with a scope", () => {
  beforeEach(() => thumbnail.mockReset());

  it("puts the scope block above today's content", () => {
    const dom = renderCitationHover(paper, deriveCitationHoverContent(paper, [], undefined, undefined, { kind: "passage", page: 4, text: "the quoted words" }), {});
    const block = dom.querySelector(".cm-cite-hover-scope");
    expect(block?.textContent).toContain("Cited passage, p. 4");
    expect(block?.textContent).toContain("the quoted words");
    expect(dom.firstElementChild).toBe(block);
  });

  it("renders no scope block without a scope", () => {
    expect(renderCitationHover(paper, deriveCitationHoverContent(paper, [], undefined), {}).querySelector(".cm-cite-hover-scope")).toBeNull();
  });

  it("swaps the thumbnail placeholder for the canvas of the cited page", async () => {
    const canvas = document.createElement("canvas");
    thumbnail.mockResolvedValue(canvas);
    const dom = renderCitationHover(paper, deriveCitationHoverContent(paper, [highlight], notes, undefined, { kind: "page", page: 4 }), { pdf });
    expect(dom.querySelector(".cm-cite-hover-thumb")).not.toBeNull();
    expect([...dom.querySelectorAll(".cm-cite-hover-scope li")].map((item) => item.textContent)).toEqual(["Highlight: first quote", "Note: Remember this"]);
    await wait();
    expect(thumbnail).toHaveBeenCalledWith(pdf, 4, 240);
    expect(dom.querySelector(".cm-cite-hover-thumb")).toBeNull();
    expect(dom.querySelector("canvas")).toBe(canvas);
  });

  it("removes the placeholder when the page does not draw", async () => {
    thumbnail.mockRejectedValue(new Error("no pdf"));
    const dom = renderCitationHover(paper, deriveCitationHoverContent(paper, [], undefined, undefined, { kind: "page", page: 4 }), { pdf });
    await wait();
    expect(dom.querySelector(".cm-cite-hover-thumb")).toBeNull();
    expect(dom.querySelector("canvas")).toBeNull();
  });

  it("has no thumbnail without a pdf or for another scope", () => {
    const page = deriveCitationHoverContent(paper, [], undefined, undefined, { kind: "page", page: 4 });
    expect(renderCitationHover(paper, page, {}).querySelector(".cm-cite-hover-thumb")).toBeNull();
    const paperScope = deriveCitationHoverContent(paper, [], undefined, undefined, { kind: "paper" });
    expect(renderCitationHover(paper, paperScope, { pdf }).querySelector(".cm-cite-hover-thumb")).toBeNull();
    expect(thumbnail).not.toHaveBeenCalled();
  });
});

describe("the hover source with scopes", () => {
  const doc = "See \\cite{smith} here.";
  const command = { start: doc.indexOf("\\cite"), end: doc.indexOf(" here") };
  const record = (scope: CitationScope): CitationScopeRecord => recordCitationScope(doc, command, { id: "r1", file: "main.tex", key: "smith", scope, createdAt: "2024-01-01T00:00:00.000Z" });
  const base = { format: "latex" as const, papers: async () => [paper], file: "main.tex" };
  const hover = async (deps: Partial<Parameters<typeof createCitationHoverSource>[0]>): Promise<HTMLElement | undefined> => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc }) });
    const tooltip = await createCitationHoverSource({ ...base, ...deps })(view, doc.indexOf("smith"));
    const dom = tooltip?.create(view).dom;
    view.destroy();
    return dom;
  };

  it("shows the block of the record found under the pointer, for this file only", async () => {
    const scopesOf = jest.fn(async (file: string) => (file === "main.tex" ? [record({ kind: "passage", page: 2, text: "quoted words" })] : []));
    const dom = await hover({ scopesOf, pdfOf: () => undefined });
    expect(dom?.querySelector(".cm-cite-hover-scope")?.textContent).toContain("quoted words");
    expect(scopesOf).toHaveBeenCalledWith("main.tex");
  });

  it("asks for the pdf of the paper to draw a page scope", async () => {
    thumbnail.mockReset();
    thumbnail.mockResolvedValue(document.createElement("canvas"));
    const pdfOf = jest.fn(() => pdf);
    const dom = await hover({ scopesOf: async () => [record({ kind: "page", page: 3 })], pdfOf });
    await wait();
    expect(pdfOf).toHaveBeenCalledWith(paper);
    expect(dom?.querySelector("canvas")).not.toBeNull();
  });

  it("hovers as before when no record covers the occurrence or the scopes fail", async () => {
    expect((await hover({ scopesOf: async () => [] }))?.querySelector(".cm-cite-hover-scope")).toBeNull();
    const failing = await hover({ scopesOf: async () => { throw new Error("offline"); } });
    expect(failing?.querySelector(".cm-cite-hover-scope")).toBeNull();
    expect(failing?.querySelector(".cm-cite-hover-title")?.textContent).toBe("Attention");
  });
});
