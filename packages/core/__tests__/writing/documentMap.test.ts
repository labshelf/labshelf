// Pins the document map of a preview's rail: included files expanded in place, headings and marks in expanded order, review marks
// from comments and suggestions, SyncTeX points when given, and the rail's placing between known heights and back.
import {
  buildDocumentMap, deriveDocumentMapOrder, findDocumentMapLine, foldHeadingTitle as foldTitle, interpolateDocumentMap as interpolate,
  invertDocumentMap as invert, matchDocumentMapOutline as matchOutline,
} from "../../src/writing/documentMap";
import type { CommentThread } from "../../src/collab/comments";

const MAIN = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Intro}",
  "\\input{chapters/methods}",
  "\\section{Results}",
  "\\begin{figure}",
  "\\includegraphics{plot.png}",
  "\\caption{Capacity over time}",
  "\\end{figure}",
  "\\end{document}",
].join("\n");

const METHODS = [
  "\\section{Methods}",
  "\\subsection{Cells}",
  "We stored cells.",
  "\\begin{equation}\\label{eq:fit}",
  "Q = Q_0 - k\\sqrt{t}",
  "\\end{equation}",
  "\\includegraphics{setup.png}",
].join("\n");

const files: Record<string, string> = { "main.tex": MAIN, "chapters/methods.tex": METHODS };
const read = (path: string): Promise<string | undefined> => Promise.resolve(files[path]);

describe("buildDocumentMap", () => {
  it("expands an included file at its include line, so its headings sit between the includer's", async () => {
    const map = await buildDocumentMap({ format: "latex", root: "main.tex", read });
    expect(map.headings.map((heading) => [heading.title, heading.file, heading.line])).toEqual([
      ["Intro", "main.tex", 3],
      ["Methods", "chapters/methods.tex", 1],
      ["Cells", "chapters/methods.tex", 2],
      ["Results", "main.tex", 5],
    ]);
    const ats = map.headings.map((heading) => heading.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
  });

  it("marks figures with their caption, equations with their label, and images outside a figure only", async () => {
    const map = await buildDocumentMap({ format: "latex", root: "main.tex", read });
    expect(map.marks.map((mark) => [mark.kind, mark.file, mark.line, mark.label])).toEqual([
      ["equation", "chapters/methods.tex", 4, "eq:fit"],
      ["image", "chapters/methods.tex", 7, "setup.png"],
      ["figure", "main.tex", 6, "Capacity over time"],
    ]);
  });

  it("covers every line once and maps a file line to its expanded line and back", async () => {
    const map = await buildDocumentMap({ format: "latex", root: "main.tex", read });
    const total = map.segments.reduce((sum, segment) => sum + segment.to - segment.from + 1, 0);
    expect(total).toBe(MAIN.split("\n").length + METHODS.split("\n").length);
    const at = deriveDocumentMapOrder(map.segments, "chapters/methods.tex", 3);
    expect(at).toBeDefined();
    expect(findDocumentMapLine(map.segments, at!)).toEqual({ file: "chapters/methods.tex", line: 3 });
    expect(map.body.start).toBe(deriveDocumentMapOrder(map.segments, "main.tex", 2));
  });

  it("places unresolved comment threads and grouped suggestions once, in the files the root includes", async () => {
    const thread = (id: string, file: string, quote: string, resolved = false): CommentThread => ({
      id, file, resolved, anchor: { quote, prefix: "", suffix: "" },
      comments: [{ id: `${id}c`, author: "Ana", body: "Check this", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    const map = await buildDocumentMap({
      format: "latex", root: "main.tex", read,
      threads: [thread("a", "chapters/methods.tex", "stored cells"), thread("b", "main.tex", "Results", true), thread("c", "other.tex", "x")],
      suggestions: [
        { id: "s1", file: "main.tex", kind: "delete", anchor: { quote: "", prefix: "\\section{", suffix: "Intro}" }, text: "Old", group: "g", author: "Bo", created: "2026-01-01T00:00:00.000Z" },
        { id: "s2", file: "main.tex", kind: "insert", anchor: { quote: "Intro", prefix: "\\section{", suffix: "}" }, group: "g", author: "Bo", created: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const review = map.marks.filter((mark) => mark.kind === "comment" || mark.kind === "edit");
    expect(review.map((mark) => [mark.kind, mark.file, mark.line])).toEqual([["edit", "main.tex", 3], ["comment", "chapters/methods.tex", 3]]);
    expect(review[1]!.label).toBe("Ana: Check this");
  });

  it("gives each place the point `locate` finds", async () => {
    const map = await buildDocumentMap({ format: "latex", root: "main.tex", read, locate: (file, line) => (file === "main.tex" ? { page: 1, x: 0, y: line * 10 } : undefined) });
    expect(map.headings.find((heading) => heading.title === "Results")!.point).toEqual({ page: 1, x: 0, y: 50 });
    expect(map.headings.find((heading) => heading.title === "Methods")!.point).toBeUndefined();
  });

  it("reads a file included twice or in a cycle once", async () => {
    const loop: Record<string, string> = { "a.tex": "\\input{b}\n\\section{A}", "b.tex": "\\input{a}\n\\section{B}" };
    const map = await buildDocumentMap({ format: "latex", root: "a.tex", read: (path) => Promise.resolve(loop[path]) });
    expect(map.headings.map((heading) => heading.title)).toEqual(["B", "A"]);
  });

  it("lists Typst headings and figures", async () => {
    const map = await buildDocumentMap({ format: "typst", root: "main.typ", read: () => Promise.resolve("= Intro\n#figure(image(\"a.png\"), caption: [A plot])\n== Detail\n$ x + y $") });
    expect(map.headings.map((heading) => [heading.title, heading.level])).toEqual([["Intro", 1], ["Detail", 2]]);
    expect(map.marks.map((mark) => [mark.kind, mark.label])).toEqual([["figure", "A plot"], ["equation", undefined]]);
  });
});

describe("the rail's placing", () => {
  const body = { start: 0, end: 100 };

  it("interpolates between known heights and inverts back", () => {
    const anchors = [{ at: 20, y: 400 }, { at: 60, y: 800 }];
    expect(interpolate(anchors, 40, body, 1000)).toBe(600);
    expect(interpolate(anchors, 10, body, 1000)).toBe(200);
    expect(interpolate(anchors, 80, body, 1000)).toBe(900);
    expect(invert(anchors, 600, body, 1000)).toBe(40);
    expect(interpolate([], 50, body, 1000)).toBe(500);
  });

  it("matches headings to outline entries by folded title, in order, numbered entries included", () => {
    expect(foldTitle("The \\emph{Model} assumptions")).toBe("the model assumptions");
    const pairs = matchOutline([{ title: "Intro" }, { title: "Missing" }, { title: "Results" }], [{ title: "1 Intro" }, { title: "2 Results" }]);
    expect([...pairs]).toEqual([[0, 0], [2, 1]]);
  });
});
