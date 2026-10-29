// Tests the reader host controller's message handling and error recovery.
import { DEFAULT_READER_PREFS } from "@labshelf/core";
import { setupHost, sidecar } from "./hostFixture";

describe("ReaderHostController", () => {
  it("drops malformed messages with a warning and never touches the sidecar", async () => {
    const { host, ports, posted, files } = setupHost();
    await host.handle({ command: "deleteAnnotation", id: "" });
    await host.handle({ command: "saveReadingState" });
    await host.handle({ command: "nope" });
    await host.handle({ command: "ready", totalPages: "three" });
    await host.handle("garbage");
    expect(posted).toHaveLength(0);
    expect(files).toEqual({});
    expect(ports.logger.log).toHaveBeenCalledTimes(5);
    expect(ports.logger.log).toHaveBeenCalledWith("WARN", "reader", "Ignored malformed reader message", { paperId: "p1" });
  });

  it("logs a failing handler with its command and turns it into an error notice instead of a rejection", async () => {
    const { host, ports } = setupHost();
    const failure = new Error("IDB closed");
    (ports.store as unknown as { load: () => Promise<never> }).load = async () => { throw failure; };
    await expect(host.handle({ command: "ready-for-init" })).resolves.toBeUndefined();
    expect(ports.logger.error).toHaveBeenCalledWith("reader", failure, { paperId: "p1", command: "ready-for-init" });
    expect(ports.notify).toHaveBeenCalledWith("Reader action failed: IDB closed", "error");
  });

  describe("requestPage", () => {
    it("queues a page asked for before the reader is ready and posts it once ready", async () => {
      const { host, posted } = setupHost();
      host.requestPage(6);
      expect(posted).toHaveLength(0);
      await host.handle({ command: "ready", totalPages: 9 });
      expect(posted).toEqual([{ type: "scrollToPage", pageNumber: 6 }]);
    });

    it("holds the page given at construction until the document is laid out", async () => {
      const { host, posted } = setupHost({ page: 7 });
      await host.handle({ command: "ready", totalPages: 17 });
      expect(posted).toEqual([{ type: "scrollToPage", pageNumber: 7 }]);
    });

    it("posts at once when ready, and only once for a queued page", async () => {
      const { host, posted } = setupHost({ page: 3 });
      await host.handle({ command: "ready", totalPages: 17 });
      await host.handle({ command: "ready", totalPages: 17 });
      host.requestPage(2);
      expect(posted).toEqual([{ type: "scrollToPage", pageNumber: 3 }, { type: "scrollToPage", pageNumber: 2 }]);
    });

    it("ignores pages that are not positive integers", async () => {
      const { host, posted } = setupHost();
      await host.handle({ command: "ready", totalPages: 17 });
      host.requestPage(0);
      host.requestPage(1.5);
      expect(posted).toHaveLength(0);
    });
  });

  describe("auto theme", () => {
    it("follows the host theme while the paper's theme is auto", async () => {
      const { host, posted } = setupHost();
      await host.handle({ command: "ready-for-init" });
      host.onAutoThemeChange("light");
      expect(posted[1]).toEqual({ type: "applyTheme", theme: "auto", effectiveTheme: "light" });
    });

    it("ignores host theme changes while the paper has its own theme", async () => {
      const { host, posted } = setupHost({ seed: sidecar });
      await host.handle({ command: "ready-for-init" });
      host.onAutoThemeChange("light");
      expect(posted).toHaveLength(1);
    });
  });

  it("pushes the host's current preferences on a prefs change", () => {
    const { host, posted, setPrefs } = setupHost();
    setPrefs({ ...DEFAULT_READER_PREFS, vimKeys: true });
    host.onPrefsChange();
    expect(posted).toEqual([{ type: "prefsChanged", prefs: { ...DEFAULT_READER_PREFS, vimKeys: true } }]);
  });

  describe("refreshAnnotations", () => {
    it("pushes the annotations only when they changed since the last push", async () => {
      const { host, posted, files } = setupHost({ seed: sidecar });
      await host.handle({ command: "ready-for-init" });
      await host.handle({ command: "ready", totalPages: 3 });
      await host.refreshAnnotations();
      expect(posted).toHaveLength(1);
      const data = JSON.parse(files.p1!);
      data.annotations.push({ id: "c", paperId: "p1", type: "comment", pageNumber: 3, content: "from VS Code", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "x" });
      files.p1 = JSON.stringify(data);
      await host.refreshAnnotations();
      expect(posted.at(-1)).toMatchObject({ type: "updateAnnotations" });
      expect((posted.at(-1) as { annotations: unknown[] }).annotations).toHaveLength(2);
      await host.refreshAnnotations();
      expect(posted).toHaveLength(2);
    });

    it("does nothing before the reader is ready", async () => {
      const { host, posted } = setupHost({ seed: sidecar });
      await host.refreshAnnotations();
      expect(posted).toHaveLength(0);
    });
  });
});

