// Tests the web build's Typst builds: the editor page compiles, the extension writes the PDFs and drives its own preview as on the desktop.
import * as vscode from "vscode";

import { posixPathOps, typstPreviewPdf, type ProjectEntry } from "@labshelf/core";
import type { TypstHostOutcome, TypstHostRequest } from "@labshelf/core/helper";
import { HostPageTypstBuilds } from "../../../src/writing/web/hostPageTypstBuilds";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { fakeHost, fakeProjectData, readyEntry } from "../../support/writingFixtures";

const PDF = new Uint8Array([37, 80, 68, 70]);
const ENTRY = readyEntry("/lib/cv", { main: "main.typ", settings: { id: "cv", format: "typst", typst: "0.13.0" } }) as Extract<ProjectEntry, { kind: "ready" }>;
const workspace = vscode.workspace as unknown as { textDocuments: unknown[] };
const window = vscode.window as unknown as Record<string, jest.Mock>;

const openDocument = (fsPath: string, text: string) => ({ uri: { scheme: "file", fsPath }, getText: () => text });
const succeeded: TypstHostOutcome = { status: "succeeded", pdf: PDF, problems: [{ severity: "warning", message: "unused", file: "parts/a.typ", line: 2 }], cites: [] };
const failed: TypstHostOutcome = { status: "failed", problems: [{ severity: "error", message: "unknown variable", file: "main.typ", line: 1 }] };

function setup(outcome: TypstHostOutcome | Error = succeeded) {
  const fs = new MemoryLibraryFs();
  const data = fakeProjectData();
  const compile = jest.fn(async (_request: TypstHostRequest) => { if (outcome instanceof Error) { throw outcome; } return outcome; });
  const host = fakeHost();
  const deps = {
    compile, host, projects: { list: () => [ENTRY], fs, paths: posixPathOps, data, reload: jest.fn(async () => undefined) },
    diagnostics: { publish: jest.fn() }, previews: { building: jest.fn(), finished: jest.fn() },
  };
  const preview = typstPreviewPdf(ENTRY, "main.typ", data, posixPathOps);
  return { deps, fs, data, compile, host, preview, builds: new HostPageTypstBuilds(deps) };
}

beforeEach(() => {
  jest.clearAllMocks();
  workspace.textDocuments = [openDocument("/lib/cv/main.typ", "= CV"), openDocument("/lib/cv/parts/a.typ", "x"), openDocument("/elsewhere/b.typ", "y")];
});

describe("HostPageTypstBuilds", () => {
  it("compiles live with the open editors of the project and shows the result in the preview only", async () => {
    const { builds, compile, fs, preview, deps } = setup();
    expect(await builds.request("/lib/cv", "main.typ", "live")).toBeUndefined();
    expect(compile).toHaveBeenCalledWith({ projectId: "cv", main: "main.typ", sources: [{ path: "main.typ", text: "= CV" }, { path: "parts/a.typ", text: "x" }] });
    expect(await fs.readFile(preview)).toEqual(PDF);
    expect(await fs.exists("/lib/cv/main.pdf")).toBe(false);
    expect(deps.previews.finished).toHaveBeenCalledWith(ENTRY, "main.typ",
      { status: "succeeded", pdf: preview, cites: [], problems: [{ severity: "warning", message: "unused", file: "/lib/cv/parts/a.typ", line: 2 }] }, "save");
    expect(deps.diagnostics.publish).not.toHaveBeenCalled();
  });

  it("writes <root>.pdf beside the preview on save, publishes the problems and records the Typst version", async () => {
    const { builds, fs, preview, deps, data } = setup();
    const result = await builds.request("/lib/cv", "main.typ", "save");
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", pdf: preview }));
    expect(await fs.readFile("/lib/cv/main.pdf")).toEqual(PDF);
    expect(await fs.readFile(preview)).toEqual(PDF);
    expect(deps.diagnostics.publish).toHaveBeenCalledWith("/lib/cv/main.typ", [{ severity: "warning", message: "unused", file: "/lib/cv/parts/a.typ", line: 2 }]);
    expect(deps.previews.finished).toHaveBeenCalledWith(ENTRY, "main.typ", result, "save");
    expect(data.updateProjectSettings).toHaveBeenCalledWith("/lib/cv", { typst: expect.any(String) });
  });

  it("leaves the preview alone after a failed live compile but reports a failed save", async () => {
    const { builds, deps, fs, preview } = setup(failed);
    await builds.request("/lib/cv", "main.typ", "live");
    expect(deps.previews.finished).not.toHaveBeenCalled();
    const result = await builds.request("/lib/cv", "main.typ", "save");
    expect(result).toEqual({ status: "failed", problems: [{ severity: "error", message: "unknown variable", file: "/lib/cv/main.typ", line: 1 }] });
    expect(deps.previews.finished).toHaveBeenCalledWith(ENTRY, "main.typ", result, "save");
    expect(await fs.exists(preview)).toBe(false);
  });

  it("compiles one request at a time per project, and a live request already queued for the root covers the next", async () => {
    const { builds, compile } = setup();
    let release: () => void = () => undefined;
    compile.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(succeeded); }));
    const first = builds.request("/lib/cv", "main.typ", "live");
    await new Promise((resolve) => setImmediate(resolve));
    const second = builds.request("/lib/cv", "main.typ", "live");
    const third = builds.request("/lib/cv", "main.typ", "live");
    await new Promise((resolve) => setImmediate(resolve));
    expect(compile).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second, third]);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("logs a compile the page could not run and tells the user only when they asked for the build", async () => {
    const { builds, host } = setup(new Error("command 'labshelf.editorHost.typstCompile' not found"));
    expect(await builds.request("/lib/cv", "main.typ", "save")).toBeUndefined();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(await builds.request("/lib/cv", "main.typ", "command")).toBeUndefined();
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/cv/));
    expect(host.session.logger.error).toHaveBeenCalledTimes(2);
  });
});
