/** @jest-environment jsdom */
/** Spec 4.1d and 4.1e: the Style panel in the HTML deck shell: the Style button, the panel in the properties column, Apply as one change and one undo. */
import { readThemeStyle } from "../../../../src/decks/deckStyleCss";
import { THEME, buttonIn, host, lastChange, openWs, settle, toolbarOf, workspace } from "../shell/html/shellHarness";

const insertButton = (label: string): HTMLButtonElement | null => buttonIn(toolbarOf("Insert"), label);
const props = (): HTMLElement => host.querySelector<HTMLElement>("aside[aria-label='Properties']")!;
const stylePanel = (): HTMLElement | null => host.querySelector<HTMLElement>(".dsh-style");
const applyButton = (): HTMLButtonElement => Array.from(stylePanel()!.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Apply")!;

describe("the Style button of the HTML shell (4.1d)", () => {
  it("4.1d the insert bar has a Style button and no Theme button; the properties have no Theme section", async () => {
    await openWs();
    expect(insertButton("Style")).not.toBeNull();
    expect(insertButton("Theme")).toBeNull();
    expect(Array.from(props().querySelectorAll(".dsh-section-title")).map((t) => t.textContent)).not.toContain("Theme");
  });

  it("4.1d Style shows the panel in place of the properties; Close, Escape and the button again return", async () => {
    await openWs();
    const button = insertButton("Style")!;
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(stylePanel()).not.toBeNull();
    expect(props().hidden).toBe(true);
    expect(stylePanel()!.parentElement).toBe(props().parentElement);
    buttonIn(stylePanel(), "Close")!.click();
    expect(stylePanel()).toBeNull();
    expect(props().hidden).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.click();
    stylePanel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(stylePanel()).toBeNull();
    button.click();
    button.click();
    expect(stylePanel()).toBeNull();
    expect(props().hidden).toBe(false);
  });

  it("4.1d the panel previews the current slide; a slide jsdom cannot rasterise shows swatches with Preview unavailable", async () => {
    // jsdom loads no images: fail them at once instead of after the thumbnail's timeout
    const image = jest.spyOn(window, "Image").mockImplementation(() => {
      const element = document.createElement("img");
      setTimeout(() => element.onerror?.(new Event("error")), 0);
      return element;
    });
    try {
      await openWs();
      insertButton("Style")!.click();
      for (let i = 0; i < 4; i += 1) await settle();
      const cards = Array.from(stylePanel()!.querySelectorAll(".dsh-style-card"));
      expect(cards).toHaveLength(4);
      for (const card of cards) {
        expect(card.querySelectorAll(".dsh-style-swatch")).toHaveLength(5);
        expect(card.textContent).toContain("Preview unavailable");
      }
    } finally { image.mockRestore(); }
  });
});

describe("Apply style in the HTML shell (4.1e)", () => {
  it("4.1e Apply writes the labshelf:style block in one Apply style change and one undo restores the theme exactly", async () => {
    const onChange = await openWs();
    insertButton("Style")!.click();
    const cards = Array.from(stylePanel()!.querySelectorAll<HTMLButtonElement>(".dsh-style-card"));
    cards[1]!.click();
    const diff = stylePanel()!.querySelectorAll(".ls-history-line-added");
    expect(diff.length).toBeGreaterThan(0);
    applyButton().click();
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Apply style");
    expect(change.theme).toContain("/* labshelf:style */");
    expect(readThemeStyle(change.theme).block).not.toBeNull();
    expect(stylePanel()!.querySelector(".dsh-style-card")!.getAttribute("aria-pressed")).toBe("true");
    expect(applyButton().disabled).toBe(true);
    workspace!.undo();
    await settle();
    expect(lastChange(onChange).theme).toBe(THEME);
  });
});
