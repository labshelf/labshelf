/** The sidebar's Citation map row opens the view when clicked. */
import { citationMapEntry } from "../../../src/library-page/sidebar/citationMapEntry";

afterEach(() => { delete (globalThis as { document?: unknown }).document; });

it("builds a button labelled Citation map that calls the opener on click", () => {
  const listeners: Record<string, () => void> = {};
  const button = { type: "", className: "", title: "", innerHTML: "", addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; } };
  (globalThis as { document?: unknown }).document = { createElement: () => button };
  const open = jest.fn();

  const entry = citationMapEntry(open);

  expect(entry).toBe(button);
  expect(button.type).toBe("button");
  expect(button.innerHTML).toContain("Citation map");
  expect(open).not.toHaveBeenCalled();
  listeners["click"]!();
  expect(open).toHaveBeenCalledTimes(1);
});
