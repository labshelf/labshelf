/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Copying a picked image into the project's images folder, and inserting the figure that shows it.
import type { ILogger, LibraryFileSystem, ProjectEntry } from "@labshelf/core";
import { toast } from "@labshelf/core/dom";
import { onLocalFileChanges } from "../../../../../src/library-page/editor/collab/mirror/localFileChanges";
import { insertImage, type ImageInsertion } from "../../../../../src/library-page/tabs/source/actions/insertImage";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), toast: jest.fn() }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

function fakeFs(existing: string[] = []) {
  const written = new Map<string, Uint8Array>();
  const dirs: string[] = [];
  const fs = {
    exists: async (path: string) => existing.includes(path) || written.has(path),
    ensureDir: async (path: string) => { dirs.push(path); },
    writeFile: async (path: string, bytes: Uint8Array) => { written.set(path, bytes); },
  } as unknown as LibraryFileSystem;
  return { fs, written, dirs };
}

function entry(extra: Record<string, unknown> = {}, main: string | undefined = "main.tex"): Extract<ProjectEntry, { kind: "ready" }> {
  return { kind: "ready", folder: "lib/p", main, settings: { id: "p", ...extra } } as unknown as Extract<ProjectEntry, { kind: "ready" }>;
}

/** Makes the next file input the user clicks answer with `file`, or cancel when it is undefined. */
function userPicks(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> } | undefined): jest.SpyInstance {
  return jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    if (!file) return void this.dispatchEvent(new Event("cancel"));
    Object.defineProperty(this, "files", { value: [file] });
    this.dispatchEvent(new Event("change"));
  });
}

const png = { name: "plot.png", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };

function insertion(fs: LibraryFileSystem, over: Partial<ImageInsertion> = {}) {
  const edits = { insertText: jest.fn(), insertSnippet: jest.fn(), wrap: jest.fn() };
  return { edits, run: () => insertImage({ edits, language: "latex", entry: entry(), path: "main.tex", fs, logger, ...over }) };
}

afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

describe("insertImage", () => {
  it("offers only the language's image types", async () => {
    const accepted: string[] = [];
    jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { accepted.push(this.accept); this.dispatchEvent(new Event("cancel")); });
    await insertion(fakeFs().fs).run();
    await insertion(fakeFs().fs, { language: "typst", path: "main.typ" }).run();
    expect(accepted).toEqual([".png,.jpg,.jpeg,.pdf,.eps", ".png,.jpg,.jpeg,.gif,.svg"]);
  });

  it("writes the bytes into images/ and inserts the figure with the path relative to the main file", async () => {
    userPicks(png);
    const { fs, written, dirs } = fakeFs();
    const { edits, run } = insertion(fs);
    await run();
    expect(dirs).toEqual(["lib/p/images"]);
    expect([...written.keys()]).toEqual(["lib/p/images/plot.png"]);
    expect([...written.get("lib/p/images/plot.png")!]).toEqual([1, 2, 3]);
    expect(edits.insertSnippet).toHaveBeenCalledTimes(1);
    expect(edits.insertSnippet.mock.calls[0][0]).toContain("includegraphics[width=0.8\\\\linewidth]{images/plot.png");
    expect(logger.log).toHaveBeenCalledWith("INFO", "tabs.source", expect.any(String), { source: "main.tex", image: "lib/p/images/plot.png" });
  });

  it("names the copy -2 when the file name is taken", async () => {
    userPicks(png);
    const { fs, written } = fakeFs(["lib/p/images/plot.png"]);
    const { edits, run } = insertion(fs);
    await run();
    expect([...written.keys()]).toEqual(["lib/p/images/plot-2.png"]);
    expect(edits.insertSnippet.mock.calls[0][0]).toContain("images/plot-2.png");
  });

  it("resolves the path from the folder of a Typst file in a subfolder", async () => {
    userPicks({ ...png, name: "fig.svg" });
    const { fs } = fakeFs();
    const { edits, run } = insertion(fs, { language: "typst", path: "chapters/one.typ", entry: entry({}, undefined) });
    await run();
    expect(edits.insertSnippet.mock.calls[0][0]).toContain('"../images/fig.svg"');
  });

  it("does nothing when the dialog is cancelled", async () => {
    userPicks(undefined);
    const { fs, written } = fakeFs();
    const { edits, run } = insertion(fs);
    await run();
    expect(written.size).toBe(0);
    expect(edits.insertSnippet).not.toHaveBeenCalled();
  });

  it("logs and toasts a failed copy without inserting", async () => {
    userPicks(png);
    const { fs } = fakeFs();
    fs.writeFile = async () => { throw new Error("disk full"); };
    const { edits, run } = insertion(fs);
    await run();
    expect(edits.insertSnippet).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("tabs.source", expect.any(Error), expect.objectContaining({ source: "main.tex", folder: "lib/p" }));
    expect(toast).toHaveBeenCalledWith("Could not copy the image into the project: disk full", "error");
  });

  it("copies the image into a shared project and tells the share's mirror at once", async () => {
    userPicks(png);
    const { fs, written } = fakeFs();
    const reported: (readonly string[])[] = [];
    const stop = onLocalFileChanges((paths) => reported.push(paths));
    const { edits, run } = insertion(fs, { entry: entry({ shared: "f".repeat(32) }) });
    await run();
    stop();
    expect([...written.keys()]).toEqual(["lib/p/images/plot.png"]);
    expect(reported).toEqual([["lib/p/images/plot.png"]]);
    expect(edits.insertSnippet).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
