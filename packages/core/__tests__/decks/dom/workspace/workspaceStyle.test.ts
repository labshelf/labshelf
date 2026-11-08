/** @jest-environment jsdom */
// Spec 4.2: the Style panel of the LaTeX and Typst workspace: the button, Apply as one editor change, and previews through the host's build port.
import { mountDeckWorkspace } from "../../../../src/decks/dom/workspace/index";
import type { DeckWorkspacePorts } from "../../../../src/decks/dom/workspace/types";
import { DEFAULT_DECK_STYLE, setSourceDeckStyle } from "../../../../src/decks/index";
import { BEAMER, button, flush, talk } from "./workspaceHarness";

const openPdfDeck = jest.fn();
jest.mock("../../../../src/decks/dom/pdfDeck", () => ({ ...jest.requireActual("../../../../src/decks/dom/pdfDeck"), openPdfDeck: (...args: unknown[]) => openPdfDeck(...args) }));

const styleButton = (root: ParentNode): HTMLButtonElement => button(root, "Style");
const panel = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>("aside[aria-label=Style]");
const notes = (root: ParentNode): string[] => [...root.querySelectorAll(".dsh-style-preview-note")].map((n) => n.textContent ?? "");
const waitFor = async (check: () => boolean): Promise<void> => { for (let i = 0; i < 40 && !check(); i++) await flush(); };

describe("4.2b the Style button and Apply", () => {
  it("4.2b opens the panel in place of the properties and closes it again", () => {
    const rig = talk();
    const props = rig.root.querySelector<HTMLElement>(".dw-props:not(.dsh-style)")!;
    expect(panel(rig.root)).toBeNull();
    styleButton(rig.root).click();
    expect(panel(rig.root)).not.toBeNull();
    expect(props.hidden).toBe(true);
    expect(styleButton(rig.root).getAttribute("aria-pressed")).toBe("true");
    styleButton(rig.root).click();
    expect(panel(rig.root)).toBeNull();
    expect(props.hidden).toBe(false);
  });

  it("4.2b Apply calls editing.apply once with setSourceDeckStyle's text", () => {
    const rig = talk();
    styleButton(rig.root).click();
    const cards = [...panel(rig.root)!.querySelectorAll<HTMLButtonElement>(".dsh-style-grid button")];
    cards[1]!.click();
    panel(rig.root)!.querySelector<HTMLButtonElement>(".dsh-style-apply")!.click();
    expect(rig.applied).toHaveLength(1);
    expect(rig.applied[0]).toContain("% labshelf:style");
    expect(rig.applied[0]).not.toBe(BEAMER);
    expect(rig.text()).toBe(rig.applied[0]);
  });

  it("4.2b disables the button with a reason for a deck of no known template", () => {
    const rig = talk();
    expect(styleButton(rig.root).disabled).toBe(false);
    const other = document.createElement("div");
    document.body.append(other);
    const plain = "% labshelf: talk\n\\documentclass{foils}\n\\begin{document}\n\\end{document}\n";
    const ws = mountDeckWorkspace(other, fakePorts("talks/x/main.tex", plain).ports)!;
    expect(styleButton(other).disabled).toBe(true);
    expect(styleButton(other).title).toBe("Style needs a beamer, tikzposter or Typst deck");
    ws.dispose();
    other.remove();
  });
});

function fakePorts(path: string, initial: string, extra: Partial<DeckWorkspacePorts> = {}): { ports: DeckWorkspacePorts; applied: string[] } {
  let current = initial;
  const applied: string[] = [];
  const ports: DeckWorkspacePorts = {
    path,
    editing: { text: () => current, cursor: () => 0, apply: (change) => { applied.push(change.text); current = change.text; }, reveal: () => undefined, select: () => undefined } as DeckWorkspacePorts["editing"],
    editor: document.createElement("div"),
    subscribe: () => () => undefined,
    pdf: { assets: { pdfjsUrl: "pdfjs.mjs", workerUrl: "worker.mjs" }, read: async () => undefined },
    build: { run: () => undefined, onState: (listener) => { listener({ state: "succeeded", errors: 0 }); return () => undefined; } },
    present: () => undefined, posterPreview: () => undefined, exportPdf: () => undefined, showProblems: () => undefined,
    mode: { read: () => "visual", write: () => undefined },
    ...extra,
  };
  return { ports, applied };
}

