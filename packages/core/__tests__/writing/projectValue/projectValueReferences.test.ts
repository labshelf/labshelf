/** Verifies where a value reference is found in LaTeX and Typst text, for completion and hover. */
import { findLatexProjectValueStart, findLatexProjectValue, findTypstProjectValue, findTypstProjectValuePrefix } from "../../../src/writing/projectValue/index";

describe("LaTeX references", () => {
  it("finds the start of the partial key only inside \\lsvalue{", () => {
    expect(findLatexProjectValueStart("Accuracy \\lsvalue{res")).toBe(18);
    expect(findLatexProjectValueStart("\\lsvalue{")).toBe(9);
    expect(findLatexProjectValueStart("\\lsvalue{results.acc} and \\cite{")).toBeUndefined();
    expect(findLatexProjectValueStart("\\cite{res")).toBeUndefined();
    expect(findLatexProjectValueStart("\\lsvalue{a b")).toBeUndefined();
  });

  it("finds the key under the offset with its range", () => {
    const text = "x \\lsvalue{results.acc} y \\lsvalue{b}";
    expect(findLatexProjectValue(text, 14)).toEqual({ key: "results.acc", start: 11, end: 22 });
    expect(findLatexProjectValue(text, 11)?.key).toBe("results.acc");
    expect(findLatexProjectValue(text, 22)?.key).toBe("results.acc");
    expect(findLatexProjectValue(text, 2)).toBeUndefined();
    expect(findLatexProjectValue(text, text.length - 1)?.key).toBe("b");
  });
});

describe("Typst references", () => {
  it("completes members after json(\"…\").", () => {
    const text = '#let x = json("results.json").model.na';
    expect(findTypstProjectValuePrefix(text, text.length)).toEqual({ source: "results.json", parent: "model", start: text.length - 2 });
    const dot = '#json("r.json").';
    expect(findTypstProjectValuePrefix(dot, dot.length)).toEqual({ source: "r.json", parent: "", start: dot.length });
  });

  it("completes members of a name bound with #let or let", () => {
    const text = '#let r = json("data/r.json")\nValue: #r.a.b.';
    expect(findTypstProjectValuePrefix(text, text.length)).toEqual({ source: "data/r.json", parent: "a.b", start: text.length });
    const inCode = '#{\n  let r = json("r.json")\n  r.ac\n}';
    const at = inCode.indexOf("r.ac") + 4;
    expect(findTypstProjectValuePrefix(inCode, at)).toEqual({ source: "r.json", parent: "", start: at - 2 });
  });

  it("offers nothing for an unbound name, a bare name, text after a space or another file type", () => {
    expect(findTypstProjectValuePrefix("#r.a", 4)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#let r = json("r.json")\n#r', 27)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#json("r.json").a ', 18)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#let r = yaml("r.yaml")\n#r.', 27)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#let r = json("r.json")\n#x.r.', 29)).toBeUndefined();
  });

  it("uses the binding before the reference", () => {
    const text = '#let r = json("a.json")\n#r.x\n#let r = json("b.json")\n#r.y';
    expect(findTypstProjectValuePrefix(text, text.indexOf("#r.x") + 4)?.source).toBe("a.json");
    expect(findTypstProjectValuePrefix(text, text.length)?.source).toBe("b.json");
  });

  it("finds the member path up to the hovered name", () => {
    const text = '#json("r.json").model.acc';
    const acc = text.indexOf("acc");
    expect(findTypstProjectValue(text, acc + 1)).toEqual({ source: "r.json", path: "model.acc", start: acc, end: acc + 3 });
    expect(findTypstProjectValue(text, text.indexOf("model") + 2)?.path).toBe("model");
    expect(findTypstProjectValue(text, 3)).toBeUndefined();
    expect(findTypstProjectValue('#let r = json("r.json")\n#r.acc', 28)?.path).toBe("acc");
  });
});
