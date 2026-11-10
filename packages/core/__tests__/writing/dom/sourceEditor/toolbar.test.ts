/** @jest-environment jsdom */
import { renderSourceToolbar, type SourceToolbarButton } from "../../../../src/writing/dom/sourceEditor/toolbar.js";

const button = (label: string, extra: Partial<SourceToolbarButton> = {}): SourceToolbarButton => ({ label, glyph: "bold", run: jest.fn(), ...extra });

const labels = (root: ParentNode, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "");

afterEach(() => document.body.replaceChildren());

describe("renderSourceToolbar", () => {
  it("puts the edge after the right groups and the ⋯ button last", () => {
    const bar = renderSourceToolbar([[button("Bold")]], [[button("Search")], [button("Share", { primary: true })]], { edge: [button("Show PDF Preview")], more: () => [] });
    const children = [...bar.children];
    expect(children.at(-1)?.getAttribute("aria-label")).toBe("More actions");
    expect(children.at(-2)?.querySelector("[aria-label='Show PDF Preview'], [title='Show PDF Preview']")).not.toBeNull();
    expect(children.findIndex((c) => c.classList.contains("source-editor-toolbar-spacer"))).toBe(1);
  });

  it("lists the host's own entries in the ⋯ menu and runs the picked one", () => {
    const onSelect = jest.fn();
    const bar = renderSourceToolbar([[button("Bold")]], [], { more: () => [{ label: "Keyboard Shortcuts", onSelect }] });
    document.body.append(bar);
    bar.querySelector<HTMLButtonElement>(".source-editor-toolbar-more")!.click();
    expect(labels(document.body, ".ls-menu-item")).toContain("Keyboard Shortcuts");
    [...document.body.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((b) => b.textContent?.includes("Keyboard Shortcuts"))!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("draws no ⋯ button when nothing could move into it and the host gives no entries", () => {
    const bar = renderSourceToolbar([], [[button("Share", { primary: true })]]);
    expect(bar.querySelector(".source-editor-toolbar-more")).toBeNull();
  });
});