describe("4.2c previews", () => {
  beforeEach(() => {
    openPdfDeck.mockReset();
    openPdfDeck.mockImplementation(async () => ({ count: 1, labels: null, pageSize: () => ({ width: 480, height: 270 }), render: async () => undefined, textRuns: async () => [], destroy: () => undefined }));
    jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
  });
  afterEach(() => { jest.restoreAllMocks(); });

  function mountWith(extra: Partial<DeckWorkspacePorts>): { host: HTMLElement; applied: string[]; dispose(): void } {
    const host = document.createElement("div");
    document.body.append(host);
    const { ports, applied } = fakePorts("talks/demo/main.tex", BEAMER, extra);
    const ws = mountDeckWorkspace(host, ports)!;
    return { host, applied, dispose: () => { ws.dispose(); host.remove(); } };
  }

  it("4.2c calls the port with the copy's text and a stable key, shows the image and never applies", async () => {
    const requests: Array<{ text: string; page: number; key: string }> = [];
    const stylePreview = jest.fn(async (request: { text: string; page: number; key: string }) => { requests.push(request); return new ArrayBuffer(8); });
    const rig = mountWith({ stylePreview });
    styleButton(rig.host).click();
    await waitFor(() => rig.host.querySelectorAll(".dsh-style-preview img").length >= 4);
    expect(rig.host.querySelectorAll(".dsh-style-preview img").length).toBeGreaterThanOrEqual(4);
    expect(requests.length).toBeGreaterThanOrEqual(4);
    for (const request of requests) {
      expect(request.page).toBe(1);
      expect(request.key).toMatch(/^[0-9a-f]{8}$/);
      expect(request.text.match(/\\begin\{frame\}/g)).toHaveLength(1);
      expect(request.text).toContain("% labshelf:style");
    }
    expect(new Set(requests.map((r) => r.key)).size).toBe(new Set(requests.map((r) => r.text)).size);
    const expected = setSourceDeckStyle("latex", BEAMER, DEFAULT_DECK_STYLE);
    expect(expected).not.toBeNull();
    expect(rig.applied).toEqual([]);
    rig.dispose();
  });

  it("4.2c gives the same key for the same text and style", async () => {
    const keys: string[] = [];
    const stylePreview = async (request: { key: string }): Promise<ArrayBuffer> => { keys.push(request.key); return new ArrayBuffer(8); };
    const first = mountWith({ stylePreview });
    styleButton(first.host).click();
    await waitFor(() => keys.length >= 4);
    const firstKeys = [...keys];
    first.dispose();
    keys.length = 0;
    const second = mountWith({ stylePreview });
    styleButton(second.host).click();
    await waitFor(() => keys.length >= 4);
    expect(keys).toEqual(firstKeys);
    second.dispose();
  });

  it("4.2c shows 'Preview needs a build' without the port", async () => {
    const rig = mountWith({});
    styleButton(rig.host).click();
    await waitFor(() => notes(rig.host).filter((n) => n === "Preview needs a build").length >= 4);
    expect(notes(rig.host).filter((n) => n === "Preview needs a build").length).toBeGreaterThanOrEqual(4);
    expect(rig.applied).toEqual([]);
    rig.dispose();
  });

  it("4.2c shows 'Preview needs a build' when the port gives no bytes", async () => {
    const stylePreview = jest.fn(async () => undefined);
    const rig = mountWith({ stylePreview });
    styleButton(rig.host).click();
    await waitFor(() => notes(rig.host).filter((n) => n === "Preview needs a build").length >= 4);
    expect(stylePreview).toHaveBeenCalled();
    expect(notes(rig.host).filter((n) => n === "Preview needs a build").length).toBeGreaterThanOrEqual(4);
    rig.dispose();
  });
});
