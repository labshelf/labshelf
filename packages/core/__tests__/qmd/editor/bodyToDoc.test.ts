import type { Node } from "prosemirror-model";
import { parseItemFile } from "../../../src/qmd/items/index";
import { bodyToDoc } from "../../../src/qmd/editor/bodyToDoc";
import { docToBody } from "../../../src/qmd/editor/docToBody";
import { qmdFixtures, readQmdFixture } from "../fixtures/qmdFixtures";

const types = (doc: Node) => doc.content.content.map((block) => block.type.name);

const bodies = qmdFixtures().flatMap((fixture) =>
  parseItemFile(fixture.text).segments.map((segment, index) => [
    `${fixture.name} #${index}`,
    segment.kind === "item" ? segment.body : segment.text,
  ]),
);

describe("bodyToDoc and docToBody", () => {
  it.each(bodies)("round-trip the body %s byte for byte", (_name, body) => {
    const doc = bodyToDoc(body!);
    expect(() => doc.check()).not.toThrow();
    expect(docToBody(doc)).toBe(body);
  });

  it.each([
    ["paragraph with marks", "Some *em*, _em_, **strong**, __strong__ and `code` and ``a ` b``.\n"],
    ["headings", "# One\n\n###   Three\n\n###### Six\n"],
    ["bullet lists", "- a\n- b\n\n* c\n* d\n\n+   e\n"],
    ["ordered lists", "1. a\n2. b\n\n3) c\n4) d\n"],
    ["loose list", "- a\n\n- b\n"],
    ["nested lists", "- a\n  - b\n  - c\n- d\n\n1. x\n   1. y\n"],
    ["task lists", "- [ ] open\n- [x] done\n- [X] done too\n"],
    ["inline math", "The value $x^2 + 1$ and $5 and $ not math$.\n"],
    ["display math", "$$\nE = mc^2\n$$ {#eq-energy}\n\n$$x$$\n"],
    ["code cell", "```{python}\n#| label: a\n#| echo: false\nprint(1)\n```\n"],
    ["tilde and long fence", "~~~~ {r}\nx <- 1\n~~~~~\n\n```\nplain\n```\n"],
    ["code containing a fence", "````{python}\ns = '''\n```\n'''\n````\n"],
    ["output", '::: {.labshelf-output cell="a" source="3f9a1c0b7d2e"}\n$$1$$\n:::\n'],
    ["other div", "::: {.callout-note}\nA callout.\n:::\n"],
    ["images and links", "![The model](figures/model.png) and [page 4](labshelf:vaswani2017#p4) and [*x*](https://e.org).\n"],
    ["citations", "See [@a], [@a; @b] and [@a;@b].\n"],
    ["hard breaks", "one\\\ntwo  \nthree\nfour\n"],
    ["raw markdown", "> a quote\n\n| a | b |\n|---|---|\n\n---\n\n    indented code\n\nSetext\n======\n"],
    ["gaps and trailing lines", "\n\nfirst\n\n\n\nsecond\n  \n\n"],
    ["no final newline", "# Title\n\ntext"],
    ["blank last line without ending", "text\n  "],
    ["only blank lines", "\n\n"],
    ["empty body", ""],
    ["CRLF body", "# T\r\n\r\n- a\r\n- b\r\n\r\n```{python}\r\nx\r\n```\r\n\r\n$$\r\nx\r\n$$ {#eq-a}\r\n"],
    ["CR body", "a\rb\r\r- c\r"],
    ["mixed line endings", "a\r\nb\n\nc\r\n"],
    ["unclosed fence", "```{python}\nprint(1)\n\nmore\n"],
    ["unclosed dollar", "costs $5 today\n"],
    ["unclosed strong", "**not closed and *also*\n"],
    ["unclosed output div", '::: {.labshelf-output cell="a" source="b"}\nresult\n'],
    ["unclosed link and citation", "[text](no close and [@key and ![alt](\n"],
    ["lazy list continuation", "- item\ncontinued\n"],
    ["escapes", "\\*not em\\* and \\$5\n"],
    ["intraword underscores", "snake_case_name and 2*3*4\n"],
  ])("round-trip %s byte for byte", (_name, body) => {
    const doc = bodyToDoc(body);
    expect(() => doc.check()).not.toThrow();
    expect(docToBody(doc)).toBe(body);
  });

  it("keeps the text of malformed input", () => {
    const doc = bodyToDoc("```{python}\nprint(1)\n\n**open $x\n");
    expect(doc.textContent).toContain("print(1)");
    expect(doc.textContent).toContain("**open $x");
  });

  it("reads a labelled display math block", () => {
    const doc = bodyToDoc(readQmdFixture("notes-math.qmd").split("\n").slice(9, 12).join("\n") + "\n");
    expect(types(doc)).toEqual(["math_display"]);
    expect(doc.firstChild!.attrs).toMatchObject({ label: "eq-attention" });
    expect(doc.firstChild!.attrs.tex).toContain("\\mathrm{Attention}");
  });

  it("splits a code cell into options and code", () => {
    const doc = bodyToDoc("```{python}\n#| label: bound\nimport sympy\nx = 1\n```\n");
    expect(doc.firstChild!.type.name).toBe("code_cell");
    expect(doc.firstChild!.attrs).toMatchObject({ lang: "python", options: "#| label: bound\n", code: "import sympy\nx = 1\n" });
  });

  it("reads an item body into its blocks", () => {
    const item = parseItemFile(readQmdFixture("cell-output.qmd")).segments.find((s) => s.kind === "item")!;
    const doc = bodyToDoc(item.kind === "item" ? item.body : "");
    expect(types(doc)).toEqual(["code_cell", "output"]);
    expect(doc.lastChild!.attrs).toMatchObject({ cell: "bound", source: "3f9a1c0b7d2e", engine: "python-3.12 sympy-1.13" });
  });

  it("reads citations, links, math and marks inline", () => {
    const paragraph = bodyToDoc("See [@a; @b], $x$, [p](labshelf:v#p4) and **b**.\n").firstChild!;
    const names: string[] = [];
    paragraph.forEach((child) => names.push(child.isText ? child.marks.map((m) => m.type.name).join("+") || "text" : child.type.name));
    expect(names).toEqual(["text", "citation", "text", "math_inline", "text", "link", "text", "strong", "text"]);
    expect(paragraph.child(1).attrs.keys).toEqual(["a", "b"]);
  });

  it("reads task items and nested lists", () => {
    const list = bodyToDoc("- [ ] open\n- [x] done\n  - nested\n").firstChild!;
    expect(list.type.name).toBe("bullet_list");
    expect(list.child(0).type.name).toBe("task_item");
    expect(list.child(1).attrs.checked).toBe(true);
    expect(list.child(1).lastChild!.type.name).toBe("bullet_list");
  });

  it("keeps markdown outside the subset as raw blocks", () => {
    expect(types(bodyToDoc("> quote\n\n| a |\n|---|\n"))).toEqual(["raw_block", "raw_block"]);
    expect(types(bodyToDoc("::: {.callout-note}\nx\n:::\n"))).toEqual(["raw_block"]);
  });
});
