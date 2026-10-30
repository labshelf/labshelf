/** @jest-environment jsdom */
// Checks the shared reader's details toggle and safely rendered bibliographic fields.
import { DetailsPanel } from "../../../src/reader/dom/sidebar";
import type { PaperRecord } from "../../../src/model/index";

it("opens and closes the right panel and renders paper metadata as text", () => {
  document.body.innerHTML = '<div id="app"><main id="pdf-shell"></main></div>';
  const panel = new DetailsPanel("A paper", 10);
  panel.onChange = jest.fn();
  const aside = document.querySelector<HTMLElement>('[aria-label="Paper details"]')!;
  expect(aside.hidden).toBe(true);
  panel.show({ title: "<img src=x>", authors: ["Ada", "Grace"], year: 2026, citeKey: "key", summary: "Abstract text" } as PaperRecord);
  panel.toggle();
  expect(aside.hidden).toBe(false);
  expect(aside.textContent).toContain("Ada, Grace");
  expect(aside.textContent).toContain("Abstract text");
  expect(aside.querySelector("img")).toBeNull();
  aside.querySelector<HTMLButtonElement>('button[title="Close details"]')!.click();
  expect(aside.hidden).toBe(true);
  expect(panel.onChange).toHaveBeenLastCalledWith(false);
});
