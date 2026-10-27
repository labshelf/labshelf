/** Verifies right-pane persistence and active Space context.
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import type { SpaceReadResult, SpaceStore } from "@labshelf/core";
import { createRightPane } from "../../src/libraryUi/details";
import { createLocalStoragePrefs, PREFS_KEY } from "../../src/libraryUi/prefs";
import { createPageShell } from "../../src/libraryUi/editorArea";

function spacesFixture() {
  let listener = (): void => {};
  let name = "Graph theory";
  const store = {
    list: () => [{ state: "ready", space: { id: "graph", name } }] as SpaceReadResult[],
    onChange: (callback: () => void) => { listener = callback; return jest.fn(); },
  } as Pick<SpaceStore, "list" | "onChange">;
  return { store, rename: (value: string) => { name = value; listener(); } };
}

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("swaps Details and Research chat with persisted choice and shared width", () => {
  const prefs = createLocalStoragePrefs();
  prefs.saveDetailPane({ detailWidth: 420 });
  const shell = createPageShell(document.body, prefs);
  shell.details.textContent = "Paper details";
  const pane = createRightPane(shell, spacesFixture().store);
  const buttons = pane.buttons.querySelectorAll("button");
  expect(shell.chat.hidden).toBe(true);
  buttons[1]!.click();
  expect(shell.details.hidden).toBe(true);
  expect(shell.chat.hidden).toBe(false);
  expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true");
  expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).rightPane).toBe("chat");
  prefs.save({ sortKey: "year" });
  const restored = createPageShell(document.body, createLocalStoragePrefs());
  expect(restored.chat.hidden).toBe(false);
  expect(restored.details.hidden).toBe(true);
  expect(restored.chat.parentElement!.style.width).toBe("420px");
  buttons[0]!.click();
  expect(shell.details.hidden).toBe(false);
  expect(shell.details.textContent).toBe("Paper details");
  expect(shell.chat.hidden).toBe(true);
  buttons[0]!.click();
  expect(shell.root.classList.contains("details-collapsed")).toBe(true);
  buttons[1]!.click();
  expect(shell.root.classList.contains("details-collapsed")).toBe(false);
  pane.dispose();
});

it("follows the active Space and its renamed title", () => {
  const fixture = spacesFixture();
  const shell = createPageShell(document.body, createLocalStoragePrefs());
  const pane = createRightPane(shell, fixture.store);
  pane.activateTab("space:graph:overview");
  expect(shell.chat.querySelector(".chat-context-name")!.textContent).toBe("Graph theory");
  fixture.rename("Spectral graphs");
  expect(shell.chat.querySelector(".chat-context-name")!.textContent).toBe("Spectral graphs");
  pane.activateTab("library");
  expect(shell.chat.querySelector(".chat-context-name")!.textContent).toBe("Library");
  pane.dispose();
});
