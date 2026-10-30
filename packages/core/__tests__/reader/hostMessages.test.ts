import { exportAnnotations, DEFAULT_READER_PREFS, type HostToWebview, type CitationStyle } from "@labshelf/core";
import { isWebviewMessage as isSendToWebviewMessage } from "../../src/reader/protocol/index";
import { setupHost, sidecar } from "./hostFixture";

const stored = (files: Record<string, string>) => JSON.parse(files.p1!).annotations as Array<Record<string, unknown>>;

describe("reader annotation messages", () => {
  describe("createAnnotation", () => {
    it("stores a highlight, pushes the list and reports the change", async () => {
      const { host, posted, files, changes } = setupHost();
      await host.handle({
        command: "createAnnotation", type: "highlight", pageNumber: 1, content: "quote", color: "green",
        position: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
      });
      expect(stored(files)[0]).toMatchObject({ id: "a1", type: "highlight", color: "green", pageNumber: 1, position: { x: 0.1 } });
      expect(posted).toEqual([{ type: "updateAnnotations", annotations: [expect.objectContaining({ id: "a1" })] }]);
      expect(changes).toEqual([{ kind: "annotationCreated", annotation: expect.objectContaining({ id: "a1", content: "quote" }) }]);
    });

    it("defaults a highlight's colour to yellow", async () => {
      const { host, files } = setupHost();
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 2, content: "q" });
      expect(stored(files)[0]).toMatchObject({ color: "yellow" });
    });

    it("creates a highlight when the reader sends a null position", async () => {
      const { host, files } = setupHost();
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 1, content: "x", position: null });
      expect(stored(files)).toHaveLength(1);
      expect(stored(files)[0]).not.toHaveProperty("position");
    });

    it("logs and reports an invalid annotation without writing, pushing or reporting a change", async () => {
      const { host, files, ports, posted, changes } = setupHost();
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 1, content: "q", color: "purple" as never });
      expect(files.p1).toBeUndefined();
      expect(ports.notify).toHaveBeenCalledWith(expect.stringMatching(/^Failed to create annotation: Invalid annotation color/), "error");
      expect(ports.logger.error).toHaveBeenCalledWith("reader", expect.any(Error), { paperId: "p1", command: "createAnnotation" });
      expect(posted).toHaveLength(0);
      expect(changes).toHaveLength(0);
    });
  });

  describe("updateAnnotation", () => {
    it("updates an annotation the reader was never sent, pushes the list and reports the change", async () => {
      const { host, posted, files, changes, ports } = setupHost();
      const ann = await ports.store.addHighlight("p1", 1, "old", "yellow");
      await host.handle({ command: "updateAnnotation", id: ann.id, content: "edited" });
      expect(stored(files)[0]!.content).toBe("edited");
      expect(posted.at(-1)).toMatchObject({ type: "updateAnnotations" });
      expect(changes).toEqual([{ kind: "annotationUpdated", annotation: expect.objectContaining({ id: ann.id, content: "edited" }) }]);
    });

    it("reports an unknown id as a failed update", async () => {
      const { host, ports, posted, changes } = setupHost();
      await host.handle({ command: "updateAnnotation", id: "missing", content: "x" });
      expect(ports.notify).toHaveBeenCalledWith("Failed to update annotation: Annotation not found: missing", "error");
      expect(posted).toHaveLength(0);
      expect(changes).toHaveLength(0);
    });
  });

  describe("deleteAnnotation", () => {
    it("removes the annotation, pushes the list and reports the deleted id", async () => {
      const { host, posted, files, changes, ports } = setupHost();
      const ann = await ports.store.addHighlight("p1", 1, "to delete", "green");
      await host.handle({ command: "deleteAnnotation", id: ann.id });
      expect(stored(files)).toEqual([]);
      expect(posted).toEqual([{ type: "updateAnnotations", annotations: [] }]);
      expect(changes).toEqual([{ kind: "annotationDeleted", annotationId: ann.id }]);
    });

    it("pushes the list but reports no change for an unknown id", async () => {
      const { host, posted, changes } = setupHost();
      await host.handle({ command: "deleteAnnotation", id: "missing" });
      expect(posted).toEqual([{ type: "updateAnnotations", annotations: [] }]);
      expect(changes).toHaveLength(0);
    });

    it("reports a store failure as a failed delete", async () => {
      const { host, ports, posted } = setupHost();
      (ports.store as unknown as { deleteAnnotation: () => Promise<never> }).deleteAnnotation = async () => { throw new Error("disk full"); };
      await host.handle({ command: "deleteAnnotation", id: "a" });
      expect(ports.notify).toHaveBeenCalledWith("Failed to delete annotation: disk full", "error");
      expect(posted).toHaveLength(0);
    });
  });

  describe("saveReadingState", () => {
    it("saves a normalized reading state without reporting a change, and drops a corrupt one", async () => {
      const { host, files, changes } = setupHost();
      await host.handle({
        command: "saveReadingState",
        state: { page: 3, scaleValue: "1.25", top: 120, sidebar: { open: true, tab: "outline", width: 9999 }, updatedAt: "t" },
      });
      expect(JSON.parse(files.p1!).reading).toMatchObject({ page: 3, scaleValue: "1.25", top: 120, sidebar: { open: true, tab: "outline", width: 480 } });
      await host.handle({ command: "saveReadingState", state: { page: -1 } });
      expect(JSON.parse(files.p1!).reading.page).toBe(3);
      expect(changes).toHaveLength(0);
    });
  });
});