describe("preview messages", () => {
  it("holds reload, build status and a revealed point until ready, keeping only the latest of each", async () => {
    const { host, posted } = setupHost();
    host.setBuildStatus("building");
    host.reloadDocument();
    host.setBuildStatus("failed", 3);
    host.revealPoint({ page: 2, x: 10, y: 20 });
    expect(posted).toHaveLength(0);
    await host.handle({ command: "ready", totalPages: 4 });
    expect(posted).toEqual([
      { type: "buildStatus", state: "failed", errors: 3 },
      { type: "reloadDocument" },
      { type: "revealPoint", point: { page: 2, x: 10, y: 20 } },
    ]);
  });

  it("posts at once once ready, and reports no errors for a build that did not fail", async () => {
    const { host, posted } = setupHost();
    await host.handle({ command: "ready", totalPages: 4 });
    host.setBuildStatus("succeeded", 5);
    host.reloadDocument();
    expect(posted).toEqual([{ type: "buildStatus", state: "succeeded", errors: 0 }, { type: "reloadDocument" }]);
  });

  it("adds stale and builtAt to the build status only when given", async () => {
    const { host, posted } = setupHost();
    await host.handle({ command: "ready", totalPages: 4 });
    host.setBuildStatus("succeeded", 0, { stale: true, builtAt: 1700 });
    host.setBuildStatus("succeeded", 0, { stale: false });
    host.setBuildStatus("succeeded");
    expect(posted).toEqual([
      { type: "buildStatus", state: "succeeded", errors: 0, stale: true, builtAt: 1700 },
      { type: "buildStatus", state: "succeeded", errors: 0, stale: false },
      { type: "buildStatus", state: "succeeded", errors: 0 },
    ]);
    expect(posted[2]).toStrictEqual({ type: "buildStatus", state: "succeeded", errors: 0 });
  });

  it("names the file to show in a reload only when given one", async () => {
    const { host, posted } = setupHost();
    await host.handle({ command: "ready", totalPages: 4 });
    host.reloadDocument("u");
    host.reloadDocument();
    expect(posted).toEqual([{ type: "reloadDocument", pdfUrl: "u" }, { type: "reloadDocument" }]);
    expect(posted[1]).toStrictEqual({ type: "reloadDocument" });
  });

  it("hands showSource to the preview ports", async () => {
    const { host, ports } = setupHost();
    const preview = { showSource: jest.fn(async () => undefined) };
    Object.assign(ports, { preview });
    await host.handle({ command: "showSource", point: { page: 1, x: 5, y: 6 } });
    expect(preview.showSource).toHaveBeenCalledWith({ page: 1, x: 5, y: 6 });
  });

  it.each([
    [{ point: { page: 1, x: 5 }, quote: "a claim", note: "Cite this" }],
    [{ point: { page: 1, x: 5, y: 6 }, quote: 3, note: "Cite this" }],
    [{ point: { page: 1, x: 5, y: 6 }, quote: "a claim", note: "  " }],
    [{ point: { page: 1, x: 5, y: 6 }, quote: "a claim" }],
  ])("drops a malformed addReviewComment %j before the preview port", async (payload) => {
    const { host, ports } = setupHost();
    const preview = { addReviewComment: jest.fn(async () => undefined) };
    Object.assign(ports, { preview });
    await host.handle({ command: "addReviewComment", ...payload });
    expect(preview.addReviewComment).not.toHaveBeenCalled();
    expect(ports.logger.log).toHaveBeenCalledWith("WARN", "reader", "Ignored malformed reader message", { paperId: "p1" });
  });

  it("hands a review note with its point and quote to the preview port", async () => {
    const { host, ports } = setupHost();
    const preview = { addReviewComment: jest.fn(async () => undefined) };
    Object.assign(ports, { preview });
    await host.handle({ command: "addReviewComment", point: { page: 2, x: 5, y: 6 }, quote: "a claim", note: "Cite this" });
    expect(preview.addReviewComment).toHaveBeenCalledWith({ page: 2, x: 5, y: 6 }, "a claim", "Cite this");
  });

  const query = { area: { page: 1, left: 1, top: 2, right: 3, bottom: 4 }, link: true, dest: "cite.smith2020" };

  it("answers a citation lookup with the preview port's entries under the same request number", async () => {
    const { host, ports, posted } = setupHost();
    const entries = [{ key: "smith2020", paper: { id: "smith-2020", title: "A paper", authors: ["A. Smith"] } }];
    const preview = { lookupCitation: jest.fn(async () => entries), openCitedPaper: jest.fn(async () => undefined) };
    Object.assign(ports, { preview });
    await host.handle({ command: "ready", totalPages: 1 });
    await host.handle({ command: "lookupCitation", request: 7, query });
    await host.handle({ command: "openCitedPaper", paperId: "smith-2020" });
    expect(preview.lookupCitation).toHaveBeenCalledWith(query);
    expect(posted).toContainEqual({ type: "citation", request: 7, entries });
    expect(preview.openCitedPaper).toHaveBeenCalledWith("smith-2020", undefined);
  });

  it("still answers a citation lookup when the port fails or the reader previews nothing", async () => {
    const { host, ports, posted } = setupHost();
    await host.handle({ command: "ready", totalPages: 1 });
    await host.handle({ command: "lookupCitation", request: 1, query });
    Object.assign(ports, { preview: { lookupCitation: jest.fn(async () => { throw new Error("library closed"); }) } });
    await host.handle({ command: "lookupCitation", request: 2, query });
    expect(posted).toContainEqual({ type: "citation", request: 1, entries: [] });
    expect(posted).toContainEqual({ type: "citation", request: 2, entries: [] });
    expect(ports.notify).toHaveBeenCalledWith("Reader action failed: library closed", "error");
  });

  it("logs a preview request in a reader without preview ports instead of failing", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "showSource", point: { page: 1, x: 5, y: 6 } });
    expect(ports.notify).not.toHaveBeenCalled();
    expect(ports.logger.log).toHaveBeenCalledWith("WARN", "reader", "Preview request in a reader that previews nothing", { paperId: "p1", command: "showSource" });
  });

  it("holds showChanges until ready, then posts it at once", async () => {
    const { host, posted } = setupHost();
    const areas = [{ page: 1, left: 1, top: 2, right: 3, bottom: 4 }];
    host.showChanges(areas);
    expect(posted).toHaveLength(0);
    await host.handle({ command: "ready", totalPages: 4 });
    expect(posted).toEqual([{ type: "showChanges", areas }]);
    host.showChanges([]);
    expect(posted[1]).toEqual({ type: "showChanges", areas: [] });
  });
});

