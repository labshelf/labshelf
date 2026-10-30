import { classifyDestName, classifyLinkText } from "../../src/reader/destTarget";

describe("classifyDestName", () => {
  it("1.1a maps theorem.2.1 and lemma.3 to a statement", () => {
    expect(classifyDestName("theorem.2.1")).toEqual({ kind: "statement" });
    expect(classifyDestName("lemma.3")).toEqual({ kind: "statement" });
  });

  it("1.1a maps abbreviated and upper-case statement names, and colon separators, to a statement", () => {
    expect(classifyDestName("thm.1")).toEqual({ kind: "statement" });
    expect(classifyDestName("defn.4")).toEqual({ kind: "statement" });
    expect(classifyDestName("Theorem.2.1")).toEqual({ kind: "statement" });
    expect(classifyDestName("proposition:main")).toEqual({ kind: "statement" });
  });

  it("1.1a maps figure.3 to a figure float with label 3", () => {
    expect(classifyDestName("figure.3")).toEqual({ kind: "float", floatKind: "figure", label: "3" });
  });

  it("1.1a maps equation.2.5 to an equation float with label 2.5", () => {
    expect(classifyDestName("equation.2.5")).toEqual({ kind: "float", floatKind: "equation", label: "2.5" });
  });

  it("1.1a maps table names to a table float", () => {
    expect(classifyDestName("table.2")).toEqual({ kind: "float", floatKind: "table", label: "2" });
  });

  it("1.1a gives figure.caption.5 a figure float with a null label", () => {
    expect(classifyDestName("figure.caption.5")).toEqual({ kind: "float", floatKind: "figure", label: null });
  });

  it("1.1a returns null for section.3, Item.12, page.4, cite.Green and opaque names", () => {
    expect(classifyDestName("section.3")).toBeNull();
    expect(classifyDestName("Item.12")).toBeNull();
    expect(classifyDestName("page.4")).toBeNull();
    expect(classifyDestName("cite.Green")).toBeNull();
    expect(classifyDestName("a1b2c3d4")).toBeNull();
  });
});

describe("classifyLinkText", () => {
  it("1.1b reads 'by Theorem 2.1' and 'see Lemma 3' as statements", () => {
    expect(classifyLinkText("by Theorem 2.1")).toEqual({ kind: "statement" });
    expect(classifyLinkText("see Lemma 3")).toEqual({ kind: "statement" });
  });

  it("1.1b reads abbreviations, plurals, sub-letters and Portuguese words as statements", () => {
    expect(classifyLinkText("by Thm. 1.2")).toEqual({ kind: "statement" });
    expect(classifyLinkText("Proposition 3a")).toEqual({ kind: "statement" });
    expect(classifyLinkText("combining Theorems 2")).toEqual({ kind: "statement" });
    expect(classifyLinkText("pelo Teorema 3")).toEqual({ kind: "statement" });
  });

  it("1.1b reads 'Fig. 4' as a figure float with label 4", () => {
    expect(classifyLinkText("as shown in Fig. 4")).toEqual({ kind: "float", floatKind: "figure", label: "4" });
  });

  it("1.1b reads 'Table 2' as a table float with label 2", () => {
    expect(classifyLinkText("results in Table 2")).toEqual({ kind: "float", floatKind: "table", label: "2" });
  });

  it("1.1b matches float words case-insensitively and in Portuguese", () => {
    expect(classifyLinkText("FIGURE 3")).toEqual({ kind: "float", floatKind: "figure", label: "3" });
    expect(classifyLinkText("na Tabela 5")).toEqual({ kind: "float", floatKind: "table", label: "5" });
  });

  it("1.1b reads 'equation (3.1)' as an equation float with label 3.1", () => {
    expect(classifyLinkText("by equation (3.1)")).toEqual({ kind: "float", floatKind: "equation", label: "3.1" });
  });

  it("1.1b reads a bare '(3.1)' as an equation float with label 3.1", () => {
    expect(classifyLinkText("we obtain (3.1)")).toEqual({ kind: "float", floatKind: "equation", label: "3.1" });
  });

  it("1.1b returns null for 'see [12]'", () => {
    expect(classifyLinkText("see [12]")).toBeNull();
  });

  it("1.1b returns null when the statement or float word has no number at the end", () => {
    expect(classifyLinkText("by the Theorem")).toBeNull();
    expect(classifyLinkText("the Figure")).toBeNull();
  });
});
