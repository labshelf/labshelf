/** Verifies the reader's cite popup service: the projects and files it offers, the text it reads, where and what it inserts, and the bibliography action. */
import type { PaperRecord } from "../../../src/model/index";
import type { ReadyProject } from "../../../src/writing/project/index";
import { answerReaderCite, type ReaderCiteIo } from "../../../src/writing/citations/index";
import { sourceExtensionOf } from "../../../src/writing/project/buildRoot";

const paper = { id: "p1", citeKey: "smith2020", doi: "10.1/x", path: "papers/ml/smith2020", title: "T" } as PaperRecord;

function project(id: string, format: "latex" | "typst", extra: Partial<ReadyProject["settings"]> = {}, main?: string): ReadyProject {
  return { kind: "ready", folder: `/p/${id}`, location: "library", settings: { id, format, engine: "pdflatex", ...extra } as ReadyProject["settings"], main };
}

interface Fixture {
  io: ReaderCiteIo;
  texts: Record<string, string>;
  inserts: Array<[string, string, number, string]>;
  refreshed: Array<[string, string]>;
  listed: string[];
}

function setup(projects: ReadyProject[], files: Record<string, string[]>, recent: Record<string, string[]> = {}, texts: Record<string, string> = {}): Fixture {
  const fx: Fixture = {
    texts, inserts: [], refreshed: [], listed: [],
    io: {
      projects: async () => projects,
      listFiles: async (p) => files[p.settings.id] ?? [],
      recentFiles: (p) => recent[p.settings.id] ?? [],
      read: async (p, path) => {
        const text = fx.texts[`${p.settings.id}/${path}`];
        if (text === undefined) { throw new Error(`missing ${path}`); }
        return text;
      },
      insert: async (p, path, offset, text) => {
        fx.inserts.push([p.settings.id, path, offset, text]);
        const key = `${p.settings.id}/${path}`;
        const raw = fx.texts[key]!;
        fx.texts[key] = raw.slice(0, offset) + text + raw.slice(offset);
      },
      addToBibliography: async (p, pp) => { fx.listed.push(`${p.settings.id}:${pp.citeKey}`); },
      refreshBibliography: async (p, path) => { fx.refreshed.push([p.settings.id, path]); },
    },
  };
  return fx;
}

describe("sourceExtensionOf", () => {
  it("maps each format to its source extension", () => {
    expect(sourceExtensionOf("latex")).toBe(".tex");
    expect(sourceExtensionOf("typst")).toBe(".typ");
  });
});

describe("answerReaderCite targets", () => {
  it("lists the projects, recent first, with filtered and ordered files", async () => {
    const a = project("a", "latex", { title: "Alpha", papers: [{ key: "smith2020" }] }, "main.tex");
    const b = project("b", "typst", { bibliography: "refs.bib" }, "main.typ");
    const fx = setup([a, b], {
      a: ["z.tex", "main.tex", "b.tex", "fig.png", "sec/intro.tex", "notes.typ"],
      b: ["main.typ", "a.typ", "x.tex"],
    }, { b: ["a.typ", "gone.typ"] });
    const reply = await answerReaderCite(fx.io, paper, { kind: "targets" });
    expect(reply).toEqual({
      kind: "targets",
      projects: [
        { id: "b", title: "b", format: "typst", bibliography: "refs.bib", inBibliography: false, files: ["a.typ", "main.typ"] },
        { id: "a", title: "Alpha", format: "latex", bibliography: "labshelf.bib", inBibliography: true, files: ["main.tex", "b.tex", "sec/intro.tex", "z.tex"] },
      ],
    });
  });

  it("orders recent files first, then main, then the rest alphabetically", async () => {
    const a = project("a", "latex", {}, "main.tex");
    const fx = setup([a], { a: ["c.tex", "main.tex", "b.tex", "a.tex"] }, { a: ["c.tex", "a.tex"] });
    const reply = await answerReaderCite(fx.io, paper, { kind: "targets" });
    expect(reply).toMatchObject({ kind: "targets", projects: [{ files: ["c.tex", "a.tex", "main.tex", "b.tex"] }] });
  });

  it("keeps the given order of projects without a recent file", async () => {
    const fx = setup([project("x", "latex"), project("y", "latex")], { x: ["a.tex"], y: ["b.tex"] });
    const reply = await answerReaderCite(fx.io, paper, { kind: "targets" });
    expect(reply.kind === "targets" && reply.projects.map((p) => p.id)).toEqual(["x", "y"]);
  });

  it("answers an error when the projects cannot be listed", async () => {
    const fx = setup([], {});
    fx.io.projects = async () => { throw new Error("no library"); };
    expect(await answerReaderCite(fx.io, paper, { kind: "targets" })).toEqual({ kind: "error", message: "no library" });
  });
});

