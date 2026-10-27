/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins the reader side of the preview channel: what it takes from the library page and what it asks of it.
import type { ILogger } from "@labshelf/core";
import { attachPreviewPage, createPreviewPorts } from "../../src/libraryUi/readerPreview";

const parent = { postMessage: jest.fn() };
Object.defineProperty(window, "parent", { value: parent, configurable: true });

const message = (data: unknown, source: unknown = parent, origin = location.origin): Event =>
  Object.assign(new Event("message"), { data, source, origin });

function host() {
  return { reloadDocument: jest.fn(), setBuildStatus: jest.fn(), setPreviewRoots: jest.fn() };
}

const roots = { main: "main.tex", focused: "main.tex", shown: "main.tex", roots: [{ path: "main.tex", failed: true, rawLog: false, sourceLinks: false, problems: [] }] };

describe("attachPreviewPage", () => {
  it("shows the build roots the parent page sends", () => {
    const h = host();
    attachPreviewPage(h);
    window.dispatchEvent(message({ type: "previewRoots", roots }));
    expect(h.setPreviewRoots).toHaveBeenCalledWith(roots);
  });

  it("ignores roots from another window or origin and malformed roots", () => {
    const h = host();
    attachPreviewPage(h);
    window.dispatchEvent(message({ type: "previewRoots", roots }, window));
    window.dispatchEvent(message({ type: "previewRoots", roots }, parent, "https://evil.example"));
    window.dispatchEvent(message({ type: "previewRoots", roots: { main: "main.tex" } }));
    expect(h.setPreviewRoots).not.toHaveBeenCalled();
  });
});

describe("createPreviewPorts", () => {
  const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

  beforeEach(() => { parent.postMessage.mockClear(); });

  it("asks the parent page to recompile", async () => {
    await createPreviewPorts(logger).recompile();
    expect(parent.postMessage).toHaveBeenCalledWith({ command: "recompile" }, location.origin);
  });

  it("forwards the other requests and answers citation lookups with no entries", async () => {
    const ports = createPreviewPorts(logger);
    await ports.openProblem("main.tex", 2);
    await ports.showSource({ page: 1, x: 2, y: 3 });
    expect(parent.postMessage.mock.calls).toEqual([
      [{ command: "openProblem", root: "main.tex", index: 2 }, location.origin],
      [{ command: "showSource", point: { page: 1, x: 2, y: 3 } }, location.origin],
    ]);
    await ports.runCommand?.("markVersion");
    await ports.setCheckLimits?.({ pages: 8 });
    await ports.setAutoCompile?.("save");
    await ports.setEngine?.("xelatex");
    await ports.setHaltOnError?.(true);
    expect(parent.postMessage.mock.calls.slice(2)).toEqual([
      [{ command: "runCommand", id: "markVersion" }, location.origin],
      [{ command: "setCheckLimits", limits: { pages: 8 } }, location.origin],
      [{ command: "setAutoCompile", mode: "save" }, location.origin],
      [{ command: "setEngine", engine: "xelatex" }, location.origin],
      [{ command: "setHaltOnError", on: true }, location.origin],
    ]);
    await expect(ports.lookupCitation({ area: { page: 1, left: 0, top: 0, right: 1, bottom: 1 }, link: true })).resolves.toEqual([]);
  });
});
