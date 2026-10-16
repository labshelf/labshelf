/**
 * @jest-environment jsdom
 */
// Tests the header Export menu: slot shown, three targets posted, button disabled without roots.
import { mountExportMenu } from "../../../../../../src/reader/dom/preview/header/export/index";
import { closeMenu } from "../../../../../../src/ui/dom/index";
import type { PreviewRoots } from "../../../../../../src/reader/index";

const roots = (count: number): PreviewRoots => ({
  main: "main.tex",
  focused: "main.tex",
  shown: "main.tex",
  roots: Array.from({ length: count }, () => ({ path: "main.tex", failed: false, rawLog: false, sourceLinks: true, problems: [] })),
});

function setup() {
  const slot = document.createElement("span");
  slot.hidden = true;
  document.body.append(slot);
  const post = jest.fn();
  const menu = mountExportMenu(slot, { post });
  const button = slot.querySelector("button") as HTMLButtonElement;
  return { slot, post, menu, button };
}

const items = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>(".ls-menu-item"));

afterEach(() => { closeMenu(); document.body.innerHTML = ""; });

describe("mountExportMenu", () => {
  it("shows the slot with an accessible Export button", () => {
    const { slot, button } = setup();
    expect(slot.hidden).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Export");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("lists the three export items", () => {
    const { menu, button } = setup();
    menu.setRoots(roots(1));
    button.click();
    expect(items().map((i) => i.textContent)).toEqual(["Project zip", "arXiv zip", "Open PDF in system viewer"]);
  });

  it.each([["Project zip", "projectZip"], ["arXiv zip", "arxivZip"], ["Open PDF in system viewer", "systemViewer"]])(
    "posts %s as target %s",
    (label, target) => {
      const { menu, button, post } = setup();
      menu.setRoots(roots(1));
      button.click();
      items().find((i) => i.textContent === label)?.click();
      expect(post).toHaveBeenCalledWith({ command: "exportProject", target });
    },
  );

  it("disables the button until roots arrive", () => {
    const { menu, button } = setup();
    expect(button.disabled).toBe(true);
    button.click();
    expect(items()).toHaveLength(0);
    menu.setRoots(roots(1));
    expect(button.disabled).toBe(false);
    menu.setRoots(roots(0));
    expect(button.disabled).toBe(true);
  });
});