describe("preview roots, logs and writing actions", () => {
  const roots = {
    main: "main.typ",
    focused: "ch1.typ",
    shown: "ch1.typ",
    roots: [{ path: "ch1.typ", failed: true, rawLog: true, sourceLinks: true, problems: [{ severity: "error" as const, message: "boom", line: 3 }] }],
  };

  it("holds the build roots and a logs request until ready, then posts them", async () => {
    const { host, posted } = setupHost();
    host.setPreviewRoots(roots);
    host.showLogs("ch1.typ");
    expect(posted).toHaveLength(0);
    await host.handle({ command: "ready", totalPages: 4 });
    expect(posted).toContainEqual({ type: "previewRoots", roots });
    expect(posted).toContainEqual({ type: "showLogs", root: "ch1.typ" });
  });

  it("posts the build roots and a logs request at once when ready", async () => {
    const { host, posted } = setupHost();
    await host.handle({ command: "ready", totalPages: 4 });
    host.setPreviewRoots(roots);
    host.showLogs("main.typ");
    expect(posted).toEqual([{ type: "previewRoots", roots }, { type: "showLogs", root: "main.typ" }]);
  });

  it("hands each writing action to its preview port with its arguments", async () => {
    const { host, ports } = setupHost();
    const preview = { recompile: jest.fn(async () => undefined), revealCursor: jest.fn(async () => undefined), openProblem: jest.fn(async () => undefined), openRawLog: jest.fn(async () => undefined) };
    Object.assign(ports, { preview });
    await host.handle({ command: "recompile" });
    await host.handle({ command: "revealCursor" });
    await host.handle({ command: "openProblem", root: "ch1.typ", index: 2 });
    await host.handle({ command: "openRawLog", root: "ch1.typ" });
    expect(preview.recompile).toHaveBeenCalledTimes(1);
    expect(preview.revealCursor).toHaveBeenCalledTimes(1);
    expect(preview.openProblem).toHaveBeenCalledWith("ch1.typ", 2);
    expect(preview.openRawLog).toHaveBeenCalledWith("ch1.typ");
  });

  it.each([
    [{ command: "recompile" }],
    [{ command: "revealCursor" }],
    [{ command: "openProblem", root: "ch1.typ", index: 2 }],
    [{ command: "openRawLog", root: "ch1.typ" }],
  ])("logs %j in a reader without preview ports instead of failing", async (message) => {
    const { host, ports } = setupHost();
    await expect(host.handle(message)).resolves.toBeUndefined();
    expect(ports.notify).not.toHaveBeenCalled();
    expect(ports.logger.log).toHaveBeenCalledWith("WARN", "reader", "Preview request in a reader that previews nothing", { paperId: "p1", command: message.command });
  });
});

