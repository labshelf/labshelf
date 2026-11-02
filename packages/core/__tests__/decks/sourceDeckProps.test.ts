// Tests that setSourceDeckProp and setSourceNote change only the property's span and that the block tree reads the new value back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceDeckBlocks, readSourceDeckNotes, setSourceDeckProp, setSourceNote, type SourceDeckNode } from "../../src/decks/index.js";

const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");
const node = (tree: SourceDeckNode[], ...path: number[]): SourceDeckNode => path.reduce<SourceDeckNode>((at, n) => at.children![n]!, { children: tree } as SourceDeckNode);

/** The [start, end) of `before` that differs from `after`, and what replaced it. */
function changed(before: string, after: string): { from: number; to: number; inserted: string } {
  let p = 0; while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0; while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { from: p, to: before.length - s, inserted: after.slice(p, after.length - s) };
}

describe("setSourceDeckProp (LaTeX)", () => {
  const text = fixture("beamerposter.tex");
  const tree = readSourceDeckBlocks("latex", "poster", text);
  const figure = node(tree, 0, 0, 1);

  it.each([
    ["src", "figures/new.png", "figures/plot.png", "figures/new.png"],
    ["width", 0.5, "0.8", "0.5"],
    ["caption", "Another plot.", "A plot.", "Another plot."],
    ["align", "right", "\\centering", "\\raggedleft"],
  ] as const)("rewrites %s in its span only and reads it back", (prop, value, old, written) => {
    const change = setSourceDeckProp("latex", text, figure, prop, value)!;
    const start = text.indexOf(old, figure.range[0]);
    const diff = changed(text, change.text);
    expect(diff.from).toBeGreaterThanOrEqual(start);
    expect(diff.to).toBeLessThanOrEqual(start + old.length);
    expect(change.text).toBe(text.slice(0, start) + written + text.slice(start + old.length));
    expect(change.cursor).toBe(start + written.length);
    expect(node(readSourceDeckBlocks("latex", "poster", change.text), 0, 0, 1).props[prop]).toBe(value);
  });

  it("rewrites a block title and a column width", () => {
    const title = setSourceDeckProp("latex", text, node(tree, 0, 0), "title", "Intro")!;
    expect(title.text).toBe(text.replace("{Introduction}", "{Intro}"));
    expect(node(readSourceDeckBlocks("latex", "poster", title.text), 0, 0).title).toBe("Intro");
    const width = setSourceDeckProp("latex", text, node(tree, 1), "columnWidth", 0.3)!;
    expect(width.text).toBe(text.replace(/0\.45/g, (m, at: number) => (at > node(tree, 1).range[0] ? "0.3" : m)));
    expect(readSourceDeckBlocks("latex", "poster", width.text)[1]!.props.columnWidth).toBe(0.3);
  });

  it("gives null for code nodes, values out of range and absent forms", () => {
    expect(setSourceDeckProp("latex", text, node(tree, 1, 0, 2), "title", "x")).toBeNull();
    expect(setSourceDeckProp("latex", text, figure, "width", 1.5)).toBeNull();
    expect(setSourceDeckProp("latex", text, figure, "width", 0.05)).toBeNull();
    expect(setSourceDeckProp("latex", text, node(tree, 1), "columnWidth", 0)).toBeNull();
    expect(setSourceDeckProp("latex", text, node(tree, 0, 0, 0), "src", "a.png")).toBeNull();
    expect(setSourceDeckProp("latex", text, figure, "caption", "un{balanced")).toBeNull();
    expect(setSourceDeckProp("latex", text, node(tree, 0, 0), "column", 5)).toBeNull();
    expect(setSourceDeckProp("latex", text, figure, "column", 1)).toBeNull();
  });

  it("adds an alignment at the start of an environment body or around a bare node, and renames an alignment environment", () => {
    const env = "\\begin{frame}{A}\n  \\begin{figure}[h]\n    \\includegraphics{a.png}\n  \\end{figure}\n\\end{frame}\n";
    const added = setSourceDeckProp("latex", env, node(readSourceDeckBlocks("latex", "talk", env), 0, 0), "align", "center")!;
    expect(added.text).toBe(env.replace("[h]", "[h]\n    \\centering"));
    expect(added.cursor).toBe(env.indexOf("[h]") + 3 + "\n    \\centering".length);
    const bare = "\\begin{frame}{A}\n  \\includegraphics{a.png}\n\\end{frame}\n";
    const wrapped = setSourceDeckProp("latex", bare, node(readSourceDeckBlocks("latex", "talk", bare), 0, 0), "align", "center")!;
    expect(node(readSourceDeckBlocks("latex", "talk", wrapped.text), 0, 0)).toMatchObject({ kind: "figure", props: { align: "center", src: "a.png" } });
    const center = "\\begin{frame}{A}\n  \\begin{center}\\includegraphics{a.png}\\end{center}\n\\end{frame}\n";
    const left = setSourceDeckProp("latex", center, node(readSourceDeckBlocks("latex", "talk", center), 0, 0), "align", "left")!;
    expect(left.text).toBe(center.replace(/\{center\}/g, "{flushleft}"));
    expect(node(readSourceDeckBlocks("latex", "talk", left.text), 0, 0).props.align).toBe("left");
  });

  it("moves a poster block to the end of another column", () => {
    const tikz = fixture("a1-tikz.tex");
    const moved = setSourceDeckProp("latex", tikz, node(readSourceDeckBlocks("latex", "poster", tikz), 0, 0), "column", 1)!;
    const after = readSourceDeckBlocks("latex", "poster", moved.text);
    expect(after.map((column) => column.children!.map((block) => block.title))).toEqual([["Method"], ["Results", "Conclusion", "Introduction"]]);
    expect(moved.text.slice(0, moved.cursor).endsWith("  \\block{Introduction}{\n    What the problem is and why it matters.\n  }")).toBe(true);
  });
});

