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

async function definition(marked: string) {
  const [text, offset] = at(marked);
  return fixture().service.definition("main.typ", text, offset);
}

describe("Typst definition", () => {
  it("finds a let in the same file", async () => {
    expect(await definition("#ans|wer")).toEqual({ path: "main.typ", from: 75, to: 81, line: 3 });
  });

  it("finds a let in an imported file", async () => {
    expect(await definition("#no|te[x]")).toMatchObject({ path: "lib.typ", line: 1 });
  });

  it("finds a label reference", async () => {
    expect(await definition("See @int|ro.")).toMatchObject({ path: "chapters/intro.typ", line: 0 });
  });

  it("opens the file of an import path", async () => {
    const [text] = at("");
    expect(await fixture().service.definition("main.typ", text, 10)).toEqual({ path: "lib.typ", from: 0, to: 0, line: 0 });
  });

  it("finds a citation key in its .bib file", async () => {
    expect(await definition("See @knu|th84.")).toMatchObject({ path: "refs.bib", line: 0 });
  });

  it("is null on plain text", async () => {
    expect(await definition("Plain wo|rd")).toBeNull();
  });
});

describe("Typst language service reads", () => {
  it("logs a failed read with its path and goes on without the file", async () => {
    const { logger, service } = fixture(["lib.typ"]);
    const [text, offset] = at("#|");
    const result = await service.complete("main.typ", text, offset, false);
    expect(result!.options.map((option) => option.label)).toContain("answer");
    expect(logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ path: "lib.typ" }));
  });
});

async function hover(marked: string) {
  const [text, offset] = at(marked);
  return fixture().service.hover("main.typ", text, offset);
}

describe("Typst hover", () => {
  it("shows a built-in's signature, doc and parameters", async () => {
    const result = await hover("#te|xt(red)[x]");
    expect(result!.text.startsWith("```typst\ntext(")).toBe(true);
    expect(result!.text).toContain("`fill`");
    const [text, offset] = at("#te|xt(red)[x]");
    expect(text.slice(result!.from, result!.to)).toBe("text");
    expect(offset).toBeGreaterThan(result!.from);
  });

  it("shows a let binding's signature and /// doc", async () => {
    const result = await hover("#ans|wer");
    expect(result!.text).toBe("```typst\nlet answer\n```\n\nThe answer.");
  });

  it("shows a label's line and file", async () => {
    const result = await hover("See @int|ro.");
    expect(result!.text).toContain("= Intro");
    expect(result!.text).toContain("chapters/intro.typ");
  });

  it("shows a citation key's title, authors and year", async () => {
    const result = await hover("See @knu|th84.");
    expect(result!.text).toContain("Literate Programming");
    expect(result!.text).toContain("Knuth, Donald E.");
    expect(result!.text).toContain("1984");
  });

  it("is null on plain text", async () => {
    expect(await hover("Plain wo|rd")).toBeNull();
  });
});
