/**
 * @jest-environment jsdom
 */
// Tests the project panel's linked-folder rows as drawn: the folder path with " › ", the paper count and the button that unlinks.
import { closeMenu } from "../../../src/ui/dom/widgets/menu";
import { createLinkedFolderItems, showProjectPanel } from "../../../src/libraryUi/dom/projectPanel";

describe("createLinkedFolderItems", () => {
  afterEach(() => closeMenu());

  it("draws one row per folder with its count, and its button unlinks that folder without running the row", () => {
    const unlink = jest.fn();
    const items = createLinkedFolderItems([{ folder: "ml/nets", papers: 3 }, { folder: "vision", papers: 1 }], unlink);
    showProjectPanel(document.body, { name: "p", sections: [{ title: "References", items }] });
    const rows = [...document.querySelectorAll(".ls-section-panel-row")];
    expect(rows.map((r) => r.querySelector(".ls-section-panel-item")!.textContent)).toEqual(["ml › nets· 3 papers", "vision· 1 paper"]);
    expect(document.querySelector(".ls-section-panel-title")!.textContent).toBe("References");
    rows[0]!.querySelector<HTMLButtonElement>(".ls-section-panel-action")!.click();
    expect(unlink).toHaveBeenCalledWith("ml/nets");
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it("draws nothing for a project with no linked folder", () => {
    expect(createLinkedFolderItems([], jest.fn())).toEqual([]);
  });
});
