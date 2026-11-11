/** Contract of the inserted Markdown (labels, dedupe, link line) and of the service's source order with fake hosts. */
import { parsePaperLink } from "../../src/library/index";
import type { ILogger } from "../../src/ports/index";
import type { EquationOutcome, EquationPort, EquationRequest } from "../../src/reader/hostPorts";
import {
  buildPaperObjectMarkdown, createPaperObjectService, listPaperObjects,
  type PaperObject, type PaperObjectServiceDeps,
} from "../../src/paperObjects/index";
import { samplePages } from "./fixtures";

const PNG = new Uint8Array([137, 80, 78, 71]);
const OPTIONS = { assetName: "a1", takenLabels: [] as string[] };
const objects = listPaperObjects(samplePages());
const byKind = (kind: PaperObject["kind"]): PaperObject => objects.find((o) => o.kind === kind)!;

function logger(): ILogger & { errors: unknown[] } {
  const errors: unknown[] = [];
  return { errors, log: async () => {}, error: async (_m: string, e: unknown) => { errors.push(e); } };
}

function equationPort(outcome: EquationOutcome): EquationPort & { requests: EquationRequest[] } {
  const requests: EquationRequest[] = [];
  return { requests, extract: async (request) => { requests.push(request); return outcome; } };
}

function service(overrides: Partial<PaperObjectServiceDeps> = {}) {
  const calls = { pages: 0, render: 0 };
  const log = logger();
  const deps: PaperObjectServiceDeps = {
    papers: async () => [],
    paperInfo: async () => ({ citeKey: "k2020", title: "A paper" }),
    pages: async () => { calls.pages++; return samplePages(); },
    render: async () => { calls.render++; return PNG; },
    logger: log,
    ...overrides,
  };
  return { port: createPaperObjectService(deps), calls, log };
}

describe("buildPaperObjectMarkdown", () => {
  const paper = { citeKey: "k2020", title: "A paper" };

  it("writes a labelled equation, then the link line with the box", () => {
    const object = byKind("equation");
    const { markdown, assets } = buildPaperObjectMarkdown({ paper, object, content: { kind: "latex", latex: "E = mc^2" }, options: OPTIONS });
    const [math, link] = markdown.split("\n\n");
    expect(math).toBe("$$\nE = mc^2\n$$ {#eq-k2020-3}");
    expect(assets).toEqual([]);
    const target = /^\[k2020, Eq\. \(3\), p\. 1\]\((.+)\)$/.exec(link!)![1]!;
    expect(parsePaperLink(target)).toEqual({ citeKey: "k2020", page: 1, box: object.box });
  });

  it("makes the label unique and keeps it in the label grammar", () => {
    const object = { ...byKind("equation"), label: "2.1a" };
    const taken = ["smith-2020-ml-2-1a", "smith-2020-ml-2-1a-2"];
    const { markdown } = buildPaperObjectMarkdown({ paper: { citeKey: "Smith:2020.ml", title: "" }, object, content: { kind: "latex", latex: "x" }, options: { ...OPTIONS, takenLabels: taken } });
    expect(markdown).toContain("$$ {#eq-smith-2020-ml-2-1a-3}");
  });

  it("writes an image under assets and a plain-text source without a cite key", () => {
    const object = byKind("figure");
    const { markdown, assets } = buildPaperObjectMarkdown({ paper: { citeKey: null, title: "Deep *nets* [v2]" }, object, content: { kind: "image", png: PNG }, options: OPTIONS });
    expect(markdown).toBe("![Deep *nets* \\[v2\\], Figure 2](assets/a1.png)\n\nDeep \\*nets\\* \\[v2\\], Figure 2, p. 1");
    expect(assets).toEqual([{ path: "assets/a1.png", bytes: PNG }]);
    const label = buildPaperObjectMarkdown({ paper: { citeKey: null, title: "T" }, object: byKind("equation"), content: { kind: "latex", latex: "x" }, options: OPTIONS });
    expect(label.markdown).toContain("{#eq-paper-3}");
  });
});

