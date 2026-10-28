/**
 * Tests catalog filtering, navigation, creation and subscription cleanup.
 * @jest-environment jsdom
 */
import { createLoopbackTransport } from "../../../../src/libraryUi/protocol/index.js";
import type { HostToSpaces, SpacesToHost } from "../../../../src/spaces/spacesProtocol.js";
import type { CatalogRow } from "../../../../src/spaces/spaceViews.js";
import { mountSpacesCatalog } from "../../../../src/spaces/dom/mountSpacesCatalog.js";

const row = (id: string, name: string, purpose: string): CatalogRow => ({
  id, name, purpose, reading: { done: 1, total: 2 }, next: null,
  counts: { papers: 2, projects: 1 }, shared: false,
});

function setup() {
  document.body.replaceChildren();
  const root = document.createElement("main");
  document.body.append(root);
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: SpacesToHost[] = [];
  host.subscribe((message) => posted.push(message));
  const dispose = mountSpacesCatalog(root, ui);
  host.post({ type: "catalog", rows: [row("a", "Thesis", "Reading attention"), row("b", "Biology", "Cells")] });
  return { root, host, posted, dispose };
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  return [...root.querySelectorAll("button")].find((b) => b.textContent === text)!;
}

describe("mountSpacesCatalog", () => {
  it("requests the catalog and keeps search focused while narrowing by purpose and filter", () => {
    const { root, posted } = setup();
    expect(posted).toEqual([{ type: "ready", view: "catalog" }]);
    const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.focus(); input.value = "attention"; input.dispatchEvent(new Event("input"));
    expect(root.querySelectorAll(".catalog-row")).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    button(root, "Shared").click();
    expect(root.querySelectorAll(".catalog-row")).toHaveLength(0);
    expect(root.textContent).toContain("No matching Spaces.");
    button(root, "Personal").click();
    expect(root.querySelectorAll(".catalog-row")).toHaveLength(1);
    input.value = ""; input.dispatchEvent(new Event("input"));
    button(root, "All").click();
    expect(root.querySelectorAll(".catalog-row")).toHaveLength(2);
  });

  it("opens a row, its Papers count and its Projects count with the matching tab", () => {
    const { root, posted } = setup();
    (root.querySelector(".catalog-row") as HTMLElement).click();
    button(root, "2 papers").click();
    button(root, "1 project").click();
    expect(posted.slice(1)).toEqual([
      { type: "openSpace", id: "a", tab: "overview" },
      { type: "openSpace", id: "a", tab: "papers" },
      { type: "openSpace", id: "a", tab: "overview" },
    ]);
  });

  it("asks for a non-empty Space name before posting creation", async () => {
    const { root, posted } = setup();
    button(root, "New Space").click();
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    input.value = " "; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(posted).toHaveLength(1);
    input.value = "  Research  "; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(posted.at(-1)).toEqual({ type: "createSpace", name: "Research" });
  });

});

describe("catalog errors and cleanup", () => {
  it("renders unreadable paths and failures as text without opening broken Spaces", () => {
    const { root, host, posted } = setup();
    host.post({ type: "catalog", rows: [{ ...row("broken", "broken", ""), unreadable: "<bad JSON>" }] });
    expect(root.textContent).toContain("spaces/broken/space.json");
    expect(root.textContent).toContain("<bad JSON>");
    expect(root.querySelector("bad")).toBeNull();
    expect(root.querySelector(".catalog-row button")).toBeNull();
    host.post({ type: "error", action: "Load catalog", message: "Disk unavailable" });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Disk unavailable");
    expect(posted).toHaveLength(1);
  });

  it("stops receiving messages after disposal", () => {
    const { root, host, dispose } = setup();
    dispose();
    host.post({ type: "catalog", rows: [] });
    expect(root.childElementCount).toBe(0);
  });
});

test("cancels Space creation when the catalog is disposed", async () => {
  const { root, dispose, posted } = setup();
  button(root, "New Space").click();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  dispose();
  await Promise.resolve();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(posted).toEqual([{ type: "ready", view: "catalog" }]);
});
