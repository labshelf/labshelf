/** Verifies Typst hover on a built-in, a documented binding, a label reference and a citation key. */
import { at, fixture } from "./typstProjectFixture";

async function hover(marked: string) {
  const [text, offset] = at(marked);
  return fixture().service.hover("main.typ", text, offset);
}

describe("Typst hover", () => {
  it("shows a built-in's signature, doc and parameters", async () => {
    const result = await hover("#te|xt(red)[x]");
    expect(result!.text.startsWith("```typst\ntext(")).toBe(true);
    expect(result!.text).toContain("`fill`");
    const [text, offset] = at("#te|xt(red)[x]");
    expect(text.slice(result!.from, result!.to)).toBe("text");
    expect(offset).toBeGreaterThan(result!.from);
  });

  it("shows a let binding's signature and /// doc", async () => {
    const result = await hover("#ans|wer");
    expect(result!.text).toBe("```typst\nlet answer\n```\n\nThe answer.");
  });

  it("shows a label's line and file", async () => {
    const result = await hover("See @int|ro.");
    expect(result!.text).toContain("= Intro");
    expect(result!.text).toContain("chapters/intro.typ");
  });

  it("shows a citation key's title, authors and year", async () => {
    const result = await hover("See @knu|th84.");
    expect(result!.text).toContain("Literate Programming");
    expect(result!.text).toContain("Knuth, Donald E.");
    expect(result!.text).toContain("1984");
  });

  it("is null on plain text", async () => {
    expect(await hover("Plain wo|rd")).toBeNull();
  });
});
