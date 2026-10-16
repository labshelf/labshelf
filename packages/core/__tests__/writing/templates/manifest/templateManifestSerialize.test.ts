/** Verifies that a serialized template manifest parses back to the same manifest. */
import { parseTemplateManifest, serializeTemplateManifest } from "../../../../src/writing/templates/index";
import type { TemplateManifest } from "../../../../src/writing/templates/index";

const latex: TemplateManifest = {
  id: "my-thesis", name: "My: thesis # one", description: "Line with \"quotes\" and: colons.",
  category: "thesis", format: "latex", engine: "xelatex", main: "main.tex", license: "MIT", authors: ["Jane Doe", "A, B"],
};

describe("serializeTemplateManifest", () => {
  it("round-trips a LaTeX manifest through parseTemplateManifest", () => {
    const parsed = parseTemplateManifest(serializeTemplateManifest(latex));
    expect(parsed).toEqual({ ok: true, manifest: expect.objectContaining({ ...latex }) });
  });

  it("round-trips a Typst manifest with a compiler version", () => {
    const typst: TemplateManifest = { ...latex, format: "typst", engine: "typst", main: "main.typ", compiler: "0.13.0" };
    const parsed = parseTemplateManifest(serializeTemplateManifest(typst));
    expect(parsed.ok && parsed.manifest.compiler).toBe("0.13.0");
    expect(parsed.ok && parsed.manifest.engine).toBe("typst");
  });
});
