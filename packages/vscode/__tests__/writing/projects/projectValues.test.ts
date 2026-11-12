// Tests the project value cache, its completion and its hover over \lsvalue keys and Typst json() members.
import * as vscode from "vscode";
import { registerProjectValues, ProjectValueCompletionProvider, ProjectValueHoverProvider } from "../../../src/writing/projects/projectValues";
import { fakeDocument, withCursor } from "../../support/textDocument";
import { valuesFixture } from "../../support/valueFixtures";
import { deriveProjectValueLeaves } from "@labshelf/core";

describe("projectValues", () => {
  const watchers = (): Array<{ pattern: { base: string; pattern: string }; dispose: jest.Mock; _fire: (kind: string, uri: vscode.Uri) => void }> =>
    (vscode as unknown as { _fileWatchers: never[] })._fileWatchers;

  function setup() {
    watchers().length = 0;
    const fixture = valuesFixture({ "results.json": '{"acc":1}' });
    const project = fixture.projects.list()[0] as Parameters<typeof fixture.values.leaves>[0];
    return { ...fixture, project };
  }

  describe("ProjectValues", () => {
    it("reads the value files once and serves the cache until a value file changes", async () => {
      const { values, project, folder, writeFile } = setup();
      expect((await values.leaves(project)).map((leaf) => leaf.value)).toEqual([1]);
      writeFile("results.json", '{"acc":2}');
      expect((await values.leaves(project)).map((leaf) => leaf.value)).toEqual([1]);
      const watcher = watchers().find((candidate) => candidate.pattern.pattern === "results.json")!;
      expect(watcher.pattern.base).toBe(folder);
      watcher._fire("change", vscode.Uri.file(`${folder}/results.json`));
      expect((await values.leaves(project)).map((leaf) => leaf.value)).toEqual([2]);
    });

    it("drops the cache and the watchers when the project list changes", async () => {
      const { values, project, changes, writeFile } = setup();
      await values.leaves(project);
      writeFile("results.json", '{"acc":3}');
      const before = watchers().length;
      changes.fire();
      expect(watchers().slice(0, before).every((watcher) => watcher.dispose.mock.calls.length === 1)).toBe(true);
      // Each project watches its listed value files and its linked values outputs again.
      expect(watchers().length).toBe(2 * before);
      expect((await values.leaves(project)).map((leaf) => leaf.value)).toEqual([3]);
    });

    it("stops watching when disposed", () => {
      const { values } = setup();
      values.dispose();
      expect(watchers().every((watcher) => watcher.dispose.mock.calls.length === 1)).toBe(true);
    });
  });

  describe("registerProjectValues", () => {
    it("registers completion, with its triggers, and hover for LaTeX and Typst sources and disposes through the context", () => {
      const { projects, logger } = setup();
      const context = { subscriptions: [] as vscode.Disposable[] };
      const completion = vscode.languages.registerCompletionItemProvider as jest.Mock;
      const hover = vscode.languages.registerHoverProvider as jest.Mock;
      completion.mockClear();
      hover.mockClear();
      registerProjectValues(context as unknown as vscode.ExtensionContext, { projects, logger: () => logger });
      expect(completion.mock.calls.map(([selector, , ...triggers]) => [selector.pattern, triggers])).toEqual([
        ["**/*.tex", ["{", "."]], ["**/*.typ", ["."]],
      ]);
      expect(hover.mock.calls.map(([selector]) => selector.pattern)).toEqual(["**/*.tex", "**/*.typ"]);
      expect(context.subscriptions.length).toBeGreaterThanOrEqual(5);
    });
  });
});

