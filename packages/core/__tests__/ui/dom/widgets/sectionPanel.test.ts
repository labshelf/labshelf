/**
 * @jest-environment jsdom
 */
// Tests the rows of a section panel: a note after the label and a button of its own that runs apart from the row.
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { showSectionPanel } from "../../../../src/ui/dom/widgets/sectionPanel";

describe("showSectionPanel rows", () => {
  afterEach(() => closeMenu());

  it("draws the note after the label and runs the row's button without running the row", () => {
    const run = jest.fn();
    const unlink = jest.fn();
    showSectionPanel({ x: 0, y: 0 }, {
      label: "p options",
      sections: [{ title: "References", items: [
        { label: "ml › nets", note: "· 3 papers", run, action: { icon: "close", label: "Unlink ml › nets", run: unlink } },
        { label: "Plain", run },
      ] }],
    });
    const rows = document.querySelectorAll(".ls-section-panel-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector(".ls-section-panel-item")!.textContent).toBe("ml › nets· 3 papers");
    rows[0]!.querySelector<HTMLButtonElement>(".ls-section-panel-action")!.click();
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(document.querySelector(".ls-section-panel")).toBeNull();
  });
});
