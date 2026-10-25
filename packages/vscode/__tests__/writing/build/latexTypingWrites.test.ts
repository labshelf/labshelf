// Tests that typing in a LaTeX source saves it after a pause, only in typing mode.
import * as vscode from "vscode";

import { registerLatexTypingSaves } from "../../../src/writing/build/latexTypingWrites";
import { fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

const workspace = vscode.workspace as unknown as {
  _fireTextDocumentChange: (event: unknown) => void;
  _config: Record<string, Record<string, unknown>>;
};
let context: { subscriptions: { dispose(): void }[] };

function doc(fsPath: string, save = jest.fn(async () => true), isDirty = true) {
  return { uri: Object.assign(vscode.Uri.file(fsPath), { scheme: "file" }), isDirty, save };
}
const type = (document: unknown, contentChanges: unknown[] = [{}]) => workspace._fireTextDocumentChange({ document, contentChanges });

function setup(host = fakeHost()) {
  const projects = fakeProjects([readyEntry("/p/tex", { main: "main.tex" }), readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } })]);
  context = { subscriptions: [] };
  registerLatexTypingSaves({ context, host, projects: projects as never });
}

beforeEach(() => {
  delete workspace._config["labshelf.writing"];
  jest.useFakeTimers();
});

afterEach(() => {
  context.subscriptions.forEach((subscription) => subscription.dispose());
  jest.useRealTimers();
});

describe("registerLatexTypingSaves", () => {
  it("saves once, 300 ms after the last keystroke of a burst", async () => {
    setup();
    const document = doc("/p/tex/main.tex");
    type(document);
    await jest.advanceTimersByTimeAsync(200);
    type(document);
    await jest.advanceTimersByTimeAsync(299);
    expect(document.save).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(document.save).toHaveBeenCalledTimes(1);
  });

  it.each(["save", "off"])("never saves in %s mode", async (mode) => {
    workspace._config["labshelf.writing"] = { autoCompile: mode };
    setup();
    const document = doc("/p/tex/main.tex");
    type(document);
    await jest.advanceTimersByTimeAsync(1000);
    expect(document.save).not.toHaveBeenCalled();
  });

  it("ignores Typst, outside files and changes without content", async () => {
    setup();
    const typst = doc("/p/typ/main.typ");
    const outside = doc("/elsewhere/a.tex");
    const empty = doc("/p/tex/main.tex");
    type(typst);
    type(outside);
    type(empty, []);
    await jest.advanceTimersByTimeAsync(1000);
    expect([typst, outside, empty].map((d) => d.save.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it("skips a document that is no longer dirty and logs a failed save", async () => {
    const host = fakeHost();
    setup(host);
    const clean = doc("/p/tex/a.tex", jest.fn(async () => true), false);
    const failing = doc("/p/tex/b.tex", jest.fn(async () => { throw new Error("disk"); }));
    type(clean);
    type(failing);
    await jest.advanceTimersByTimeAsync(300);
    expect(clean.save).not.toHaveBeenCalled();
    expect(host.session.logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ file: "/p/tex/b.tex" }));
  });
});
