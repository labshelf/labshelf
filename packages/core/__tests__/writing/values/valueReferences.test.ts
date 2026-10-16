/** Verifies where a value reference is found in LaTeX and Typst text, for completion and hover. */
import { latexKeyStart, latexValueAt, typstValueAt, typstValuePrefix } from "../../../src/writing/values/index";

describe("LaTeX references", () => {
  it("finds the start of the partial key only inside \\lsvalue{", () => {
    expect(latexKeyStart("Accuracy \\lsvalue{res")).toBe(18);
    expect(latexKeyStart("\\lsvalue{")).toBe(9);
    expect(latexKeyStart("\\lsvalue{results.acc} and \\cite{")).toBeUndefined();
    expect(latexKeyStart("\\cite{res")).toBeUndefined();
    expect(latexKeyStart("\\lsvalue{a b")).toBeUndefined();
  });

  it("finds the key under the offset with its range", () => {
    const text = "x \\lsvalue{results.acc} y \\lsvalue{b}";
    expect(latexValueAt(text, 14)).toEqual({ key: "results.acc", start: 11, end: 22 });
    expect(latexValueAt(text, 11)?.key).toBe("results.acc");
    expect(latexValueAt(text, 22)?.key).toBe("results.acc");
    expect(latexValueAt(text, 2)).toBeUndefined();
    expect(latexValueAt(text, text.length - 1)?.key).toBe("b");
  });
});

describe("Typst references", () => {
  it("completes members after json(\"…\").", () => {
    const text = '#let x = json("results.json").model.na';
    expect(typstValuePrefix(text, text.length)).toEqual({ source: "results.json", parent: "model", start: text.length - 2 });
    const dot = '#json("r.json").';
    expect(typstValuePrefix(dot, dot.length)).toEqual({ source: "r.json", parent: "", start: dot.length });
  });

  it("completes members of a name bound with #let or let", () => {
    const text = '#let r = json("data/r.json")\nValue: #r.a.b.';
    expect(typstValuePrefix(text, text.length)).toEqual({ source: "data/r.json", parent: "a.b", start: text.length });
    const inCode = '#{\n  let r = json("r.json")\n  r.ac\n}';
    const at = inCode.indexOf("r.ac") + 4;
    expect(typstValuePrefix(inCode, at)).toEqual({ source: "r.json", parent: "", start: at - 2 });
  });

  it("offers nothing for an unbound name, a bare name, text after a space or another file type", () => {
    expect(typstValuePrefix("#r.a", 4)).toBeUndefined();
    expect(typstValuePrefix('#let r = json("r.json")\n#r', 27)).toBeUndefined();
    expect(typstValuePrefix('#json("r.json").a ', 18)).toBeUndefined();
    expect(typstValuePrefix('#let r = yaml("r.yaml")\n#r.', 27)).toBeUndefined();
    expect(typstValuePrefix('#let r = json("r.json")\n#x.r.', 29)).toBeUndefined();
  });

  it("uses the binding before the reference", () => {
    const text = '#let r = json("a.json")\n#r.x\n#let r = json("b.json")\n#r.y';
    expect(typstValuePrefix(text, text.indexOf("#r.x") + 4)?.source).toBe("a.json");
    expect(typstValuePrefix(text, text.length)?.source).toBe("b.json");
  });

  it("finds the member path up to the hovered name", () => {
    const text = '#json("r.json").model.acc';
    const acc = text.indexOf("acc");
    expect(typstValueAt(text, acc + 1)).toEqual({ source: "r.json", path: "model.acc", start: acc, end: acc + 3 });
    expect(typstValueAt(text, text.indexOf("model") + 2)?.path).toBe("model");
    expect(typstValueAt(text, 3)).toBeUndefined();
    expect(typstValueAt('#let r = json("r.json")\n#r.acc', 28)?.path).toBe("acc");
  });
});
