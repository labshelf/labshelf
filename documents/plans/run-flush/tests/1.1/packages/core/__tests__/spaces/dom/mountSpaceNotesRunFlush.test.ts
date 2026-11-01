/** @jest-environment jsdom */
// Tests that a param release in a Space note sends the edited body (editSpaceItem) to the host before the normal space.runCell.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { mountSpaceNotes } from "../../../src/spaces/dom/mountSpaceNotes";
import type { SpaceSnapshot } from "../../../src/spaces/dom/mountOverview";
import type { HostToSpaces, SpacesToHost, SpacesTransport } from "../../../src/spaces/spacesProtocol";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CELL = "```{python}\n#| label: calc\n#| param: n = slider(0, 10, 3)\nprint(n)\n```\n";
const PATH = "notes/ideas.qmd";
const item = { id: "i1", body: `Intro\n\n${CELL}`, author: "Ana", created: "2026-10-01T00:00:00.000Z" };

describe("param release in a Space note", () => {
  it("A5 posts the edited body before the normal space.runCell in Space notes", async () => {
    const data = { type: "space", canRunCells: true, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
      overview: { focus: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
    const sent: SpacesToHost[] = [];
    const listeners = new Set<(m: HostToSpaces) => void>();
    const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
    const end: SpacesTransport = {
      post: (m) => {
        sent.push(m);
        const msg = m as unknown as Record<string, unknown>;
        if (msg["type"] === "space.runCell" && msg["preview"]) {
          setTimeout(() => receive({ type: "space.cellPreview", requestId: msg["requestId"], result: { status: "ok", language: "python", text: "7", durationMs: 5 } }), 20);
        }
      },
      subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    };
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const body = mountSpaceNotes(root, { data, end, readOnly: false });
    receive({ type: "spaceNotes", spaceId: "s", notes: [{ path: PATH, title: "Ideas", updated: "2026-10-01" }] });
    receive({ type: "spaceQmd", spaceId: "s", path: PATH, items: [item] });
    await wait(60);
    if (!root.querySelector('input[type="range"]')) {
      [...root.querySelectorAll("button")].find((b) => /ideas/i.test(b.textContent ?? ""))?.click();
      receive({ type: "spaceQmd", spaceId: "s", path: PATH, items: [item] });
      await wait(100);
    }
    const range = root.querySelector<HTMLInputElement>('input[type="range"]')!;
    range.value = "7";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(600);
    const all = sent as unknown as Array<Record<string, unknown>>;
    const edit = all.findIndex((m) => m["type"] === "editSpaceItem" && String(m["body"]).includes("slider(0, 10, 7)"));
    const run = all.findIndex((m) => m["type"] === "space.runCell" && !m["preview"]);
    expect(run).toBeGreaterThanOrEqual(0);
    expect(all[run]).toMatchObject({ path: PATH, itemId: "i1", label: "calc", params: { n: 7 } });
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeLessThan(run);
    expect(all[edit]).toMatchObject({ spaceId: "s", path: PATH, id: "i1" });
    body.dispose();
  });
});
