/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins which blob: URLs of the preview frame stay alive while the reader may still be fetching them.
import { createPreviewFrame } from "../../../src/writing/preview";

describe("createPreviewFrame blob URLs", () => {
  let created = 0;
  const revoked: string[] = [];

  beforeEach(() => {
    created = 0;
    revoked.length = 0;
    URL.createObjectURL = () => `blob:test/${++created}`;
    URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  });

  it("revokes a URL only when a third PDF arrives", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    frame.showPdf(new Uint8Array([1]));
    frame.showPdf(new Uint8Array([2]));
    expect(revoked).toEqual([]);
    frame.showPdf(new Uint8Array([3]));
    expect(revoked).toEqual(["blob:test/1"]);
    frame.dispose();
  });

  it("revokes the remaining URLs and removes the iframe on dispose", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    frame.showPdf(new Uint8Array([1]));
    frame.showPdf(new Uint8Array([2]));
    frame.showPdf(new Uint8Array([3]));
    frame.dispose();
    expect(revoked).toEqual(["blob:test/1", "blob:test/2", "blob:test/3"]);
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("createPreviewFrame channel", () => {
  const fromWindow = (source: Window | null, data: unknown): MessageEvent =>
    new MessageEvent("message", { data, origin: location.origin, source });

  it("posts the build roots to the reader page once it loads", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    const post = jest.spyOn(frame.element.contentWindow!, "postMessage");
    const roots = { main: "main.tex", focused: "main.tex", shown: "main.tex", roots: [] };
    frame.setPreviewRoots(roots);
    expect(post).not.toHaveBeenCalled();
    frame.element.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledWith({ type: "previewRoots", roots }, location.origin);
    frame.dispose();
  });

  it("hands valid requests from its reader page to the listener", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    const listener = jest.fn();
    frame.onRequest(listener);
    window.dispatchEvent(fromWindow(frame.element.contentWindow, { command: "recompile" }));
    window.dispatchEvent(fromWindow(frame.element.contentWindow, { command: "openProblem", root: "main.tex" }));
    expect(listener.mock.calls).toEqual([[{ command: "recompile" }]]);
    frame.dispose();
  });

  it("ignores requests from another window and after dispose", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    const other = createPreviewFrame(document.body, { id: "q", title: "Q" });
    const listener = jest.fn();
    frame.onRequest(listener);
    window.dispatchEvent(fromWindow(other.element.contentWindow, { command: "recompile" }));
    window.dispatchEvent(fromWindow(window, { command: "recompile" }));
    const source = frame.element.contentWindow;
    frame.dispose();
    window.dispatchEvent(fromWindow(source, { command: "recompile" }));
    expect(listener).not.toHaveBeenCalled();
    other.dispose();
  });
});

describe("createPreviewFrame loading", () => {
  it("points the iframe at the reader only once it is in the page", () => {
    // A detached iframe's document boots with the light colour scheme whatever the page's theme.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src")!;
    const connectedAtSrc: boolean[] = [];
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      ...descriptor,
      set(this: HTMLIFrameElement, value: string) { connectedAtSrc.push(this.isConnected); descriptor.set!.call(this, value); },
    });
    try {
      const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
      expect(connectedAtSrc).toEqual([true]);
      frame.dispose();
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, "src", descriptor);
    }
  });
});


it("delivers only the latest PDF when builds finish before the frame loads", () => {
  const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
  const post = jest.spyOn(frame.element.contentWindow!, "postMessage");
  const urls = ["blob:one", "blob:two", "blob:three"];
  URL.createObjectURL = jest.fn().mockImplementation(() => urls.shift());
  URL.revokeObjectURL = jest.fn();
  frame.showPdf(new Uint8Array([1]));
  frame.showPdf(new Uint8Array([2]));
  frame.showPdf(new Uint8Array([3]));
  frame.element.dispatchEvent(new Event("load"));
  expect(post.mock.calls).toEqual([[{ type: "reloadDocument", pdfUrl: "blob:three" }, location.origin]]);
  frame.dispose();
});
