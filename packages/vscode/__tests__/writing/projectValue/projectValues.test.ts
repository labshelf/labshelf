// Tests the value cache: one read per project, dropped when a value file or the project list changes, and the registration.
import * as vscode from "vscode";

import { registerProjectValues } from "../../../src/writing/projectValue/index";
import { valuesFixture } from "../../support/valueFixtures";

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
    expect(watchers().length).toBe(before + 1);
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
