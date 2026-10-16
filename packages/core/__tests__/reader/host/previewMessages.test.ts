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

  it("hands showBuildProblem and showSource to the preview ports", async () => {
    const { host, ports } = setupHost();
    const preview = { showBuildProblem: jest.fn(async () => undefined), showSource: jest.fn(async () => undefined) };
    Object.assign(ports, { preview });
    await host.handle({ command: "showBuildProblem" });
    await host.handle({ command: "showSource", point: { page: 1, x: 5, y: 6 } });
    expect(preview.showBuildProblem).toHaveBeenCalledTimes(1);
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
    await host.handle({ command: "showBuildProblem" });
    expect(ports.notify).not.toHaveBeenCalled();
    expect(ports.logger.log).toHaveBeenCalledWith("WARN", "reader", "Preview request in a reader that previews nothing", { paperId: "p1", command: "showBuildProblem" });
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
