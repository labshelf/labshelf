/** @jest-environment jsdom */
import { syncGuide } from "../../../../src/library/syncGuide/index.js";
import { renderSyncGuide } from "../../../../src/ui/dom/syncGuide/index.js";

describe("renderSyncGuide", () => {
  const firstUrl = syncGuide.tools[0]!.url;
  it("renders a section per tool plus the no-cloud and after-setup sections, with three steps per tool", () => {
    const page = renderSyncGuide(syncGuide, { onOpenLink: () => {} });
    expect(page.querySelector("h1")?.textContent).toBe(syncGuide.title);
    expect(page.querySelectorAll("section")).toHaveLength(syncGuide.tools.length + 2);
    expect(page.querySelector(".sync-guide-no-cloud h2")?.textContent).toBe("No cloud? Syncthing");
    expect(page.querySelectorAll(".sync-guide-section ol")[0]!.children).toHaveLength(3);
  });

  it("hands the url to the host instead of navigating", () => {
    const opened: string[] = [];
    const page = renderSyncGuide(syncGuide, { onOpenLink: (url) => opened.push(url) });
    const link = page.querySelector<HTMLAnchorElement>("a.sync-guide-link")!;
    expect(link.getAttribute("href")).toBe(firstUrl);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(opened).toEqual([firstUrl]);
  });
});
