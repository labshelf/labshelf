/** @jest-environment jsdom */
// Checks that the reader sidebar opens notes without creating a separate paper-details panel.
import { Sidebar } from "../../../src/reader/dom/sidebar";

it("keeps reader notes in the left sidebar and leaves Details to the host", () => {
  document.body.innerHTML = '<div id="app"><aside id="sidebar"></aside><div id="sidebar-resizer"></div><main id="pdf-shell"></main></div>';
  const panel = () => ({ el: document.createElement("div"), onShow: jest.fn(), onHide: jest.fn() });
  const panels = { thumbnails: panel(), outline: panel(), annotations: panel(), notes: panel() };
  const sidebar = new Sidebar(panels);
  sidebar.select("notes");
  expect(sidebar.state).toMatchObject({ open: true, tab: "notes" });
  expect(panels.notes.onShow).toHaveBeenCalledTimes(1);
  expect(document.querySelector("#sidebar")?.contains(panels.notes.el)).toBe(true);
  expect(document.querySelector(".rd-details")).toBeNull();
  sidebar.toggle();
  expect(panels.notes.onHide).toHaveBeenCalledTimes(1);
});
