/**
 * @jest-environment jsdom
 */
import { confirmFindBetterPdf, findPdf } from "../../../../src/library-ui/dom/flows";
import type { UiContext } from "../../../../src/library-ui/dom/uiContext";
import type { UiToHost } from "@labshelf/core";
import { mountForTest, paper } from "../mountHarness";

function setup(annotations = 0, version: "preprint" | "published" | undefined = "preprint") {
  const t = mountForTest({}, { findPdf: true });
  t.snapshot([paper("a", "papers", { title: "Alpha", ...(version ? { pdfVersion: version } : {}) })], ["papers/a"], [], { a: { annotations } });
  const posted: UiToHost[] = [];
  const ctx = {
    store: t.lib.store, caps: { findPdf: true }, transport: { post: (m: UiToHost) => posted.push(m) },
  } as unknown as UiContext;
  return { ctx, posted };
}

const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")].find((b) => b.textContent === label)!;

describe("confirmFindBetterPdf", () => {
  it("posts a replacing search once confirmed", async () => {
    const { ctx, posted } = setup();
    const done = confirmFindBetterPdf(ctx, "a");
    button("Find and Replace").click();
    await done;
    expect(posted).toEqual([{ type: "paper.findPdf", id: "a", replace: true }]);
  });

  it("posts nothing when cancelled", async () => {
    const { ctx, posted } = setup();
    const done = confirmFindBetterPdf(ctx, "a");
    button("Cancel").click();
    await done;
    expect(posted).toEqual([]);
  });

  it("warns about highlights only when the paper has annotations", async () => {
    const marked = setup(3);
    const first = confirmFindBetterPdf(marked.ctx, "a");
    expect(document.querySelector(".ls-dialog-msg")?.textContent).toContain("3 highlights or notes");
    button("Cancel").click();
    await first;
    const clean = setup(0);
    const second = confirmFindBetterPdf(clean.ctx, "a");
    expect(document.querySelector(".ls-dialog-msg")?.textContent).not.toContain("highlight");
    button("Cancel").click();
    await second;
  });

  it("does nothing for a published PDF or an unknown paper", async () => {
    const { ctx, posted } = setup(0, "published");
    await confirmFindBetterPdf(ctx, "a");
    await confirmFindBetterPdf(ctx, "missing");
    expect(document.querySelector(".ls-dialog")).toBeNull();
    expect(posted).toEqual([]);
  });
});

describe("findPdf", () => {
  it("posts without replace by default", () => {
    const { ctx, posted } = setup();
    findPdf(ctx, "a");
    expect(posted).toEqual([{ type: "paper.findPdf", id: "a" }]);
  });
});
