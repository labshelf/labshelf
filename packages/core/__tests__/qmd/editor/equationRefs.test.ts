// Pins `@eq-…` references in prose and the numbering of labelled display equations.
import { Fragment, type Node } from "prosemirror-model";
import { parseInline, serializeInline } from "../../../src/qmd/editor/qmdInline";
import { bodyToDoc } from "../../../src/qmd/editor/qmdDoc";
import { findEquation, numberEquations } from "../../../src/qmd/equationNumbers";

const roundTrip = (text: string): string => serializeInline(Fragment.from(parseInline(text)));
const refs = (text: string): string[] => parseInline(text).filter((node) => node.type.name === "eq_ref").map((node) => node.attrs.label as string);
const kinds = (text: string): string[] => parseInline(text).map((node: Node) => node.type.name);

describe("@eq- references", () => {
  it.each([
    "A @eq-tnp é o teorema e a @eq-mangoldt define.",
    "@eq-a",
    "See @eq-a.",
    "Ends @eq-a-: and @eq-b:",
    "mail email@eq-x.com and @eq_x and @eq-",
    "See [@green2008primes] and @eq-a; [@eq-b].",
    "`@eq-a` and *@eq-a*",
  ])("round-trips %j byte for byte", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("reads a reference at the start or after a non-word character", () => {
    expect(refs("@eq-a")).toEqual(["eq-a"]);
    expect(refs("(@eq-a:b)")).toEqual(["eq-a:b"]);
    expect(kinds("@eq-a")).toEqual(["eq_ref"]);
  });

  it("keeps a trailing dot, colon or dash as text", () => {
    expect(kinds("@eq-a.")).toEqual(["eq_ref", "text"]);
    expect(refs("@eq-a.")).toEqual(["eq-a"]);
    expect(refs("@eq-a-: x")).toEqual(["eq-a"]);
  });

  it("leaves an email, a bare @eq- and code as text", () => {
    expect(kinds("email@eq-x.com")).toEqual(["text"]);
    expect(kinds("você@eq-x")).toEqual(["text"]);
    expect(refs("@eq- and @eq")).toEqual([]);
    expect(refs("`@eq-a`")).toEqual([]);
  });

  it("still reads a bracketed key as a citation", () => {
    const nodes = parseInline("[@green2008primes]");
    expect(nodes.map((node) => node.type.name)).toEqual(["citation"]);
    expect(nodes[0]!.attrs.keys).toEqual(["green2008primes"]);
  });
});

describe("numberEquations", () => {
  const body = "$$\na\n$$ {#eq-first}\n\n$$\nb\n$$\n\nText @eq-second.\n\n$$\nc\n$$ {#eq-second}\n";

  it("numbers labelled display equations 1, 2 in order, skipping unlabelled ones", () => {
    expect(numberEquations(bodyToDoc(body)).map(({ label, number }) => [label, number])).toEqual([["eq-first", 1], ["eq-second", 2]]);
  });

  it("finds the equation a reference points to, and none for an unknown label", () => {
    const doc = bodyToDoc(body);
    const equations = numberEquations(doc);
    const second = findEquation(equations, "eq-second");
    expect(second?.number).toBe(2);
    expect(doc.nodeAt(second!.pos)?.attrs.label).toBe("eq-second");
    expect(findEquation(equations, "eq-missing")).toBeUndefined();
  });
});