describe("answerReaderCite read", () => {
  it("normalises CRLF and returns a version that is not the text", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/main.tex": "one\r\ntwo\r\n" });
    const reply = await answerReaderCite(fx.io, paper, { kind: "read", projectId: "a", path: "main.tex" });
    expect(reply).toMatchObject({ kind: "source", text: "one\ntwo\n" });
    const version = reply.kind === "source" ? reply.version : "";
    expect(version).toMatch(/^[0-9a-z-]{1,24}$/);
    expect(version).not.toContain("one");
    const again = await answerReaderCite(fx.io, paper, { kind: "read", projectId: "a", path: "main.tex" });
    expect(again).toEqual(reply);
  });

  it("gives a different version for a different text", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/main.tex": "one" });
    const first = await answerReaderCite(fx.io, paper, { kind: "read", projectId: "a", path: "main.tex" });
    fx.texts["a/main.tex"] = "two";
    const second = await answerReaderCite(fx.io, paper, { kind: "read", projectId: "a", path: "main.tex" });
    expect(first.kind === "source" && second.kind === "source" && first.version !== second.version).toBe(true);
  });

  it("refuses a path that is not listed and an unknown project", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex", "fig.png"] }, {}, { "a/fig.png": "x", "a/other.tex": "y" });
    expect(await answerReaderCite(fx.io, paper, { kind: "read", projectId: "a", path: "fig.png" })).toMatchObject({ kind: "error" });
    expect(await answerReaderCite(fx.io, paper, { kind: "read", projectId: "a", path: "other.tex" })).toMatchObject({ kind: "error" });
    expect(await answerReaderCite(fx.io, paper, { kind: "read", projectId: "nope", path: "main.tex" })).toMatchObject({ kind: "error" });
  });
});

describe("answerReaderCite insert", () => {
  async function versionOf(fx: Fixture, path = "main.tex"): Promise<string> {
    const reply = await answerReaderCite(fx.io, paper, { kind: "read", projectId: "a", path });
    if (reply.kind !== "source") { throw new Error("no source"); }
    return reply.version;
  }

  it("writes the citation with its page at the raw offset of a CRLF file and refreshes the bibliography", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/main.tex": "one\r\ntwo\r\nthree" });
    const version = await versionOf(fx);
    const offset = "one\ntwo\n".length;
    const reply = await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "main.tex", version, offset, page: 4, quoted: false });
    expect(reply).toEqual({ kind: "inserted", path: "main.tex", citation: "\\cite[p.~4]{smith2020}" });
    expect(fx.inserts).toEqual([["a", "main.tex", offset + 2, "\\cite[p.~4]{smith2020}"]]);
    expect(fx.texts["a/main.tex"]).toBe("one\r\ntwo\r\n\\cite[p.~4]{smith2020}three");
    expect(fx.refreshed).toEqual([["a", "main.tex"]]);
  });

  it("writes the quotation before the citation when quoted", async () => {
    const fx = setup([project("a", "typst")], { a: ["main.typ"] }, {}, { "a/main.typ": "Text." });
    const version = await versionOf(fx, "main.typ");
    const reply = await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "main.typ", version, offset: 5, page: 2, quote: "A passage", quoted: true });
    expect(reply.kind).toBe("inserted");
    const citation = reply.kind === "inserted" ? reply.citation : "";
    expect(citation).toContain("A passage");
    expect(citation.endsWith("@smith2020[p. 2]")).toBe(true);
    expect(fx.inserts[0]![2]).toBe(5);
  });

  it("writes the plain citation when the quote is absent or not asked for", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/main.tex": "x" });
    let version = await versionOf(fx);
    expect(await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "main.tex", version, offset: 0, quoted: true }))
      .toEqual({ kind: "inserted", path: "main.tex", citation: "\\cite{smith2020}" });
    version = await versionOf(fx);
    expect(await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "main.tex", version, offset: 0, quote: "Q", quoted: false }))
      .toEqual({ kind: "inserted", path: "main.tex", citation: "\\cite{smith2020}" });
  });

  it("clamps an offset past the end", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/main.tex": "a\r\nb" });
    const version = await versionOf(fx);
    await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "main.tex", version, offset: 99, quoted: false });
    expect(fx.inserts[0]![2]).toBe(4);
  });

  it("answers stale and writes nothing when the version differs", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/main.tex": "x" });
    const version = await versionOf(fx);
    fx.texts["a/main.tex"] = "changed";
    const reply = await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "main.tex", version, offset: 0, quoted: false });
    expect(reply).toMatchObject({ kind: "error", stale: true });
    expect(fx.inserts).toEqual([]);
    expect(fx.refreshed).toEqual([]);
  });

  it("refuses a path that is not listed", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/x.tex": "x" });
    const reply = await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "x.tex", version: "v", offset: 0, quoted: false });
    expect(reply).toMatchObject({ kind: "error" });
    expect(reply).not.toHaveProperty("stale");
    expect(fx.inserts).toEqual([]);
  });

  it("answers an error when the write fails", async () => {
    const fx = setup([project("a", "latex")], { a: ["main.tex"] }, {}, { "a/main.tex": "x" });
    const version = await versionOf(fx);
    fx.io.insert = async () => { throw new Error("read-only"); };
    expect(await answerReaderCite(fx.io, paper, { kind: "insert", projectId: "a", path: "main.tex", version, offset: 0, quoted: false }))
      .toEqual({ kind: "error", message: "read-only" });
  });
});

describe("answerReaderCite bibliography", () => {
  it("adds the paper and answers the bibliography file name", async () => {
    const fx = setup([project("a", "latex", { bibliography: "refs.bib" })], { a: [] });
    expect(await answerReaderCite(fx.io, paper, { kind: "bibliography", projectId: "a" })).toEqual({ kind: "listed", bibliography: "refs.bib" });
    expect(fx.listed).toEqual(["a:smith2020"]);
  });

  it("answers the default file name and an error for an unknown project", async () => {
    const fx = setup([project("a", "typst")], { a: [] });
    expect(await answerReaderCite(fx.io, paper, { kind: "bibliography", projectId: "a" })).toEqual({ kind: "listed", bibliography: "labshelf.bib" });
    expect(await answerReaderCite(fx.io, paper, { kind: "bibliography", projectId: "b" })).toMatchObject({ kind: "error" });
    expect(fx.listed).toEqual(["a:smith2020"]);
  });
});
