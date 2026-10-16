// Tests the preview side of the reader host: messages held until ready, build status, and the preview requests.
import { setupHost } from "./hostFixture";

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
    expect(preview.openCitedPaper).toHaveBeenCalledWith("smith-2020");
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
