/** @jest-environment jsdom */
// Tests the reader's Notes tab and text-box layer with the real editor: Run exists only after setCanRunCells(true), pressing Run
// posts a `runCell` command through ctx.host, and showCellState shows a matching state while an unknown request is ignored.
//
// Assumptions about what the spec leaves open: the Run and Cancel controls are <button>s whose text, aria-label or title match
// /run/i and /cancel/i; the NotesTab lists every note with its editor under the default filter; a text box shows its editor after a
// click on the first element inside `.rd-note-layer` (the box) if Run is not visible yet; the layer draws on `#viewer .page` when
// pdf.js fires `textlayerrendered`; NotesTab is built as (host, goToPage, currentPage, eventBus), NoteBoxLayer takes the ctx (`{ host, eventBus }`) which also works as
// a bare host (it has `post`), so either 7.4 constructor shape is served.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { NotesTab } from "../../../src/reader/dom/notesTab";
import { NoteBoxLayer } from "../../../src/reader/dom/noteBoxes";
import type { ReaderNote } from "../../../src/reader/protocol/messages";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const BODY = "Intro\n\n```{python}\n#| label: calc\nprint(1)\n```\n";
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const text = (b: Element) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`;
const button = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(text(b)));
const note: ReaderNote = { id: "n1", anchor: "p2 box 0.1 0.2 0.3 0.4", body: BODY, created: "2026-10-01T00:00:00.000Z", author: "Ana" } as ReaderNote;

type Cell = "running" | "done" | "error" | "cancelled" | "missing-python";
interface Subject { root: HTMLElement; setCanRunCells(on: boolean): void; showCellState(id: string, state: Cell): void; open(): Promise<void>; show(): void }

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
  const runs = () => sent.filter((m) => m["command"] === "runCell");
  return { ctx, host, sent, runs, eventBus };
}

const KINDS: Array<{ name: string; make: () => { subject: Subject; c: ReturnType<typeof makeCtx> } }> = [
  {
    name: "Notes tab",
    make: () => {
      const c = makeCtx();
      document.body.replaceChildren();
      const tab = new NotesTab(c.host as never, jest.fn(), () => 1, c.eventBus as never);
      document.body.append(tab.el);
      const subject: Subject = {
        root: tab.el,
        setCanRunCells: (on) => tab.setCanRunCells(on),
        showCellState: (id, state) => tab.showCellState(id, state),
        show: () => tab.show([note]),
        open: async () => { tab.onShow(); await settle(); },
      };
      return { subject, c };
    },
  },
  {
    name: "text boxes",
    make: () => {
      const c = makeCtx();
      document.body.innerHTML = `<div id="viewer"><div class="page" data-page-number="2"><div class="canvasWrapper"></div><div class="textLayer"></div></div></div>`;
      const layer = new NoteBoxLayer(c.ctx);
      const page = document.querySelector<HTMLElement>(".page")!;
      const subject: Subject = {
        root: page,
        setCanRunCells: (on) => layer.setCanRunCells(on),
        showCellState: (id, state) => layer.showCellState(id, state),
        show: () => { layer.show([note]); c.eventBus.dispatch("textlayerrendered", { pageNumber: 2 }); },
        open: async () => {
          await settle();
          if (!button(page, /run/i)) { (page.querySelector(".rd-note-layer")?.firstElementChild as HTMLElement | null)?.click(); }
          await settle();
        },
      };
      return { subject, c };
    },
  },
];

async function ready(kind: (typeof KINDS)[number], canRun: boolean, order: "flag-first" | "notes-first" = "flag-first") {
  const { subject, c } = kind.make();
  if (order === "flag-first") { subject.setCanRunCells(canRun); subject.show(); } else { subject.show(); subject.setCanRunCells(canRun); }
  await subject.open();
  return { s: subject, c };
}

describe.each(KINDS)("reader $name run cells", (kind) => {
  it(`12.5b shows no Run button in the ${kind.name} when canRunCells is false`, async () => {
    const { s } = await ready(kind, false);
    expect(button(s.root, /run/i)).toBeUndefined();
  });

  it(`12.5b shows no Run button in the ${kind.name} when setCanRunCells was never called`, async () => {
    const { subject, c } = kind.make();
    subject.show();
    await subject.open();
    expect(button(subject.root, /run/i)).toBeUndefined();
    expect(c.runs()).toEqual([]);
  });

  it.each(["flag-first", "notes-first"] as const)(`12.5b shows a Run button in the ${kind.name} once canRunCells is true (%s)`, async (order) => {
    const { s, c } = await ready(kind, true, order);
    expect(button(s.root, /run/i)).toBeDefined();
    expect(c.runs()).toEqual([]);
  });

  it(`12.5b posts a runCell command with the item id, label, code and a request id on Run in the ${kind.name}`, async () => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    expect(c.runs()).toHaveLength(1);
    expect(c.runs()[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc" });
    expect(String(c.runs()[0]!["code"])).toContain("print(1)");
    expect(String(c.runs()[0]!["requestId"]).length).toBeGreaterThan(0);
  });

  it(`12.5b shows Cancel in the ${kind.name} for a matching running state and posts cancelCell with the request id`, async () => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    const requestId = String(c.runs()[0]!["requestId"]);
    s.showCellState(requestId, "running");
    await settle();
    const cancel = button(s.root, /cancel/i);
    expect(cancel).toBeDefined();
    cancel!.click();
    expect(c.sent).toContainEqual({ command: "cancelCell", requestId });
  });

  it.each(["done", "error", "cancelled", "missing-python"] as const)(`12.5b drops the Cancel button in the ${kind.name} on a matching %s state`, async (state) => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    const requestId = String(c.runs()[0]!["requestId"]);
    s.showCellState(requestId, "running");
    await settle();
    expect(button(s.root, /cancel/i)).toBeDefined();
    s.showCellState(requestId, state);
    await settle();
    expect(button(s.root, /cancel/i)).toBeUndefined();
  });

  it(`12.5b mentions Python in the ${kind.name} on a missing-python state`, async () => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    s.showCellState(String(c.runs()[0]!["requestId"]), "missing-python");
    await settle();
    expect(s.root.textContent).toMatch(/python/i);
  });

  it(`12.5b ignores a cellState for an unknown request in the ${kind.name}`, async () => {
    const { s } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    const before = s.root.textContent;
    s.showCellState("someone-else", "running");
    await settle();
    expect(button(s.root, /cancel/i)).toBeUndefined();
    expect(s.root.textContent).toBe(before);
  });
});
