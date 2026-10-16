// Tests that values complete only inside \lsvalue{ and over json() members of listed files.
import * as vscode from "vscode";

import { ValueCompletionProvider } from "../../../src/writing/values/valueCompletion";
import { removeValueFolders, valuesFixture } from "../../support/valueFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

afterEach(removeValueFolders);

const RESULTS = JSON.stringify({ acc: 0.91, model: { name: "bert", layers: [1, 2] }, skip: null });

async function complete(
  marked: string, over: { format?: "latex" | "typst"; file?: string; files?: Record<string, string>; values?: string[] } = {},
) {
  const format = over.format ?? "latex";
  const fixture = valuesFixture(over.files ?? { "results.json": RESULTS, "sub/other.json": '{"z":1}' }, { format, values: over.values ?? ["results.json", "sub/other.json"] });
  const { text, position } = withCursor(marked);
  const file = fixture.source(over.file ?? (format === "latex" ? "main.tex" : "main.typ"));
  return new ValueCompletionProvider(fixture.values).provideCompletionItems(fakeDocument(file, text), position);
}

describe("LaTeX completion", () => {
  it("lists every key inside \\lsvalue{ with the value as detail and the file as documentation", async () => {
    const items = (await complete("Accuracy \\lsvalue{res|"))!;
    expect(items.map((item) => item.label)).toEqual(["results.acc", "results.model.name", "results.model.layers.0", "results.model.layers.1", "other.z"]);
    const [acc] = items;
    expect([acc!.detail, acc!.documentation, acc!.insertText, acc!.kind]).toEqual(["0.91", "results.json", "results.acc", vscode.CompletionItemKind.Value]);
    const range = acc!.range as vscode.Range;
    expect([range.start.character, range.end.character]).toEqual([18, 21]);
  });

  it("fires after the { and after a . inside the key, and replaces the whole typed key", async () => {
    expect(await complete("\\lsvalue{|")).toHaveLength(5);
    const range = (await complete("\\lsvalue{results.|"))![0]!.range as vscode.Range;
    expect([range.start.character, range.end.character]).toEqual([9, 17]);
  });

  it("offers nothing outside \\lsvalue{, so cite and ref completion keep their own lists", async () => {
    expect(await complete("\\cite{|")).toBeUndefined();
    expect(await complete("\\ref{fig.|")).toBeUndefined();
    expect(await complete("results.|")).toBeUndefined();
    expect(await complete("\\lsvalue{results.acc}|")).toBeUndefined();
  });

  it("offers nothing in a project without values, outside a project or in a Typst file", async () => {
    expect(await complete("\\lsvalue{|", { values: [] })).toBeUndefined();
    expect(await complete("\\lsvalue{|", { file: "../elsewhere.tex" })).toBeUndefined();
    expect(await complete("\\lsvalue{|", { file: "main.typ" })).toBeUndefined();
  });

  it("skips an invalid value file but lists the others", async () => {
    const items = await complete("\\lsvalue{|", { files: { "results.json": "{oops", "sub/other.json": '{"z":1}' } });
    expect(items!.map((item) => item.label)).toEqual(["other.z"]);
  });
});

describe("Typst completion", () => {
  it("lists the members of json(\"…\") and replaces the typed name", async () => {
    const items = (await complete('#json("results.json").mo|', { format: "typst" }))!;
    expect(items.map((item) => item.label)).toEqual(["acc", "model"]);
    expect([items[0]!.detail, items[0]!.documentation, items[1]!.detail, items[1]!.kind])
      .toEqual(["0.91", "results.json", undefined, vscode.CompletionItemKind.Field]);
    const range = items[0]!.range as vscode.Range;
    expect([range.start.character, range.end.character]).toEqual([22, 24]);
  });

  it("lists nested members of a name bound with #let, without array indexes", async () => {
    const source = '#let r = json("results.json")\nThe #r.model.|';
    expect((await complete(source, { format: "typst" }))!.map((item) => item.label)).toEqual(["name", "layers"]);
    expect(await complete(source.replace("model.|", "model.layers.|"), { format: "typst" })).toEqual([]);
  });

  it("resolves the path from the .typ file's folder, and from the project root when it starts with /", async () => {
    const relative = await complete('#json("../results.json").|', { format: "typst", file: "sub/doc.typ" });
    expect(relative!.map((item) => item.label)).toEqual(["acc", "model"]);
    const rooted = await complete('#json("/sub/other.json").|', { format: "typst", file: "sub/deep/doc.typ" });
    expect(rooted!.map((item) => item.label)).toEqual(["z"]);
  });

  it("offers nothing for a file that values does not list or outside a json() member", async () => {
    expect(await complete('#json("unlisted.json").|', { format: "typst" })).toBeUndefined();
    expect(await complete("#let r = 5\n#r.|", { format: "typst" })).toBeUndefined();
    expect(await complete("see @key.|", { format: "typst" })).toBeUndefined();
  });
});
