/** Verifies Typst go-to-definition of bindings, labels, path strings and citation keys, and logging of failed reads. */
import { at, fixture } from "./typstProjectFixture";

async function definition(marked: string) {
  const [text, offset] = at(marked);
  return fixture().service.definition("main.typ", text, offset);
}

describe("Typst definition", () => {
  it("finds a let in the same file", async () => {
    expect(await definition("#ans|wer")).toEqual({ path: "main.typ", from: 75, to: 81, line: 3 });
  });

  it("finds a let in an imported file", async () => {
    expect(await definition("#no|te[x]")).toMatchObject({ path: "lib.typ", line: 1 });
  });

  it("finds a label reference", async () => {
    expect(await definition("See @int|ro.")).toMatchObject({ path: "chapters/intro.typ", line: 0 });
  });

  it("opens the file of an import path", async () => {
    const [text] = at("");
    expect(await fixture().service.definition("main.typ", text, 10)).toEqual({ path: "lib.typ", from: 0, to: 0, line: 0 });
  });

  it("finds a citation key in its .bib file", async () => {
    expect(await definition("See @knu|th84.")).toMatchObject({ path: "refs.bib", line: 0 });
  });

  it("is null on plain text", async () => {
    expect(await definition("Plain wo|rd")).toBeNull();
  });
});

describe("Typst language service reads", () => {
  it("logs a failed read with its path and goes on without the file", async () => {
    const { logger, service } = fixture(["lib.typ"]);
    const [text, offset] = at("#|");
    const result = await service.complete("main.typ", text, offset, false);
    expect(result!.options.map((option) => option.label)).toContain("answer");
    expect(logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ path: "lib.typ" }));
  });
});
