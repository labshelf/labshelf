import { DEFAULT_READER_PREFS, type HostToWebview } from "@labshelf/core";
import { setupHost, sidecar } from "./hostFixture";

describe("reader session messages", () => {
  describe("ready-for-init", () => {
    it("answers with the sidecar's theme, sorted annotations, reading position and prefs", async () => {
      const { host, posted } = setupHost({ seed: sidecar });
      await host.handle({ command: "ready-for-init" });
      expect(posted).toHaveLength(1);
      const init = posted[0] as Extract<HostToWebview, { type: "init" }>;
      expect(init).toMatchObject({ type: "init", theme: "sepia", effectiveTheme: "sepia", prefs: DEFAULT_READER_PREFS, reading: { page: 5 } });
      expect(init.annotations.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("resolves an auto theme through the host and sends reading: null for a paper never opened", async () => {
      const { host, posted } = setupHost();
      await host.handle({ command: "ready-for-init" });
      expect(posted[0]).toMatchObject({ theme: "auto", effectiveTheme: "dark", reading: null, annotations: [] });
    });

    it("reads the sidecar once", async () => {
      const { host, ports } = setupHost({ seed: sidecar });
      const load = jest.spyOn(ports.store, "load");
      await host.handle({ command: "ready-for-init" });
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe("ready", () => {
    it("logs the page count and reports the open to the activity port", async () => {
      const { host, ports } = setupHost();
      await host.handle({ command: "ready", totalPages: 12 });
      expect(ports.logger.log).toHaveBeenCalledWith("INFO", "reader", "Reader ready", { paperId: "p1", totalPages: 12 });
      expect(ports.activity.opened).toHaveBeenCalledTimes(1);
    });
  });

  it("logs the open timeline with the host's elapsed time", async () => {
    const { host, ports, advanceClock } = setupHost();
    advanceClock(750);
    await host.handle({ command: "perf", timeline: { scriptStart: 1 }, pageNumber: 1, theme: "dark", dpr: 2, canvas: "10x10" });
    expect(ports.logger.log).toHaveBeenCalledWith("INFO", "reader", "PDF open timeline", {
      paperId: "p1", hostMs: 750, timeline: { scriptStart: 1 }, theme: "dark", dpr: 2, canvas: "10x10",
    });
  });

  it("reports page changes to the activity port", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "pageChanged", pageNumber: 9 });
    expect(ports.activity.pageChanged).toHaveBeenCalledWith(9);
  });

  it("accepts zoomChanged without doing anything", async () => {
    const { host, posted, files, ports } = setupHost();
    await host.handle({ command: "zoomChanged", zoomLevel: 1.5 });
    expect(posted).toHaveLength(0);
    expect(files).toEqual({});
    expect(ports.notify).not.toHaveBeenCalled();
  });

  describe("selectTheme", () => {
    it("persists the theme, applies it and reports a theme change", async () => {
      const { host, posted, files, changes } = setupHost();
      await host.handle({ command: "selectTheme", theme: "high-contrast" });
      expect(JSON.parse(files.p1!).theme).toBe("high-contrast");
      expect(posted).toEqual([{ type: "applyTheme", theme: "high-contrast", effectiveTheme: "high-contrast" }]);
      expect(changes).toEqual([{ kind: "theme" }]);
    });

    it("resolves a chosen auto theme through the host and then follows host changes", async () => {
      const { host, posted } = setupHost({ seed: sidecar });
      await host.handle({ command: "ready-for-init" });
      await host.handle({ command: "selectTheme", theme: "auto" });
      host.onAutoThemeChange("light");
      expect(posted.slice(1)).toEqual([
        { type: "applyTheme", theme: "auto", effectiveTheme: "dark" },
        { type: "applyTheme", theme: "auto", effectiveTheme: "light" },
      ]);
    });

    it("ignores an unknown theme", async () => {
      const { host, posted, files, changes } = setupHost();
      await host.handle({ command: "selectTheme", theme: "neon" });
      expect(posted).toHaveLength(0);
      expect(files).toEqual({});
      expect(changes).toHaveLength(0);
    });
  });
});
