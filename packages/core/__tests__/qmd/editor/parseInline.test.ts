// Pins the inline Markdown reader and writer: exact round trip, structure and canonical output.
import { Fragment, type Node } from "prosemirror-model";
import { parseInline } from "../../../src/qmd/editor/parseInline";
import { serializeInline } from "../../../src/qmd/editor/serializeInline";
import { qmdSchema } from "../../../src/qmd/editor/schema";

const roundTrip = (text: string): string => serializeInline(Fragment.from(parseInline(text)));

const nodeName = (node: Node): string =>
  node.isText ? (node.marks.length ? node.marks.map((mark) => mark.type.name).join("+") : "text") : node.type.name;

describe("parseInline round trip", () => {
  it.each([
    "Some *em*, _em_, **strong**, __strong__ and `code` and ``a ` b``.",
    "The value $x^2 + 1$ and $5 and $ not math$.",
    "![The model](figures/model.png) and [page 4](labshelf:vaswani2017#p4) and [*x*](https://e.org).",
    "See [@a], [@a; @b] and [@a;@b].",
    "one\\\ntwo  \nthree\nfour",
    "costs $5 today",
    "**not closed and *also*",
    "[text](no close and [@key and ![alt](",
    "\\*not em\\* and \\$5",
    "snake_case_name and 2*3*4",
    "***both*** and *a **b** c*",
    "",
    "$$x$$ inline",
    "**_mixed_** and _**mixed**_ and [a [b](c)](d)",
    "trailing \\\\\nescaped and single \nspace",
    "[x](a b) and [y](u \"title\") and [](empty)",
    "`unclosed `` code and ``` and $ x$ and $x $",
    "*a\nb* and [multi\nline](h)",
  ])("keeps %j", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("keeps random strings of special characters", () => {
    const alphabet = ["*", "_", "`", "$", "[", "]", "(", ")", "!", "@", ";", "\\", "\n", " ", "a", "1"];
    let seed = 7;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 3000; run++) {
      const text = Array.from({ length: 1 + Math.floor(next() * 14) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
      expect(roundTrip(text)).toBe(text);
    }
  });
});

describe("parseInline structure", () => {
  it("reads citations, math, links and strong", () => {
    const nodes = parseInline("See [@a; @b], $x$, [p](labshelf:v#p4) and **b**.");
    expect(nodes.map(nodeName)).toEqual(["text", "citation", "text", "math_inline", "text", "link", "text", "strong", "text"]);
    expect(nodes[1]?.attrs.keys).toEqual(["a", "b"]);
    expect(nodes[3]?.attrs.tex).toBe("x");
    expect(nodes[5]?.marks[0]?.attrs.href).toBe("labshelf:v#p4");
  });

  it("reads line break markers", () => {
    const breaks = parseInline("one\\\ntwo  \nthree\nfour").filter((node: Node) => node.type.name === "hard_break");
    expect(breaks.map((node: Node) => node.attrs.marker)).toEqual(["\\", "  ", ""]);
  });

  it("reads emphasis markers, code ticks and images", () => {
    const nodes = parseInline("_a_ ``b`` ![c](d.png)");
    expect(nodes[0]?.marks[0]?.attrs.marker).toBe("_");
    expect(nodes[2]?.marks[0]?.attrs.ticks).toBe(2);
    expect(nodes[4]?.attrs).toEqual({ alt: "c", src: "d.png" });
  });

  it("leaves intraword underscores and unclosed delimiters as text", () => {
    expect(parseInline("snake_case_name").map(nodeName)).toEqual(["text"]);
    expect(parseInline("**open").map(nodeName)).toEqual(["text"]);
  });

  it.each(["Some *em* and `x`", "one\\\ntwo  \nthree", "[@a] [x](y) $z$ ![a](b)", "", "***both***"])("builds a valid paragraph from %j", (text) => {
    expect(() => qmdSchema.node("paragraph", null, parseInline(text)).check()).not.toThrow();
  });
});

describe("serializeInline canonical output", () => {
  const s = qmdSchema;
  it.each<[string, Node[], string]>([
    ["em", [s.text("a", [s.mark("em")])], "*a*"],
    ["strong", [s.text("a", [s.mark("strong")])], "**a**"],
    ["code", [s.text("a", [s.mark("code")])], "`a`"],
    ["code containing a tick", [s.text("a`b", [s.mark("code")])], "``a`b``"],
    ["link", [s.text("t", [s.mark("link", { href: "h" })])], "[t](h)"],
    ["image", [s.node("image", { alt: "a", src: "s" })], "![a](s)"],
    ["citation", [s.node("citation", { keys: ["a", "b"] })], "[@a; @b]"],
    ["stale citation raw", [s.node("citation", { keys: ["c"], raw: "[@a]" })], "[@c]"],
    ["math", [s.node("math_inline", { tex: "x^2" })], "$x^2$"],
    ["hard break", [s.text("a"), s.node("hard_break"), s.text("b")], "a\\\nb"],
    [
      "nested marks",
      [s.text("a", [s.mark("em")]), s.text("b", [s.mark("em"), s.mark("strong")]), s.text("c", [s.mark("em")])],
      "*a**b**c*",
    ],
    [
      "link around emphasis",
      [s.text("a", [s.mark("em"), s.mark("link", { href: "h" })]), s.text("b", [s.mark("link", { href: "h" })])],
      "[*a*b](h)",
    ],
  ])("writes %s", (_name, nodes, expected) => {
    expect(serializeInline(Fragment.from(nodes))).toBe(expected);
  });
});
