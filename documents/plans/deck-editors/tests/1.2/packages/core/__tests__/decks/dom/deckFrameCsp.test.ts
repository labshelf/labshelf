/** @jest-environment jsdom */
/**
 * The deck frame's Content-Security-Policy must let the images it resolves load. The VS Code webview hosts resolve an asset to a
 * https://file+.vscode-resource.vscode-cdn.net URL and pass no assetOrigin, so the frame's img-src (data: blob:) blocks every image in the editing canvas.
 */
import { deckFrameCsp, mountDeckFrame, type DeckFrame } from "../../../src/decks/dom/deckFrame";

const ROOT = 'lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px"';
const deckOf = (...images: string[]): string => `<!doctype html>\n<html ${ROOT}>\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n<section data-slide>\n${images
  .map((src, i) => `<div data-block="b${i}" style="left: 10px; top: ${10 + i * 320}px; width: 400px; height: 300px;"><img src="${src}" alt="Image ${i}"></div>\n`).join("")}</section>\n</body>\n</html>\n`;
const DECK = deckOf("assets/plot.png");
const VSCODE_ORIGIN = "https://file+.vscode-resource.vscode-cdn.net";
const VSCODE_ASSET = `${VSCODE_ORIGIN}/Users/me/talks/a/assets/plot.png`;

const frames: DeckFrame[] = [];
afterEach(() => { while (frames.length) frames.pop()?.destroy(); document.body.replaceChildren(); });

async function srcdocOf(resolve: (path: string) => string, options: { html?: string; assetOrigin?: string } = {}): Promise<Document> {
  const host = document.createElement("div");
  document.body.append(host);
  const frame = mountDeckFrame(host, { html: options.html ?? DECK, theme: "", slide: 0, resolveAsset: (path) => Promise.resolve(resolve(path)), ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) });
  frames.push(frame);
  for (let i = 0; i < 20 && !frame.frame.getAttribute("srcdoc"); i++) await new Promise((r) => setTimeout(r, 0));
  return new DOMParser().parseFromString(frame.frame.getAttribute("srcdoc") ?? "", "text/html");
}

const cspOf = (doc: Document): string => doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";
const directive = (csp: string, name: string): string => csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `) || part === name) ?? "";
const count = (text: string, part: string): number => text.split(part).length - 1;

describe("mountDeckFrame image policy", () => {
  it("A2 lets the frame load an image that the host resolved to a webview resource URL", async () => {
    const doc = await srcdocOf(() => VSCODE_ASSET);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(VSCODE_ASSET);
    expect(directive(cspOf(doc), "img-src")).toContain(VSCODE_ORIGIN);
  });

  it("A2 keeps blob: image URLs of the browser host allowed", async () => {
    const doc = await srcdocOf(() => "blob:chrome-extension://abc/1234");
    expect(directive(cspOf(doc), "img-src").split(/\s+/)).toContain("blob:");
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("blob:chrome-extension://abc/1234");
  });

  it("A2 keeps data: image URLs allowed and unchanged", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const doc = await srcdocOf(() => dataUrl);
    expect(directive(cspOf(doc), "img-src").split(/\s+/)).toContain("data:");
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(dataUrl);
  });

  it("A2 allows the webview origin for fonts and media too", async () => {
    const csp = cspOf(await srcdocOf(() => VSCODE_ASSET));
    expect(directive(csp, "font-src")).toContain(VSCODE_ORIGIN);
    expect(directive(csp, "media-src")).toContain(VSCODE_ORIGIN);
  });

  it("A2 adds the origin of every distinct http(s) asset URL, each once", async () => {
    const urls = ["https://a.example/one.png", "https://a.example/two.png", "http://b.example:8080/three.png"];
    const doc = await srcdocOf((path) => urls[Number(path.match(/(\d)\.png$/)![1])]!, { html: deckOf("assets/0.png", "assets/1.png", "assets/2.png") });
    const imgSrc = directive(cspOf(doc), "img-src");
    expect(count(imgSrc, "https://a.example")).toBe(1);
    expect(imgSrc).toContain("http://b.example:8080");
    expect(imgSrc).not.toContain("one.png");
    expect(Array.from(doc.querySelectorAll("img"), (img) => img.getAttribute("src"))).toEqual(urls);
  });

  it("A2 does not turn blob: or data: URLs into origins", async () => {
    const csp = cspOf(await srcdocOf(() => "blob:https://host.example/uuid"));
    expect(directive(csp, "img-src").split(/\s+/).sort()).toEqual(["blob:", "data:", "img-src"]);
  });

  it("A2 still honours an explicit assetOrigin, listed once beside a resolved origin of the same host", async () => {
    const doc = await srcdocOf(() => VSCODE_ASSET, { assetOrigin: VSCODE_ORIGIN });
    const imgSrc = directive(cspOf(doc), "img-src");
    expect(count(imgSrc, VSCODE_ORIGIN)).toBe(1);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(VSCODE_ASSET);
  });

  it("A2 allows an explicit assetOrigin when the assets resolve to blob: URLs", async () => {
    const doc = await srcdocOf((path) => `blob:test/${path}`, { assetOrigin: "https://assets.example" });
    expect(directive(cspOf(doc), "img-src")).toContain("https://assets.example");
    expect(directive(cspOf(doc), "img-src").split(/\s+/)).toContain("blob:");
  });

  it("A2 never opens default-src: the frame stays closed to scripts and network beyond assets", async () => {
    const csp = cspOf(await srcdocOf(() => VSCODE_ASSET));
    expect(directive(csp, "default-src")).toBe("default-src 'none'");
    expect(csp).not.toMatch(/script-src|connect-src|frame-src/);
  });
});

describe("deckFrameCsp outputs", () => {
  it("A2 gives the policy with an asset origin unchanged", () => {
    expect(deckFrameCsp(VSCODE_ORIGIN)).toBe(
      "default-src 'none'; style-src 'unsafe-inline' https://file+.vscode-resource.vscode-cdn.net; img-src https://file+.vscode-resource.vscode-cdn.net data: blob:; font-src https://file+.vscode-resource.vscode-cdn.net data:",
    );
  });

  it("A2 gives the policy without an asset origin unchanged", () => {
    expect(deckFrameCsp()).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:");
    expect(deckFrameCsp("")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:");
  });
});