const cases: Array<[string, Record<string, unknown>, unknown[]]> = [
  ["runCommand", { id: "markVersion" }, ["markVersion"]],
  ["setAutoCompile", { mode: "save" }, ["save"]],
  ["setEngine", { engine: "xelatex" }, ["xelatex"]],
  ["setIncludeOnly", { on: false }, [false]],
  ["setHaltOnError", { on: true }, [true]],
  ["setCheckLimits", { limits: { pages: 8, words: null, countUpTo: "end" } }, [{ pages: 8, words: null, countUpTo: "end" }]],
  ["fixCitation", { fix: { kind: "replace", key: "a", replacement: "b", file: "m.tex", line: 2 } }, [{ kind: "replace", key: "a", replacement: "b", file: "m.tex", line: 2 }]],
  ["openSourceLine", { file: "m.tex", line: 9 }, ["m.tex", 9]],
];

describe("preview command messages", () => {
  it.each(cases)("%s calls the port of the same name with its payload", async (command, payload, args) => {
    const { host, ports } = setupHost();
    const port = jest.fn(async () => undefined);
    Object.assign(ports, { preview: { [command]: port } });
    await host.handle({ command, ...payload } as never);
    expect(port).toHaveBeenCalledWith(...args);
  });

  it.each(cases)("%s is ignored when the port lacks the method", async (command, payload) => {
    const { host, ports } = setupHost();
    Object.assign(ports, { preview: { recompile: jest.fn() } });
    await expect(host.handle({ command, ...payload } as never)).resolves.not.toThrow();
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it("openCitedPaper passes the page along, and nothing when none is given", async () => {
    const { host, ports } = setupHost();
    const openCitedPaper = jest.fn(async () => undefined);
    Object.assign(ports, { preview: { openCitedPaper } });
    await host.handle({ command: "openCitedPaper", paperId: "p", page: 4 } as never);
    expect(openCitedPaper).toHaveBeenLastCalledWith("p", 4);
    await host.handle({ command: "openCitedPaper", paperId: "p" } as never);
    expect(openCitedPaper).toHaveBeenLastCalledWith("p", undefined);
  });
});
