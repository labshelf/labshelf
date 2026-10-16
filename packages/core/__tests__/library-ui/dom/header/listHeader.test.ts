/**
 * @jest-environment jsdom
 */
// Tests the list header's scope title: a name for All papers and status scopes, a path inside a folder.
import { mountForTest, paper } from "../mountHarness";

const folders = [{ name: "A", path: "papers/A", children: [] as [] }];
const library = [paper("r", "papers"), paper("x", "papers/A")];
const crumbs = (t: ReturnType<typeof mountForTest>): HTMLElement => t.container.querySelector<HTMLElement>(".breadcrumb")!;

describe("list header title", () => {
  it("reads All papers in the root folder, with no Library path", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    expect(crumbs(t).textContent).toContain("All papers");
    expect(crumbs(t).textContent).not.toContain("Library");
  });

  it("reads the status label in a status scope, with no path", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.set({ status: "reading" });
    expect(crumbs(t).textContent).toContain("Reading");
    expect(crumbs(t).textContent).not.toContain("Library");
    expect(crumbs(t).textContent).not.toContain("All papers");
  });

  it("reads Library then each folder inside a nested folder", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.openFolder("papers/A");
    expect([...crumbs(t).querySelectorAll(".crumb")].map((c) => c.textContent?.trim())).toEqual(["Library", "A"]);
  });
});
