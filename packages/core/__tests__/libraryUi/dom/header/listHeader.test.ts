/**
 * @jest-environment jsdom
 */
// Tests the list header's scope title: a name for the library root, a path inside a folder.
import { mountForTest, paper } from "../mountHarness";

const folders = [{ name: "A", path: "papers/A", children: [] as [] }];
const library = [paper("r", "papers"), paper("x", "papers/A")];
const crumbs = (t: ReturnType<typeof mountForTest>): HTMLElement => t.container.querySelector<HTMLElement>(".breadcrumb")!;

describe("list header title", () => {
  it("reads Library alone in the root folder, the same name its crumb has inside a folder", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    expect(crumbs(t).textContent).toBe("Library");
  });

  it("reads Library then each folder inside a nested folder", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.openFolder("papers/A");
    expect([...crumbs(t).querySelectorAll(".crumb")].map((c) => c.textContent?.trim())).toEqual(["Library", "A"]);
  });
});