describe("registerProjectValues", () => {
  const RESULTS = JSON.stringify({ acc: 0.91, model: { name: "bert", layers: [1, 2] }, skip: null });

  async function complete(
    marked: string, over: { format?: "latex" | "typst"; file?: string; files?: Record<string, string>; values?: string[] } = {},
  ) {
    const format = over.format ?? "latex";
    const fixture = valuesFixture(over.files ?? { "results.json": RESULTS, "sub/other.json": '{"z":1}' }, { format, values: over.values ?? ["results.json", "sub/other.json"] });
    const { text, position } = withCursor(marked);
    const file = fixture.source(over.file ?? (format === "latex" ? "main.tex" : "main.typ"));
    return new ProjectValueCompletionProvider(fixture.values).provideCompletionItems(fakeDocument(file, text), position);
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
});

describe("projectValueHover", () => {
  const RESULTS = JSON.stringify({ acc: 0.91, model: { name: "a_b" } });

  async function hover(marked: string, format: "latex" | "typst" = "latex", values = ["results.json"], file?: string) {
    const fixture = valuesFixture({ "results.json": RESULTS }, { format, values });
    const { text, position } = withCursor(marked);
    const path = fixture.source(file ?? (format === "latex" ? "main.tex" : "main.typ"));
    const result = await new ProjectValueHoverProvider(fixture.values).provideHover(fakeDocument(path, text), position);
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
});

describe("linked values outputs", () => {
  const COPY = "outputs/experiments/results/metrics.json";
  const PREFIX = "experiments.results.metrics";

  /** A project whose `values:` is empty and whose only values come from a linked output's copy. */
  function linkedFixture(format: "latex" | "typst") {
    const fixture = valuesFixture({}, { format, values: [] });
    fixture.projects.data.readProjectValues.mockImplementation(async () => deriveProjectValueLeaves(COPY, { test: { acc: 0.93 } }, PREFIX).leaves);
    return fixture;
  }

  it("completes and hovers the linked keys in a LaTeX source", async () => {
    const fixture = linkedFixture("latex");
    const { text, position } = withCursor("\\lsvalue{|");
    const items = await new ProjectValueCompletionProvider(fixture.values).provideCompletionItems(fakeDocument(fixture.source("main.tex"), text), position);
    expect(items?.map((each) => each.label)).toEqual([`${PREFIX}.test.acc`]);
    const marked = withCursor(`\\lsvalue{${PREFIX}.test.a|cc}`);
    const hover = await new ProjectValueHoverProvider(fixture.values).provideHover(fakeDocument(fixture.source("main.tex"), marked.text), marked.position);
    expect((hover!.contents as unknown as vscode.MarkdownString).value).toBe(`0.93\n\n${COPY} → test.acc`);
  });

  it("resolves Typst json() of a linked copy, which values: does not list", async () => {
    const fixture = linkedFixture("typst");
    const { text, position } = withCursor(`#json("${COPY}").test.|`);
    const items = await new ProjectValueCompletionProvider(fixture.values).provideCompletionItems(fakeDocument(fixture.source("main.typ"), text), position);
    expect(items?.map((each) => each.label)).toEqual(["acc"]);
    const marked = withCursor(`#json("${COPY}").test.a|cc`);
    const hover = await new ProjectValueHoverProvider(fixture.values).provideHover(fakeDocument(fixture.source("main.typ"), marked.text), marked.position);
    expect((hover!.contents as unknown as vscode.MarkdownString).value).toBe(`0.93\n\n${COPY} → test.acc`);
  });

  it("drops the cache when the outputs file or a copy changes, even without values:", async () => {
    const watchers = (vscode as unknown as { _fileWatchers: Array<{ pattern: { base: string; pattern: string }; _fire: (kind: string, uri: vscode.Uri) => void }> })._fileWatchers;
    watchers.length = 0;
    const fixture = linkedFixture("latex");
    const project = fixture.projects.list()[0] as Parameters<typeof fixture.values.leaves>[0];
    await fixture.values.leaves(project);
    await fixture.values.leaves(project);
    expect(fixture.projects.data.readProjectValues).toHaveBeenCalledTimes(1);
    const watcher = watchers.find((each) => each.pattern.pattern.includes(".labshelf/outputs.json"))!;
    expect(watcher.pattern).toMatchObject({ base: fixture.folder, pattern: "{.labshelf/outputs.json,outputs/**/*.json}" });
    watcher._fire("change", vscode.Uri.file(`${fixture.folder}/${COPY}`));
    await fixture.values.leaves(project);
    expect(fixture.projects.data.readProjectValues).toHaveBeenCalledTimes(2);
  });
});
