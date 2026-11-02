/** @jest-environment jsdom */
// Tests the shared deck viewer: a sandboxed frame holding the deck HTML, Present for talks, Download HTML, and no inline style.
import { mountDeckShareViewer } from "../../../src/share/dom/deckShareViewer.js";

const HTML = "<!doctype html><html><head><title>Deck</title></head><body><section>Olá — slide 1</section><script>window.x = 1;</script></body></html>";

function host(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function frame(root: HTMLElement): HTMLIFrameElement {
  const found = root.querySelector("iframe");
  expect(found).not.toBeNull();
  return found as HTMLIFrameElement;
}

function button(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label);
}

function srcdoc(f: HTMLIFrameElement): string | null {
  return f.getAttribute("srcdoc") ?? (f as unknown as { srcdoc?: string }).srcdoc ?? null;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => { document.body.innerHTML = ""; });

describe("deck share viewer", () => {
  it("10.2a sandboxes the frame with allow-scripts and without allow-same-origin", () => {
    const root = host();
    mountDeckShareViewer(root, { title: "My Great Talk", deck: "talk", html: HTML, download: jest.fn() });
    const tokens = (frame(root).getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean);
    expect(frame(root).hasAttribute("sandbox")).toBe(true);
    expect(tokens).toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
  });

  it("10.2a sets the frame srcdoc to the deck HTML", () => {
    const root = host();
    mountDeckShareViewer(root, { title: "My Great Talk", deck: "talk", html: HTML, download: jest.fn() });
    expect(srcdoc(frame(root))).toBe(HTML);
  });

  it("10.2a sandboxes a poster frame the same way", () => {
    const root = host();
    mountDeckShareViewer(root, { title: "My Poster", deck: "poster", html: HTML, download: jest.fn() });
    const tokens = (frame(root).getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean);
    expect(tokens).toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
    expect(srcdoc(frame(root))).toBe(HTML);
  });

  it("10.2b Present calls requestFullscreen on the frame for a talk", async () => {
    const root = host();
    mountDeckShareViewer(root, { title: "My Great Talk", deck: "talk", html: HTML, download: jest.fn() });
    const f = frame(root);
    const requestFullscreen = jest.fn(() => Promise.resolve());
    (f as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = requestFullscreen;
    const present = button(root, "Present");
    expect(present).toBeDefined();
    present!.click();
    await flush();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("10.2b has no Present button for a poster", () => {
    const root = host();
    mountDeckShareViewer(root, { title: "My Poster", deck: "poster", html: HTML, download: jest.fn() });
    expect(button(root, "Present")).toBeUndefined();
    expect(button(root, "Download HTML")).toBeDefined();
  });

  it("10.2b Download HTML passes the UTF-8 bytes of the deck HTML and the slugged file name", async () => {
    const root = host();
    const download = jest.fn<void, [Uint8Array, string]>();
    mountDeckShareViewer(root, { title: "My Great Talk", deck: "talk", html: HTML, download });
    const save = button(root, "Download HTML");
    expect(save).toBeDefined();
    save!.click();
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
    const [bytes, filename] = download.mock.calls[0]!;
    expect(Buffer.from(bytes).toString("utf8")).toBe(HTML);
    expect(filename).toMatch(/^my-great-talk\.html$/i);
  });

  it("10.2c sets no style= attribute anywhere in the viewer", () => {
    const root = host();
    mountDeckShareViewer(root, { title: "My Great Talk", deck: "talk", html: HTML, download: jest.fn() });
    expect(root.children.length).toBeGreaterThan(0);
    expect(root.querySelectorAll("[style]").length).toBe(0);
  });

  it("10.2c destroy removes the viewer chrome and frame", () => {
    const root = host();
    const viewer = mountDeckShareViewer(root, { title: "My Great Talk", deck: "talk", html: HTML, download: jest.fn() });
    expect(root.querySelector("iframe")).not.toBeNull();
    viewer.destroy();
    expect(root.querySelector("iframe")).toBeNull();
    expect(button(root, "Present")).toBeUndefined();
    expect(button(root, "Download HTML")).toBeUndefined();
    expect(root.textContent ?? "").not.toContain("Shared with LabShelf");
    expect(root.children.length).toBe(0);
  });
});