describe("createPaperObjectService", () => {
  it("lists once per paper and passes paper queries through", async () => {
    const papers = [{ id: "p", citeKey: null, title: "T", authors: "", year: null }];
    const { port, calls } = service({ papers: async (q) => (q === "t" ? papers : []) });
    expect(await port.list("p")).toEqual(objects);
    await port.list("p");
    await port.insert("p", byKind("table"), OPTIONS);
    expect(calls.pages).toBe(1);
    expect(await port.papers("t")).toBe(papers);
  });

  it("rejects the list of a paper without a readable PDF, and lists it once the PDF reads", async () => {
    await expect(service({ pages: async () => null }).port.list("p")).rejects.toThrow(/^This paper has no PDF\.$/);
    let opens = 0;
    const { port, log } = service({ pages: async () => { if (opens++ === 0) { throw new Error("cannot open"); } return samplePages(); } });
    await expect(port.list("p")).rejects.toThrow(/^This paper has no PDF\.$/);
    expect(log.errors).toHaveLength(1);
    expect(await port.list("p")).toEqual(objects);
  });

  it("lists nothing for a PDF without numbered objects", async () => {
    expect(await service({ pages: async () => [] }).port.list("p")).toEqual([]);
  });

  it("inserts a figure as an image", async () => {
    const result = await service().port.insert("p", byKind("figure"), OPTIONS);
    expect(result.via).toBe("image");
    expect(result.markdown.startsWith("![k2020, Figure 2](assets/a1.png)\n\n[k2020, Figure 2, p. 1](labshelf:k2020#p1:")).toBe(true);
    expect(result.assets).toEqual([{ path: "assets/a1.png", bytes: PNG }]);
  });

  it("asks the equation port with the region's text and keeps its source", async () => {
    const equation = equationPort({ kind: "latex", latex: "E = mc^2", source: "pix2tex" });
    const result = await service({ equation }).port.insert("p", byKind("equation"), { ...OPTIONS, takenLabels: ["k2020-3"] });
    expect(result.via).toBe("pix2tex");
    expect(result.markdown).toContain("$$\nE = mc^2\n$$ {#eq-k2020-3-2}");
    expect(equation.requests[0]!.text).toContain("(3)");
    expect(equation.requests[0]!).toMatchObject({ paperId: "p", pageNumber: 1, png: PNG });
  });

  it("falls back to an image when the equation cannot be read, and skips the port as image", async () => {
    const unavailable = equationPort({ kind: "unavailable", offers: { pix2tex: "none", aiKey: false } });
    expect((await service({ equation: unavailable }).port.insert("p", byKind("equation"), OPTIONS)).via).toBe("image");
    const throwing: EquationPort = { extract: async () => { throw new Error("down"); } };
    const { port, log } = service({ equation: throwing });
    expect((await port.insert("p", byKind("equation"), OPTIONS)).via).toBe("image");
    expect(log.errors).toHaveLength(1);
    const asked = equationPort({ kind: "latex", latex: "x", source: "arxiv" });
    expect((await service({ equation: asked }).port.insert("p", byKind("equation"), { ...OPTIONS, asImage: true })).via).toBe("image");
    expect(asked.requests).toEqual([]);
  });

  it("reads a table from the arXiv source first", async () => {
    const tex = String.raw`\begin{table}\caption{R}\begin{tabular}{ll} A & B \\ 1 & 2 \end{tabular}\end{table}`;
    const result = await service({ eprintTex: async () => tex }).port.insert("p", byKind("table"), OPTIONS);
    expect(result.via).toBe("arxiv");
    expect(result.markdown.split("\n\n")[0]).toBe("| A   | B   |\n| --- | --- |\n| 1   | 2   |");
  });

  it("falls back from a failing source to the PDF text", async () => {
    const { port, log } = service({ eprintTex: async () => { throw new Error("offline"); } });
    const result = await port.insert("p", byKind("table"), OPTIONS);
    expect(result.via).toBe("pdf-text");
    expect(result.markdown).toContain("| Ours   | 91.2 | 3.1  |");
    expect(log.errors).toHaveLength(1);
  });

  it("asks table vision when the text is no table, keeping only a table of 2 or more columns", async () => {
    const noText = async () => samplePages().map((p) => ({ ...p, items: p.pageNumber === 2 ? p.items.slice(0, 1) : p.items }));
    const ai = await service({ pages: noText, tableVision: async () => "| a | b |\n|---|---|\n| 1 | 2 |" }).port.insert("p", byKind("table"), OPTIONS);
    expect(ai.via).toBe("ai");
    expect(ai.markdown.split("\n\n")[0]).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |");
    const narrow = await service({ pages: noText, tableVision: async () => "| a |\n|---|\n| 1 |" }).port.insert("p", byKind("table"), OPTIONS);
    expect(narrow.via).toBe("image");
    const prose = await service({ pages: noText, tableVision: async () => "Sorry, I cannot read it." }).port.insert("p", byKind("table"), OPTIONS);
    expect(prose.via).toBe("image");
  });

  it("fails only when the image itself cannot be rendered; a preview that fails is null", async () => {
    const { port } = service({ render: async () => { throw new Error("no canvas"); } });
    await expect(port.insert("p", byKind("figure"), OPTIONS)).rejects.toThrow("no canvas");
    expect(await port.preview("p", byKind("figure"))).toBeNull();
  });
});
