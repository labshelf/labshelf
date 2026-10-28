/** @jest-environment jsdom */
// Tests the paper detail pane's notes with the real editor: Run exists only when the host says canRunCells, pressing Run sends
// paper.runCell, and a matching paper.cellState is shown while an unknown request is ignored.
//
// Assumptions about the DOM, since the spec fixes none: the Run and Cancel controls are <button>s whose text, aria-label or title
// matches /run/i and /cancel/i; a cell is a ```{python} fence with a `#| label:` line; the Notes tab is chosen by the `detailTab` pref;
// canRunCells is set on the `details` message and also in its `details` payload (both are sent, either placement works).
import { TextEncoder as NodeTextEncoder } from "node:util";
import { ALL_CAPABILITIES, mountForTest, paper } from "./mountHarness";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const BODY = "Intro\n\n```{python}\n#| label: calc\nprint(1)\n```\n";
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const text = (b: Element) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`;
const button = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(text(b)));

async function open(canRunCells: boolean) {
  const t = mountForTest({ detailTab: "notes" }, ALL_CAPABILITIES);
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.host.post({ type: "select", id: "a" });
  const notes = [{ id: "n1", anchor: "", body: BODY, created: "2026-10-01T00:00:00.000Z", author: "Ana" }];
  const details = { annotations: [], reading: null, pdf: null, notes, ...(canRunCells ? { canRunCells } : {}) };
  t.host.post({ type: "details", id: "a", details, ...(canRunCells ? { canRunCells } : {}) } as never);
  await settle();
  return t;
}
const runs = (t: Awaited<ReturnType<typeof open>>) => t.sent.filter((m) => m.type === ("paper.runCell" as string)) as unknown as Array<Record<string, string>>;

describe("paper notes run cells", () => {
  it("12.5b shows no Run button when the host does not say canRunCells", async () => {
    const t = await open(false);
    expect(button(t.detail(), /run/i)).toBeUndefined();
  });

  it("12.5b shows a Run button when the host says canRunCells", async () => {
    const t = await open(true);
    expect(button(t.detail(), /run/i)).toBeDefined();
  });

  it("12.5b runs nothing on opening the note", async () => {
    const t = await open(true);
    expect(runs(t)).toEqual([]);
  });

  it("12.5b sends paper.runCell with the paper id, item id, label, code and a request id on Run", async () => {
    const t = await open(true);
    button(t.detail(), /run/i)!.click();
    await settle();
    expect(runs(t)).toHaveLength(1);
    expect(runs(t)[0]).toMatchObject({ type: "paper.runCell", id: "a", itemId: "n1", label: "calc" });
    expect(runs(t)[0]!["code"]).toContain("print(1)");
    expect(runs(t)[0]!["requestId"].length).toBeGreaterThan(0);
  });

  it("12.5b shows Cancel for a matching running state and sends paper.cancelCell with the request id", async () => {
    const t = await open(true);
    button(t.detail(), /run/i)!.click();
    await settle();
    const requestId = runs(t)[0]!["requestId"];
    t.host.post({ type: "paper.cellState", requestId, state: "running" } as never);
    await settle();
    const cancel = button(t.detail(), /cancel/i);
    expect(cancel).toBeDefined();
    cancel!.click();
    expect(t.sent).toContainEqual({ type: "paper.cancelCell", requestId });
  });

  it.each(["done", "error", "cancelled", "missing-python"])("12.5b drops the Cancel button on a matching %s state", async (state) => {
    const t = await open(true);
    button(t.detail(), /run/i)!.click();
    await settle();
    const requestId = runs(t)[0]!["requestId"];
    t.host.post({ type: "paper.cellState", requestId, state: "running" } as never);
    await settle();
    t.host.post({ type: "paper.cellState", requestId, state } as never);
    await settle();
    expect(button(t.detail(), /cancel/i)).toBeUndefined();
  });

  it("12.5b explains the missing Python on a missing-python state", async () => {
    const t = await open(true);
    button(t.detail(), /run/i)!.click();
    await settle();
    t.host.post({ type: "paper.cellState", requestId: runs(t)[0]!["requestId"], state: "missing-python" } as never);
    await settle();
    expect(t.detail().textContent).toMatch(/python/i);
  });

  it("12.5b ignores a cellState for an unknown request", async () => {
    const t = await open(true);
    button(t.detail(), /run/i)!.click();
    await settle();
    const before = t.detail().textContent;
    t.host.post({ type: "paper.cellState", requestId: "someone-else", state: "running" } as never);
    await settle();
    expect(button(t.detail(), /cancel/i)).toBeUndefined();
    expect(t.detail().textContent).toBe(before);
  });
});
