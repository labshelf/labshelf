/** @jest-environment jsdom */
// Tests renderSectionCard labelling and renderMemberChip initials.
import { renderSectionCard, renderMemberChip } from "../../../../../src/ui/dom/index.js";

describe("renderSectionCard", () => {
  it("is a section labelled by its h2", () => {
    const body = document.createElement("p");
    const card = renderSectionCard({ title: "Members", body });
    const h2 = card.querySelector("h2")!;
    expect(card.tagName).toBe("SECTION");
    expect(card.getAttribute("aria-labelledby")).toBe(h2.id);
    expect(card.contains(body)).toBe(true);
  });
});

describe("renderMemberChip", () => {
  it("shows initials and names the member", () => {
    const chip = renderMemberChip("Ada Lovelace Byron");
    expect(chip.textContent).toBe("AL");
    expect(chip.getAttribute("role")).toBe("img");
    expect(chip.getAttribute("aria-label")).toBe("Ada Lovelace Byron");
    expect(chip.title).toBe("Ada Lovelace Byron");
    expect(renderMemberChip("You").textContent).toBe("Y");
  });
});
