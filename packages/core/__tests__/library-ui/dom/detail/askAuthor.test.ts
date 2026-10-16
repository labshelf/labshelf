/**
 * @jest-environment jsdom
 */
// The detail pane offers Ask the author for a paper without a PDF, and shows when the authors were asked.
import { mountForTest, paper } from "../mountHarness";

const REQUESTED = "PDF requested from the author on Oct 15, 2026";

function show(caps: Parameters<typeof mountForTest>[1], pdf: boolean, extra = {}) {
  const t = mountForTest({}, caps);
  t.snapshot([paper("a", "papers", { title: "Alpha", ...extra })], pdf ? ["papers/a"] : []);
  t.host.post({ type: "select", id: "a" });
  return t;
}
const askButton = (t: ReturnType<typeof show>) => t.detail().querySelector<HTMLButtonElement>('[data-action="askAuthor"]');

describe("Ask the author in the detail pane", () => {
  it("offers the button to a host that can, and posts paper.askAuthor", () => {
    const t = show({ findPdf: true, askAuthor: true }, false);
    expect(askButton(t)?.textContent).toBe("Ask the author");
    askButton(t)!.click();
    expect(t.sent.at(-1)).toEqual({ type: "paper.askAuthor", id: "a" });
  });

  it("offers no button without the capability", () => {
    expect(askButton(show({ findPdf: true }, false))).toBeNull();
  });

  it("offers no button once the paper has a PDF", () => {
    expect(askButton(show({ askAuthor: true }, true))).toBeNull();
  });
});

describe("PDF requested line", () => {
  it("shows the day for a paper without a PDF, with or without the capability", () => {
    expect(show({ askAuthor: true }, false, { pdfRequestedAt: "2026-10-15" }).detail().textContent).toContain(REQUESTED);
    expect(show({}, false, { pdfRequestedAt: "2026-10-15" }).detail().textContent).toContain(REQUESTED);
  });

  it("is absent for a paper with a PDF or never requested", () => {
    expect(show({ askAuthor: true }, true, { pdfRequestedAt: "2026-10-15" }).detail().textContent).not.toContain("PDF requested");
    expect(show({ askAuthor: true }, false).detail().textContent).not.toContain("PDF requested");
  });
});
