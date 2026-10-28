/** @jest-environment jsdom */
/**
 * Tests the titled icon button shared by the sidebar head and the preview footer.
 */
import { headButton } from "../../../src/ui/dom/headButton";
import { renderIcon } from "../../../src/ui/icons/index";

describe("headButton", () => {
  it("renders a typed button with class, title, aria-label and the glyph, and calls onClick", () => {
    const onClick = jest.fn();
    const button = headButton("ls-icon-btn", "LabShelf settings", "gear", onClick);
    expect(button.tagName).toBe("BUTTON");
    expect(button.className).toBe("ls-icon-btn");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.title).toBe("LabShelf settings");
    expect(button.getAttribute("aria-label")).toBe("LabShelf settings");
    const icon = document.createElement("span");
    icon.innerHTML = renderIcon("gear");
    expect(button.innerHTML).toBe(icon.innerHTML);
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
