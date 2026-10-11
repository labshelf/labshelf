// Tests the reader host controller's message handling and error recovery.
import { DEFAULT_READER_PREFS } from "@labshelf/core";
import { setupHost, sidecar } from "./hostFixture";

describe("ReaderHostController", () => {
  it("drops malformed messages with a warning and never touches the sidecar", async () => {
    const { host, ports, posted, files } = setupHost();
    await host.handle({ command: "deleteAnnotation", id: "" });
    await host.handle({ command: "saveReadingState" });
    await host.handle({ command: "nope" });
    await host.handle({ command: "pageChanged", pageNumber: "three" });
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
      data.annotations.push({ id: "c", paperId: "p1", type: "note", pageNumber: 3, content: "from VS Code", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "x" });
      files.p1 = JSON.stringify(data);
      await host.refreshAnnotations();
      expect(posted.at(-1)).toMatchObject({ type: "updateAnnotations" });
      expect((posted.at(-1) as { annotations: unknown[] }).annotations).toHaveLength(3);
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