describe("setSourceDeckProp (Typst)", () => {
  const text = "#slide(title: [Intro])[\n  #figure(image(\"a.png\", width: 50%), caption: [Plot]) <fig>\n  Some text.\n]\n";
  const tree = readSourceDeckBlocks("typst", "talk", text);
  const figure = node(tree, 0, 0);

  it.each([
    ["src", "b.png", "\"a.png\"", "\"b.png\""],
    ["width", 0.8, "50%", "80%"],
    ["caption", "New", "[Plot]", "[New]"],
  ] as const)("rewrites %s in its span only and reads it back", (prop, value, old, written) => {
    const change = setSourceDeckProp("typst", text, figure, prop, value)!;
    expect(change.text).toBe(text.replace(old, written));
    expect(node(readSourceDeckBlocks("typst", "talk", change.text), 0, 0).props[prop]).toBe(value);
  });

  it("rewrites a slide title, wraps a missing alignment in #align and has no column width", () => {
    expect(setSourceDeckProp("typst", text, node(tree, 0), "title", "Start")!.text).toBe(text.replace("[Intro]", "[Start]"));
    const aligned = setSourceDeckProp("typst", text, node(tree, 0, 1), "align", "right")!;
    expect(aligned.text).toBe(text.replace("Some text.", "#align(right)[Some text.]"));
    expect(node(readSourceDeckBlocks("typst", "talk", aligned.text), 0, 1).props.align).toBe("right");
    const again = setSourceDeckProp("typst", aligned.text, node(readSourceDeckBlocks("typst", "talk", aligned.text), 0, 1), "align", "center")!;
    expect(again.text).toBe(text.replace("Some text.", "#align(center)[Some text.]"));
    const poster = fixture("typst-a0.typ");
    expect(setSourceDeckProp("typst", poster, readSourceDeckBlocks("typst", "poster", poster)[0]!, "columnWidth", 0.5)).toBeNull();
  });

  it("moves a heading block to the end of another column", () => {
    const poster = fixture("typst-a0.typ");
    const moved = setSourceDeckProp("typst", poster, node(readSourceDeckBlocks("typst", "poster", poster), 0, 0), "column", 1)!;
    const after = readSourceDeckBlocks("typst", "poster", moved.text);
    expect(after.map((column) => column.children!.map((block) => block.title))).toEqual([["Method"], ["Results", "Conclusion", "Introduction"]]);
  });
});

describe("setSourceNote", () => {
  const text = fixture("defesa-beamer.tex");
  const slides = readSourceDeckBlocks("latex", "talk", text);

  it("replaces, adds and removes a LaTeX note", () => {
    const replaced = setSourceNote("latex", text, slides[1]!, "New note.")!;
    expect(replaced.text).toBe(text.replace("Speaker notes for this slide: only you see them in the presenter view.", "New note."));
    expect(readSourceDeckNotes("latex", replaced.text)[1]).toBe("New note.");
    const added = setSourceNote("latex", text, slides[3]!, "Thank them.")!;
    expect(readSourceDeckNotes("latex", added.text)).toEqual([...readSourceDeckNotes("latex", text).slice(0, 3), "Thank them."]);
    expect(added.text.slice(0, added.cursor).endsWith("\\note{Thank them.")).toBe(true);
    const removed = setSourceNote("latex", text, slides[0]!, "")!;
    expect(removed.text).toBe(text.replace("  \\note{Greet the audience and say the problem in one sentence.}\n", ""));
    expect(setSourceNote("latex", text, slides[0]!, "un}balanced")).toBeNull();
  });

  it("replaces and adds a Typst note", () => {
    const typst = "== One\nText\n#speaker-note[old]\n\n== Two\nMore\n";
    const talk = readSourceDeckBlocks("typst", "talk", typst);
    expect(setSourceNote("typst", typst, talk[0]!, "new")!.text).toBe(typst.replace("[old]", "[new]"));
    const added = setSourceNote("typst", typst, talk[1]!, "two")!;
    expect(readSourceDeckNotes("typst", added.text)).toEqual(["old", "two"]);
  });
});
