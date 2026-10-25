/**
 * @jest-environment jsdom
 */
// Tests that the list header offers Share only for a subfolder, with the link offer on, and not read-only.
import { fakeHost } from "../../../collab/dom/fakeHost";
import { mountForTest, paper } from "../mountHarness";

const folders = [{ name: "ml", path: "papers/ml", children: [] as [] }];
const library = [paper("r", "papers"), paper("x", "papers/ml")];

function setup(offers: { projects: boolean; links: boolean }, readOnly = false) {
  const host = fakeHost({ offers: jest.fn(() => offers) });
  const t = mountForTest({}, {}, { sharing: host, readOnly });
  t.snapshot(library, [], folders);
  const button = (): HTMLElement | null => t.container.querySelector<HTMLElement>("[data-act=share]");
  return { host, t, button };
}

describe("share folder button", () => {
  it("is absent when no link offer, when read-only, and at the library root", () => {
    expect(setup({ projects: false, links: false }).button()).toBeNull();
    const ro = setup({ projects: true, links: true }, true);
    ro.t.lib.store.openFolder("papers/ml");
    expect(ro.button()).toBeNull();
    expect(setup({ projects: true, links: true }).button()).toBeNull();
  });

  it("appears inside a folder and asks the host for that folder on click", () => {
    const { host, t, button } = setup({ projects: false, links: true });
    t.lib.store.openFolder("papers/ml");
    expect(button()?.getAttribute("aria-label")).toBe('Share "ml" as a link');
    button()!.click();
    expect(host.shareableFolder).toHaveBeenCalledWith("papers/ml");
  });
});
