/** Verifies Typst completion after #, @, <, ., inside calls and in path strings, and where it stays silent. */
import { at, fixture } from "./typstProjectFixture";

async function complete(marked: string, options: { path?: string; prefix?: string; explicit?: boolean } = {}) {
  const [text, offset] = at(marked, options.prefix);
  return fixture().service.complete(options.path ?? "main.typ", text, offset, options.explicit ?? false);
}

const labels = (result: Awaited<ReturnType<typeof complete>>) => result?.options.map((option) => option.label) ?? [];

describe("Typst completion in code", () => {
  it("offers keywords, library items, earlier bindings and imported names after #", async () => {
    const result = await complete("#|");
    expect(result).toMatchObject({ from: expect.any(Number), to: expect.any(Number) });
    expect(result!.from).toBe(result!.to);
    expect(result!.options).toContainEqual(expect.objectContaining({ label: "let", kind: "keyword" }));
    expect(result!.options).toContainEqual(expect.objectContaining({ label: "text", kind: "function", insert: "text(${1})", snippet: true }));
    expect(result!.options).toContainEqual(expect.objectContaining({ label: "answer", kind: "variable", doc: "The answer." }));
    expect(result!.options).toContainEqual(expect.objectContaining({ label: "note", kind: "function" }));
    expect(labels(result)).not.toContain("helper");
  });

  it("covers the typed word", async () => {
    const [text, offset] = at("#te|");
    const result = await fixture().service.complete("main.typ", text, offset, false);
    expect(result).toMatchObject({ from: offset - 2, to: offset });
  });

  it("offers the members of the receiver after a dot", async () => {
    const result = await complete("#calc.|");
    expect(labels(result)).toContain("max");
    expect(labels(result)).not.toContain("let");
  });

  it("offers the callee's named parameters not yet given inside a call", async () => {
    const result = await complete("#text(size: 12pt, |)");
    expect(result!.options).toContainEqual(expect.objectContaining({ label: "fill", kind: "parameter", insert: "fill: ", snippet: false }));
    expect(labels(result)).not.toContain("size");
  });
});

describe("Typst completion of references", () => {
  it("offers labels of this and included or imported files and bib keys after @", async () => {
    const result = await complete("See @|");
    expect(labels(result)).toEqual(expect.arrayContaining(["main-sec", "intro", "lib-sec", "knuth84"]));
    expect(result!.options).toContainEqual(expect.objectContaining({ label: "knuth84", kind: "citation" }));
  });

  it("offers labels after <", async () => {
    const result = await complete("Text <|");
    expect(result!.options).toContainEqual(expect.objectContaining({ label: "intro", kind: "label" }));
    expect(labels(result)).not.toContain("knuth84");
  });
});

describe("Typst completion of paths", () => {
  it("offers Typst files in an import string, relative to the current file", async () => {
    const result = await complete("#import \"|\"");
    expect(labels(result)).toEqual(expect.arrayContaining(["lib.typ", "chapters/intro.typ"]));
    expect(labels(result)).not.toContain("main.typ");
    expect(labels(result)).not.toContain("refs.bib");
    expect(result!.options[0]).toMatchObject({ kind: "file" });
  });

  it("goes up from a file in a subfolder in an include string", async () => {
    const result = await complete("#include \"|\"", { path: "chapters/intro.typ", prefix: "" });
    expect(labels(result)).toContain("../lib.typ");
    expect(labels(result)).toContain("back.typ");
  });

  it("offers only images in an image string", async () => {
    expect(labels(await complete("#image(\"|\")"))).toEqual(["figs/plot.png"]);
  });
});

describe("Typst completion stays silent", () => {
  it("inside a comment", async () => {
    expect(await complete("// #te|")).toBeNull();
  });

  it("in a plain markup word unless asked", async () => {
    expect(await complete("Hel|")).toBeNull();
    expect(await complete("Hel|", { explicit: true })).not.toBeNull();
  });
});
