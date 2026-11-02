// 3.1a: the `[$…$]{.labshelf-result engine=… source=…}` span is an atom math_result node and round-trips byte for byte.
import type { Node } from "prosemirror-model";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor/qmdDoc";

const SPAN = "[$x^2 = 4$]{.labshelf-result engine=mathematica-14.1 source=3f9a1c0b7d2e}";

const resultNodes = (doc: Node): Node[] => {
  const found: Node[] = [];
  doc.descendants((node) => {
    if (node.type.name === "math_result") found.push(node);
  });
  return found;
};

const roundTrip = (body: string): string => docToBody(bodyToDoc(body));

describe("math_result span round trip", () => {
  it.each([
    ["alone in a paragraph", `${SPAN}\n`],
    ["inside a sentence", `The area is ${SPAN} in total.\n`],
    ["at the start and the end of a line", `${SPAN} then text then ${SPAN}\n`],
    ["beside inline math and marks", `With $a$ and *em* then ${SPAN} and **strong**.\n`],
    ["with a fraction and backslashes", "Result [$\\frac{1}{3}$]{.labshelf-result engine=mathematica-14.1 source=aaaaaaaaaaaa}.\n"],
    ["in a heading", `# Heading ${SPAN}\n`],
    ["in a list item", `- item ${SPAN}\n- other\n`],
    ["in a blockquote", `> quoted ${SPAN}\n`],
    ["next to a cell and a display equation", `Text ${SPAN}\n\n$$x$$\n\n\`\`\`{mathematica}\nx = 1\n\`\`\`\n`],
    ["without a trailing newline", `Value ${SPAN}`],
    ["with CRLF line endings", `First ${SPAN}\r\nsecond ${SPAN}\r\n`],
    ["after a soft line break", `line one\n${SPAN} line two\n`],
  ])("3.1a keeps a body with a span %s byte for byte", (_name, body) => {
    expect(roundTrip(body)).toBe(body);
  });

  it("3.1a keeps the result document valid for the schema", () => {
    expect(() => bodyToDoc(`The area is ${SPAN} in total.\n`).check()).not.toThrow();
  });
});

describe("math_result node", () => {
  it("3.1a reads a well-formed span as one math_result atom", () => {
    const nodes = resultNodes(bodyToDoc(`The area is ${SPAN} in total.\n`));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.isAtom).toBe(true);
    expect(nodes[0]!.isInline).toBe(true);
  });

  it("3.1a carries tex, engine and source as attributes", () => {
    const [node] = resultNodes(bodyToDoc(`The area is ${SPAN} in total.\n`));
    expect(node!.attrs.tex).toBe("x^2 = 4");
    expect(node!.attrs.engine).toBe("mathematica-14.1");
    expect(node!.attrs.source).toBe("3f9a1c0b7d2e");
  });

  it("3.1a reads every span of a paragraph in order", () => {
    const body = "A [$1$]{.labshelf-result engine=e source=s1} and [$2$]{.labshelf-result engine=e source=s2}.\n";
    const nodes = resultNodes(bodyToDoc(body));
    expect(nodes.map((node) => node.attrs.tex)).toEqual(["1", "2"]);
    expect(nodes.map((node) => node.attrs.source)).toEqual(["s1", "s2"]);
  });

  it("3.1a reads the span inside a list item", () => {
    expect(resultNodes(bodyToDoc(`- item ${SPAN}\n`))).toHaveLength(1);
  });

  it("3.1a does not read a span inside a code fence", () => {
    const body = `\`\`\`\n${SPAN}\n\`\`\`\n`;
    expect(resultNodes(bodyToDoc(body))).toHaveLength(0);
    expect(roundTrip(body)).toBe(body);
  });
});

describe("malformed result spans stay text", () => {
  it.each([
    ["engine is missing", "Value [$x = 4$]{.labshelf-result source=3f9a1c0b7d2e} here.\n"],
    ["an attribute is unknown", "Value [$x = 4$]{.labshelf-result engine=e source=s colour=red} here.\n"],
    ["two maths are inside", "Value [$x = 4$ and $y = 5$]{.labshelf-result engine=e source=s} here.\n"],
    ["the class is not labshelf-result", "Value [$x = 4$]{.other engine=e source=s} here.\n"],
    ["the attribute block is missing", "Value [$x = 4$] here.\n"],
    ["the attribute block is unclosed", "Value [$x = 4$]{.labshelf-result engine=e source=s here.\n"],
    ["the brackets hold no math", "Value [x = 4]{.labshelf-result engine=e source=s} here.\n"],
    ["the math is empty", "Value [$$]{.labshelf-result engine=e source=s} here.\n"],
  ])("3.1a keeps the text when %s", (_name, body) => {
    const doc = bodyToDoc(body);
    expect(resultNodes(doc)).toHaveLength(0);
    expect(docToBody(doc)).toBe(body);
  });

  it("3.1a leaves a link with math as a link, not a result", () => {
    const body = "See [$x$](https://e.org) now.\n";
    const doc = bodyToDoc(body);
    expect(resultNodes(doc)).toHaveLength(0);
    expect(docToBody(doc)).toBe(body);
  });

  it("3.1a a malformed span beside a good one still reads the good one", () => {
    const body = `Bad [$x$]{.labshelf-result source=s} and good ${SPAN}.\n`;
    const doc = bodyToDoc(body);
    expect(resultNodes(doc)).toHaveLength(1);
    expect(docToBody(doc)).toBe(body);
  });
});

describe("A5 span contract", () => {
  it("A5 round-trips a span and reads it as a math_result", () => {
    const body = `Prose ${SPAN} prose.\n`;
    const doc = bodyToDoc(body);
    expect(resultNodes(doc)).toHaveLength(1);
    expect(docToBody(doc)).toBe(body);
  });

  it("A5 keeps malformed spans as text", () => {
    const body = "Prose [$x$]{.labshelf-result source=s} prose.\n";
    const doc = bodyToDoc(body);
    expect(resultNodes(doc)).toHaveLength(0);
    expect(docToBody(doc)).toBe(body);
  });
});