describe("exportAnnotations", () => {
  it("copies the Markdown to the clipboard and confirms", async () => {
    const { ports } = setupHost({ seed: sidecar });
    await exportAnnotations(ports, "clipboard");
    const markdown = ports.writeClipboard.mock.calls[0]![0];
    expect(markdown).toContain("# Efficient Algorithms");
    expect(markdown).toContain("## Page 1");
    expect(markdown).not.toContain("## Page 2");
    expect(markdown).not.toContain("**Note:**");
    expect(ports.notify).toHaveBeenCalledWith("Annotations copied as Markdown", "ok");
    expect(ports.saveAnnotations).not.toHaveBeenCalled();
  });

  it("hands the Markdown to the host's save for a file export, without touching the clipboard", async () => {
    const { ports } = setupHost({ seed: sidecar });
    await exportAnnotations(ports, "file");
    expect(ports.saveAnnotations).toHaveBeenCalledWith(expect.stringContaining("> h"));
    expect(ports.writeClipboard).not.toHaveBeenCalled();
    expect(ports.notify).not.toHaveBeenCalled();
  });
});

describe("reader session messages", () => {
  describe("ready-for-init", () => {
    it("answers with the sidecar's theme, sorted annotations, reading position and prefs", async () => {
      const highlight = (id: string, pageNumber: number, createdAt: string) =>
        ({ id, paperId: "p1", type: "highlight", pageNumber, content: id, color: "blue", createdAt, updatedAt: "x" });
      const seed = JSON.stringify({
        annotations: [highlight("b", 2, "2026-01-02T00:00:00.000Z"), highlight("a", 1, "2026-01-01T00:00:00.000Z")],
        theme: "sepia",
        reading: { page: 5, scaleValue: "page-width", updatedAt: "t" },
      });
      const { host, posted } = setupHost({ seed });
      await host.handle({ command: "ready-for-init" });
      expect(posted).toHaveLength(1);
      const init = posted[0] as Extract<HostToWebview, { type: "init" }>;
      expect(init).toMatchObject({ type: "init", theme: "sepia", effectiveTheme: "sepia", prefs: DEFAULT_READER_PREFS, reading: { page: 5 }, notes: [] });
      expect(init.annotations.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("does not read an old note annotation of the sidecar", async () => {
      const { host, posted } = setupHost({ seed: sidecar });
      await host.handle({ command: "ready-for-init" });
      const init = posted[0] as Extract<HostToWebview, { type: "init" }>;
      expect(init.annotations.map((a) => a.id)).toEqual(["a"]);
      expect(init.notes).toEqual([]);
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
    it("logs the page count", async () => {
      const { host, ports } = setupHost();
      await host.handle({ command: "ready", totalPages: 12 });
      expect(ports.logger.log).toHaveBeenCalledWith("INFO", "reader", "Reader ready", { paperId: "p1", totalPages: 12 });
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

describe("reader share messages", () => {
  it("copies plain text and confirms", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "copyText", text: "[1] A. Author. Title." });
    expect(ports.writeClipboard).toHaveBeenCalledWith("[1] A. Author. Title.");
    expect(ports.notify).toHaveBeenCalledWith("Copied to clipboard", "ok");
  });

  it.each<[CitationStyle, string]>([
    ["pandoc", "> A quoted passage.\n\n[@imai1986, p. 12]"],
    ["latex", "``A quoted passage.'' \\cite[p.~12]{imai1986}"],
    ["author-year", '"A quoted passage." (Imai & Asano, 1986, p. 12)'],
    ["citekey", "A quoted passage. @imai1986"],
  ])("copies a selection with a %s citation read from the current prefs", async (style, expected) => {
    const { host, ports, setPrefs } = setupHost();
    setPrefs({ ...DEFAULT_READER_PREFS, citationStyle: style });
    await host.handle({ command: "copyWithCitation", text: "A quoted\npassage.", pageNumber: 12 });
    expect(ports.writeClipboard).toHaveBeenCalledWith(expected);
    expect(ports.notify).toHaveBeenCalledWith("Copied with citation (@imai1986, p. 12)", "ok");
  });

  it("exports annotations to the clipboard or hands them to the host to save", async () => {
    const { host, ports } = setupHost({ seed: sidecar });
    await host.handle({ command: "exportAnnotations", target: "clipboard" });
    expect(ports.writeClipboard.mock.calls[0]![0]).toContain("# Efficient Algorithms");
    await host.handle({ command: "exportAnnotations", target: "file" });
    expect(ports.saveAnnotations).toHaveBeenCalledWith(expect.stringContaining("## Page 1"));
  });

  it("opens only http(s) and mailto links and warns about the rest", async () => {
    const { host, ports } = setupHost();
    for (const url of ["https://doi.org/10.1137/0215022", "mailto:a@b.org"]) {
      await host.handle({ command: "openExternalLink", url });
    }
    for (const url of ["file:///etc/passwd", "command:workbench.action.terminal.new", "vscode://x/y", "javascript:alert(1)", "not a url"]) {
      await host.handle({ command: "openExternalLink", url });
    }
    expect(ports.openExternal.mock.calls.map((c) => c[0])).toEqual(["https://doi.org/10.1137/0215022", "mailto:a@b.org"]);
    expect(ports.logger.log).toHaveBeenCalledTimes(5);
    expect(ports.logger.log).toHaveBeenCalledWith("WARN", "reader", "Blocked external link with disallowed scheme", { paperId: "p1" });
  });
});

describe("reader citeInProject message", () => {
  it("hands the request to the host port", async () => {
    const { host, ports } = setupHost();
    const citeInProject = jest.fn(async () => undefined);
    (ports as { citeInProject?: typeof citeInProject }).citeInProject = citeInProject;
    await host.handle({ command: "citeInProject", paperId: "p1", page: 4, quote: "A passage." });
    await host.handle({ command: "citeInProject", paperId: "p1" });
    expect(citeInProject.mock.calls).toEqual([[{ paperId: "p1", page: 4, quote: "A passage." }], [{ paperId: "p1" }]]);
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it("tells the user when the host cannot cite", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "citeInProject", paperId: "p1" });
    expect(ports.notify).toHaveBeenCalledWith("Cite in project is not available here", "info");
  });

  it("surfaces a failing port as a Reader action failed notice", async () => {
    const { host, ports } = setupHost();
    (ports as { citeInProject?: () => Promise<void> }).citeInProject = async () => { throw new Error("no project"); };
    await host.handle({ command: "citeInProject", paperId: "p1" });
    expect(ports.notify).toHaveBeenCalledWith("Reader action failed: no project", "error");
  });
});

describe("bodyPages message", () => {
  it("hands the root and its content pages to the preview port", async () => {
    const { host, ports } = setupHost();
    const preview = { bodyPages: jest.fn() };
    Object.assign(ports, { preview });
    await host.handle({ command: "bodyPages", root: "/p/main.tex", contentPages: 7 } as never);
    expect(preview.bodyPages).toHaveBeenCalledWith("/p/main.tex", 7);
  });

  it("does not throw when the preview port has no bodyPages", async () => {
    const { host, ports } = setupHost();
    Object.assign(ports, { preview: { showSource: jest.fn() } });
    await expect(host.handle({ command: "bodyPages", root: "/p/main.tex", contentPages: 7 } as never)).resolves.toBeUndefined();
  });
});


describe("reader sendToNote message", () => {
  it("9.11a hands the paper's cite key, page and text to the sendToNote port", async () => {
    const { host, ports } = setupHost();
    const sendToNote = jest.fn(async (_request: { key: string; page: number; text: string }) => undefined);
    (ports as { sendToNote?: typeof sendToNote }).sendToNote = sendToNote;
    await host.handle({ command: "sendToNote", text: "A passage.", pageNumber: 7 } as never);
    expect(sendToNote.mock.calls).toEqual([[{ key: ports.paper.citeKey, page: 7, text: "A passage." }]]);
  });

  it("9.11a accepts a well-formed sendToNote message in the validator", () => {
    expect(isSendToWebviewMessage({ command: "sendToNote", text: "A passage.", pageNumber: 7 })).toBe(true);
  });

  it("9.11b tells the user Send to is not available when the host has no port", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "sendToNote", text: "A passage.", pageNumber: 7 } as never);
    expect(ports.notify).toHaveBeenCalledWith("Send to is not available here", "info");
  });

  it("9.11b rejects a sendToNote message with an empty text", () => {
    expect(isSendToWebviewMessage({ command: "sendToNote", text: "", pageNumber: 7 })).toBe(false);
  });
});


describe("reader LabShelf Details", () => {
  it("asks the host to reveal Details for the reader's own paper", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "toggleDetails" });
    expect(ports.toggleDetails).toHaveBeenCalledWith("p1");
  });
});
