import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READER_SHELL_BODY } from "@labshelf/core";
import { createInPageChannel } from "@labshelf/core/dom";

jest.mock("webextension-polyfill", () => ({
  runtime: { getURL: (p: string) => `chrome-extension://ext/${p}` },
  extension: { getViews: jest.fn(() => []) },
  tabs: { create: jest.fn(async () => ({})) },
}));

import { createSidecarPort } from "../../../src/storage/records";
import { parseReaderQuery, createReaderUrl, toggleLibraryDetails } from "../../../src/libraryUi/reader/readerTabs";

describe("reader page shell", () => {
  it("embeds exactly the shared skeleton the VS Code shell uses", () => {
    const html = readFileSync(join(__dirname, "../../../src/reader/index.html"), "utf8");
    const body = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("<script type=\"module\"")).trim();
    expect(body).toBe(READER_SHELL_BODY);
  });

  it("does not load base.css, whose box-sizing reset misaligns the pdf.js text layer", () => {
    const html = readFileSync(join(__dirname, "../../../src/reader/index.html"), "utf8");
    expect(html).not.toContain("base.css");
    expect(html.indexOf("pdf_viewer.css")).toBeLessThan(html.indexOf("reader.css"));
  });

  it("links toast.css and lifts the toasts above the reader's bottom bar", () => {
    const html = readFileSync(join(__dirname, "../../../src/reader/index.html"), "utf8");
    const host = readFileSync(join(__dirname, "../../../src/reader/host.css"), "utf8");
    expect(html).toContain('href="../ui/styles/toast.css"');
    expect(host).toContain("--ls-toast-bottom: 54px");
  });
});

describe("sidecarPort", () => {
  it("keeps the sidecar at the library layout's .research/papers/<id>/data.json", async () => {
    const files = new Map<string, Uint8Array>();
    const port = createSidecarPort({
      stat: async (p: string) => (files.has(p) ? { isFile: true, isDirectory: false, mtimeMs: 0, size: 0 } : undefined),
      readFile: async (p: string) => files.get(p)!,
      writeFile: async (p: string, b: Uint8Array) => { files.set(p, b); },
    });
    expect(await port.read("abc")).toBeNull();
    await port.write("abc", "{\"theme\":\"dark\"}");
    expect([...files.keys()]).toEqual([".research/papers/abc/data.json"]);
    expect(await port.read("abc")).toBe("{\"theme\":\"dark\"}");
  });
});

describe("readerTabs", () => {
  it("builds and parses reader URLs", () => {
    expect(createReaderUrl("10.1/x y")).toBe("chrome-extension://ext/reader/index.html?paper=10.1%2Fx+y");
    expect(createReaderUrl("p", 4)).toBe("chrome-extension://ext/reader/index.html?paper=p&page=4");
    expect(createReaderUrl("p", 0)).toBe("chrome-extension://ext/reader/index.html?paper=p");
    expect(parseReaderQuery("?paper=10.1%2Fx+y&page=3")).toEqual({ paperId: "10.1/x y", page: 3 });
    expect(parseReaderQuery("?paper=p&page=abc")).toEqual({ paperId: "p" });
    expect(parseReaderQuery("")).toEqual({ paperId: null });
  });
});

describe("in-page channel", () => {
  it("delivers asynchronously, clones payloads and buffers host messages until the reader listens", async () => {
    const received: unknown[] = [];
    const channel = createInPageChannel((m) => received.push(m));
    const toReader: unknown[] = [];
    channel.send({ type: "scrollToPage", pageNumber: 2 });
    const msg = { command: "ready" as const, totalPages: 1 };
    channel.transport.post(msg);
    expect(received).toHaveLength(0);
    channel.transport.listen((m) => toReader.push(m));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([msg]);
    expect(received[0]).not.toBe(msg);
    expect(toReader).toEqual([{ type: "scrollToPage", pageNumber: 2 }]);
  });
});


describe("reader opens LabShelf Details", () => {
  const browser = require("webextension-polyfill");
  beforeEach(() => jest.clearAllMocks());

  it("reuses an existing library page's Details", async () => {
    const toggle = jest.fn(async () => undefined);
    browser.extension.getViews.mockReturnValue([{ labshelfLibraryDetails: { toggle } }]);
    await toggleLibraryDetails("p1");
    expect(toggle).toHaveBeenCalledWith("p1");
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it("opens the library with this paper and its Details when no library is open", async () => {
    browser.extension.getViews.mockReturnValue([]);
    await toggleLibraryDetails("p /1");
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://ext/libraryPage/index.html?paper=p+%2F1&details=1" });
  });
});
