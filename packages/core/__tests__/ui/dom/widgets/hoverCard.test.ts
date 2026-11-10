/** @jest-environment jsdom */
import { attachHoverCard } from "../../../../src/ui/dom/widgets/hoverCard.js";
import { renderSourceToolbar } from "../../../../src/writing/dom/sourceEditor/toolbar.js";

const card = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-hover-card:not([hidden])");

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  document.body.replaceChildren();
});

/** Moves the pointer off whatever card is shown and lets the warm window lapse, so each test starts cold. */
function cool(button: HTMLElement): void {
  button.dispatchEvent(new MouseEvent("mouseleave"));
  jest.advanceTimersByTime(1000);
}

describe("attachHoverCard", () => {
  it("shows the name and the description after a short rest, replacing the native title", () => {
    const button = document.body.appendChild(document.createElement("button"));
    button.title = "Bold";
    attachHoverCard(button, () => ({ label: "Bold", description: "Make the selection bold." }));
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("aria-description")).toBe("Make the selection bold.");

    button.dispatchEvent(new MouseEvent("mouseenter"));
    expect(card()).toBeNull();
    jest.advanceTimersByTime(500);
    expect(card()?.textContent).toBe("BoldMake the selection bold.");
    cool(button);
    expect(card()).toBeNull();
  });

  it("hides on a press, so a menu the control opens is not covered", () => {
    const button = document.body.appendChild(document.createElement("button"));
    attachHoverCard(button, () => ({ label: "More actions" }));
    button.dispatchEvent(new MouseEvent("mouseenter"));
    jest.advanceTimersByTime(500);
    expect(card()).not.toBeNull();
    button.dispatchEvent(new Event("pointerdown"));
    expect(card()).toBeNull();
    jest.advanceTimersByTime(1000);
  });
});

describe("source toolbar hover cards", () => {
  it("say what a known control does without the host writing it, and name a dropdown's current option", () => {
    const bar = renderSourceToolbar([[{ label: "Undo", glyph: "bold", run: () => undefined }]], [[{
      label: "Review mode", glyph: "edit", options: [{ value: "editing", label: "Editing", glyph: "edit" }], current: () => "editing", pick: () => undefined,
    }]]);
    document.body.append(bar);
    const undo = bar.querySelector<HTMLElement>("[aria-label='Undo']")!;
    undo.dispatchEvent(new MouseEvent("mouseenter"));
    jest.advanceTimersByTime(500);
    expect(card()?.textContent).toContain("only your own edits");
    cool(undo);

    const mode = bar.querySelector<HTMLElement>("[aria-label='Review mode']")!;
    mode.dispatchEvent(new MouseEvent("mouseenter"));
    jest.advanceTimersByTime(500);
    expect(card()?.querySelector(".ls-hover-card-label")?.textContent).toBe("Review mode: Editing");
    cool(mode);
  });
});
