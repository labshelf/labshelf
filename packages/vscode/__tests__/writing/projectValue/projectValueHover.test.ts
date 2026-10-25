// Tests the hover on \lsvalue keys and json() members: value, file and path, and the unknown-key message.
import * as vscode from "vscode";

import { ValueHoverProvider } from "../../../src/writing/projectValue/projectValueHover";
import { valuesFixture } from "../../support/valueFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";


const RESULTS = JSON.stringify({ acc: 0.91, model: { name: "a_b" } });

async function hover(marked: string, format: "latex" | "typst" = "latex", values = ["results.json"], file?: string) {
  const fixture = valuesFixture({ "results.json": RESULTS }, { format, values });
  const { text, position } = withCursor(marked);
  const path = fixture.source(file ?? (format === "latex" ? "main.tex" : "main.typ"));
  const result = await new ValueHoverProvider(fixture.values).provideHover(fakeDocument(path, text), position);
  return result && { text: (result.contents as unknown as vscode.MarkdownString).value, range: result.range };
}

describe("LaTeX hover", () => {
  it("shows the value and its file and path", async () => {
    const result = (await hover("Acc \\lsvalue{results.a|cc} here"))!;
    expect(result.text).toBe("0.91\n\nresults.json → acc");
    expect(result.range).toMatchObject({ start: { character: 13 }, end: { character: 24 } });
  });

  it("shows nested keys and string values as text", async () => {
    expect((await hover("\\lsvalue{results.model.na|me}"))!.text).toBe("a_b\n\nresults.json → model.name");
  });

  it("says when a key is unknown", async () => {
    expect((await hover("\\lsvalue{results.nope|}"))!.text).toContain('No value "results.nope"');
  });

  it("shows nothing outside \\lsvalue, outside a project's sources or without values", async () => {
    expect(await hover("results.a|cc")).toBeUndefined();
    expect(await hover("\\cite{results.a|cc}")).toBeUndefined();
    expect(await hover("\\lsvalue{results.a|cc}", "latex", [])).toBeUndefined();
    expect(await hover("\\lsvalue{results.a|cc}", "latex", ["results.json"], "../x.tex")).toBeUndefined();
  });
});

describe("Typst hover", () => {
  it("shows the value behind json(\"…\").member", async () => {
    const result = (await hover('#json("results.json").a|cc', "typst"))!;
    expect(result.text).toBe("0.91\n\nresults.json → acc");
    expect(result.range).toMatchObject({ start: { character: 22 }, end: { character: 25 } });
  });

  it("shows the value behind a bound name and says when a member is unknown", async () => {
    const bound = '#let r = json("results.json")\n#r.model.na|me';
    expect((await hover(bound, "typst"))!.text).toBe("a_b\n\nresults.json → model.name");
    expect((await hover(bound.replace("na|me", "no|pe"), "typst"))!.text).toContain('No value "model.nope"');
  });

  it("shows nothing on a member that holds more members, on json() of an unlisted file or on other code", async () => {
    expect(await hover('#json("results.json").mod|el', "typst")).toBeUndefined();
    expect(await hover('#json("other.json").a|cc', "typst")).toBeUndefined();
    expect(await hover("#let r = 1\n#r.a|cc", "typst")).toBeUndefined();
  });
});
