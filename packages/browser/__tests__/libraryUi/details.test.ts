// Checks that reader requests reveal the library's existing Details and focus its tab.
import { attachDetailsReveal } from "../../src/libraryUi/details";
import type { PageShell } from "../../src/libraryUi/editorArea";

jest.mock("webextension-polyfill", () => ({
  tabs: { getCurrent: jest.fn(async () => ({ id: 7, windowId: 2 })), update: jest.fn(async () => undefined) },
  windows: { update: jest.fn(async () => undefined) },
}));

function setup(pane = "chat", collapsed = false, search = "") {
  Object.assign(globalThis, { window: {}, location: { search } });
  const shell = {
    root: { dataset: { rightPane: pane }, classList: { contains: () => collapsed } },
    togglePane: jest.fn(),
  } as unknown as PageShell;
  const select = jest.fn();
  attachDetailsReveal(shell, select);
  return { shell, select };
}

it("selects the reader paper, opens the existing Details pane and focuses the library tab", async () => {
  const { shell, select } = setup();
  await window.labshelfLibraryDetails!.reveal("p1");
  expect(select).toHaveBeenCalledWith("p1");
  expect(shell.togglePane).toHaveBeenCalledWith("details");
  const browser = require("webextension-polyfill");
  expect(browser.tabs.update).toHaveBeenCalledWith(7, { active: true });
  expect(browser.windows.update).toHaveBeenCalledWith(2, { focused: true });
});

it("keeps an already open Details pane open", async () => {
  const { shell } = setup("details");
  await window.labshelfLibraryDetails!.reveal("p2");
  expect(shell.togglePane).not.toHaveBeenCalled();
});

it("opens a collapsed Details pane for a reader deep link", () => {
  const { shell, select } = setup("details", true, "?paper=p3&details=1");
  expect(select).toHaveBeenCalledWith("p3");
  expect(shell.togglePane).toHaveBeenCalledWith("details");
});


it("closes open Details when the reader button is clicked again", async () => {
  const { shell, select } = setup("details");
  await window.labshelfLibraryDetails!.toggle("p2");
  expect(shell.togglePane).toHaveBeenCalledWith("details");
  expect(select).not.toHaveBeenCalled();
});

it("opens collapsed Details for the reader paper", async () => {
  const { shell, select } = setup("details", true);
  await window.labshelfLibraryDetails!.toggle("p2");
  expect(shell.togglePane).toHaveBeenCalledWith("details");
  expect(select).toHaveBeenCalledWith("p2");
});
