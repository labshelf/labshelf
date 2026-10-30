/** @jest-environment jsdom */
// Tests that the reader's note surfaces (ReaderCellRuns, Notes tab, text boxes, floating editor) post runCell with the language of the cell
// that was run, and a restartCell message for that language from the cell's Restart action.
//
// Assumptions about what the spec leaves open: ReaderCellRuns.option() returns { onRunCell(label, code, language), onRestartCell(language) } while
// the host can run cells (4.1 decided those option names); the Restart control is a <button> whose text, aria-label or title matches /restart/i;
// the Run control matches /run/i; the message is { command: "restartCell", language }.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { ReaderCellRuns } from "../../../src/reader/dom/cellRuns";
import { NotesTab } from "../../../src/reader/dom/notesTab";
import { NoteBoxLayer } from "../../../src/reader/dom/noteBoxes";
import { FloatingNotes } from "../../../src/reader/dom/floatingNotes";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import type { ReaderNote } from "../../../src/reader/protocol/messages";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const LANGUAGES = ["python", "mathematica", "r"] as const;
type Language = (typeof LANGUAGES)[number];
const CODE: Record<Language, string> = { python: "print(1)", mathematica: "1 + 1", r: "x <- 1" };
const body = (language: Language) => `Intro\n\n\`\`\`{${language}}\n#| label: calc\n${CODE[language]}\n\`\`\`\n`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const text = (b: Element) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`;
const button = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(text(b)));
const noteOf = (language: Language, anchor: string): ReaderNote => ({ id: "n1", anchor, body: body(language), created: "2026-10-01T00:00:00.000Z", author: "Ana" } as ReaderNote);

describe("ReaderCellRuns", () => {
  function setup() {
    const sent: Array<Record<string, unknown>> = [];
    const runs = new ReaderCellRuns({ post: (m: Record<string, unknown>) => { sent.push(m); } } as never);
    document.body.replaceChildren();
    const root = document.body.appendChild(document.createElement("div"));
    return { runs, sent, root };
  }
  type Options = { onRunCell?(label: string, code: string, language: string): void; onRestartCell?(language: string): void };

  it.each(LANGUAGES)("4.2a option posts runCell with language %s", (language) => {
    const { runs, sent, root } = setup();
    runs.setCanRun(true);
    (runs.option("n1", root) as Options).onRunCell!("calc", CODE[language], language);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc", code: CODE[language], language });
    expect(String(sent[0]!["requestId"]).length).toBeGreaterThan(0);
  });

  it.each(LANGUAGES)("4.2a option posts restartCell with language %s", (language) => {
    const { runs, sent, root } = setup();
    runs.setCanRun(true);
    (runs.option("n1", root) as Options).onRestartCell!(language);
    expect(sent).toEqual([{ command: "restartCell", language }]);
  });

  it("4.2a option offers neither Run nor Restart while the host cannot run cells", () => {
    const { runs, sent, root } = setup();
    const option = runs.option("n1", root) as Options;
    expect(option.onRunCell).toBeUndefined();
    expect(option.onRestartCell).toBeUndefined();
    expect(sent).toEqual([]);
  });
});

function makeCtx() {
  const sent: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, Array<(e?: unknown) => void>>();
  const post = (m: Record<string, unknown>) => { sent.push(m); };
  const eventBus = {
    on: (name: string, fn: (e?: unknown) => void) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    off: () => undefined,
    dispatch: (name: string, e?: unknown) => (handlers.get(name) ?? []).forEach((fn) => fn(e)),
  };
  const host = { post };
  const ctx = { host, eventBus, post } as never;
  return { ctx, host, sent, eventBus, ofCommand: (command: string) => sent.filter((m) => m["command"] === command) };
}

interface Subject { root: HTMLElement; open(): Promise<void> }
const SURFACES: Array<{ name: string; make: (language: Language) => { subject: Subject; c: ReturnType<typeof makeCtx> } }> = [
  {
    name: "Notes tab",
    make: (language) => {
      const c = makeCtx();
      document.body.replaceChildren();
      const tab = new NotesTab(c.host as never, jest.fn(), () => 1, c.eventBus as never);
      document.body.append(tab.el);
      tab.setCanRunCells(true);
      tab.show([noteOf(language, "p2 box 0.1 0.2 0.3 0.4")]);
      return { c, subject: { root: tab.el, open: async () => { tab.reveal("n1"); await settle(); } } };
    },
  },
  {
    name: "text boxes",
    make: (language) => {
      const c = makeCtx();
      document.body.innerHTML = `<div id="viewer"><div class="page" data-page-number="2"><div class="canvasWrapper"></div><div class="textLayer"></div></div></div>`;
      const layer = new NoteBoxLayer(c.ctx);
      const page = document.querySelector<HTMLElement>(".page")!;
      layer.setCanRunCells(true);
      layer.show([noteOf(language, "p2 box 0.1 0.2 0.3 0.4")]);
      c.eventBus.dispatch("textlayerrendered", { pageNumber: 2 });
      return {
        c,
        subject: {
          root: page,
          open: async () => {
            await settle();
            if (!button(page, /run/i)) { (page.querySelector(".rd-note-layer")?.firstElementChild as HTMLElement | null)?.click(); }
            await settle();
          },
        },
      };
    },
  },
  {
    name: "floating editor",
    make: (language) => {
      const c = makeCtx();
      document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="4"><div class="textLayer"></div></div></div>';
      const rctx = { host: c.host, eventBus: { on: jest.fn() }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 4 } } as unknown as ReaderContext;
      const floating = new FloatingNotes(rctx, jest.fn());
      floating.show([noteOf(language, "p4 point 0.7 0.3")]);
      document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
      floating.setCanRunCells(true);
      return { c, subject: { root: document.body, open: async () => { await settle(); } } };
    },
  },
];

describe.each(SURFACES)("reader $name cell messages", (surface) => {
  it.each(LANGUAGES)(`4.2a ${surface.name} posts runCell with the language of the %s cell`, async (language) => {
    const { subject, c } = surface.make(language);
    await subject.open();
    button(subject.root, /run/i)!.click();
    await settle();
    expect(c.ofCommand("runCell")).toHaveLength(1);
    expect(c.ofCommand("runCell")[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc", language });
    expect(String(c.ofCommand("runCell")[0]!["code"])).toContain(CODE[language]);
  });

  it.each(LANGUAGES)(`4.2a ${surface.name} posts restartCell for the %s cell`, async (language) => {
    const { subject, c } = surface.make(language);
    await subject.open();
    const restart = button(subject.root, /restart/i);
    expect(restart).toBeDefined();
    restart!.click();
    await settle();
    expect(c.ofCommand("restartCell")).toEqual([{ command: "restartCell", language }]);
    expect(c.ofCommand("runCell")).toEqual([]);
  });
});
