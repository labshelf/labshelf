/**
 * @jest-environment jsdom
 */
// Tests the PDF flows' dialogs: Find a better PDF, access pages and the Ask the author choice.
import { askFindBetterPdf, findPdf } from "../../../../src/libraryUi/dom/flows";
import type { UiContext } from "../../../../src/libraryUi/dom/uiContext";
import type { UiToHost } from "@labshelf/core";
import { mountForTest, paper } from "../mountHarness";
import { askNoPdf } from "../../../../src/libraryUi/dom/flows/pdfFlows";
import type { PdfMiss } from "../../../../src/libraryUi/protocol";

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
    const done = askFindBetterPdf(ctx, "a");
    button("Find and Replace").click();
    await done;
    expect(posted).toEqual([{ type: "paper.findPdf", id: "a", replace: true }]);
  });

  it("posts nothing when cancelled", async () => {
    const { ctx, posted } = setup();
    const done = askFindBetterPdf(ctx, "a");
    button("Cancel").click();
    await done;
    expect(posted).toEqual([]);
  });

  it("warns about highlights only when the paper has annotations", async () => {
    const marked = setup(3);
    const first = askFindBetterPdf(marked.ctx, "a");
    expect(document.querySelector(".ls-dialog-msg")?.textContent).toContain("3 highlights or notes");
    button("Cancel").click();
    await first;
    const clean = setup(0);
    const second = askFindBetterPdf(clean.ctx, "a");
    expect(document.querySelector(".ls-dialog-msg")?.textContent).not.toContain("highlight");
    button("Cancel").click();
    await second;
  });

  it("does nothing for a published PDF or an unknown paper", async () => {
    const { ctx, posted } = setup(0, "published");
    await askFindBetterPdf(ctx, "a");
    await askFindBetterPdf(ctx, "missing");
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

const ACCESS = { kind: "login" as const, url: "https://publisher.example/doi/pdf/10.1/x" };
const miss = (over: Partial<PdfMiss> = {}): PdfMiss => ({ tried: 2, sources: ["publisher"], blocked: false, needsLogin: true, ...over });
const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")];
const press = (label: string): void => buttons().find((b) => b.textContent === label)!.click();

describe("the No PDF found dialog after Find PDF", () => {
  it("opens the page that asked for a sign-in, through the host", async () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { title: "Alpha" })]);
    t.host.post({ type: "pdf.findResult", id: "a", miss: miss({ access: ACCESS }) });
    await Promise.resolve();
    expect(document.querySelector(".ls-dialog-msg")?.textContent).toContain("sign in there");
    press("Open to sign in");
    await Promise.resolve();
    expect(t.sent.at(-1)).toEqual({ type: "paper.openForPdf", id: "a", access: ACCESS });
  });

  it("offers no open button when nothing stood in the way", async () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers")]);
    t.host.post({ type: "pdf.findResult", id: "a", miss: miss({ needsLogin: false }) });
    await Promise.resolve();
    expect(buttons().map((b) => b.textContent)).toEqual(["Cancel", "Attach PDF…", "Search again"]);
  });
});

describe("askNoPdf", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("answers open for a bot check the user can pass, with that button primary", async () => {
    const answer = askNoPdf("X", miss({ blocked: true, access: { kind: "bot", url: ACCESS.url } }));
    const open = buttons().find((b) => b.textContent === "Open to pass the check")!;
    expect(open.classList.contains("ls-btn-primary")).toBe(true);
    open.click();
    expect(await answer).toBe("open");
  });

  it("keeps Save without PDF primary when there is nothing to open", async () => {
    const answer = askNoPdf("X", miss({ needsLogin: false }));
    expect(buttons().find((b) => b.classList.contains("ls-btn-primary"))?.textContent).toBe("Save without PDF");
    press("Save without PDF");
    expect(await answer).toBe("save");
  });
});

const missAskAuthorDialogs: PdfMiss = { tried: 2, sources: ["publisher"], blocked: false, needsLogin: false };


const labels = (): Array<string | null> => buttons().map((b) => b.textContent);

describe("askNoPdf", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("resolves author when the user asks the author", async () => {
    const answer = askNoPdf("X", missAskAuthorDialogs);
    press("Ask the author");
    expect(await answer).toBe("author");
  });
});

describe("Find PDF miss dialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  async function findMiss(caps: Parameters<typeof mountForTest>[1]) {
    const t = mountForTest({}, caps);
    t.snapshot([paper("a", "papers")]);
    t.host.post({ type: "pdf.findResult", id: "a", miss: missAskAuthorDialogs });
    await Promise.resolve();
    return t;
  }

  it("offers Ask the author only to a host that can, and posts paper.askAuthor", async () => {
    const t = await findMiss({ askAuthor: true });
    expect(labels()).toContain("Ask the author");
    press("Ask the author");
    await Promise.resolve();
    expect(t.sent.at(-1)).toEqual({ type: "paper.askAuthor", id: "a" });
  });

  it("omits it without the capability", async () => {
    await findMiss({});
    expect(labels()).not.toContain("Ask the author");
  });
});

describe("capture without a PDF from the library page", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("saves the reference and asks the author for the author choice", async () => {
    const t = mountForTest({}, {});
    t.host.post({ type: "add.noPdf", folder: "papers", sourceId: "t1", title: "X", miss: missAskAuthorDialogs });
    await Promise.resolve();
    press("Ask the author");
    await Promise.resolve();
    expect(t.sent.at(-1)).toEqual({ type: "paper.addFrom", folder: "papers", sourceId: "t1", ifNoPdf: "author", retryPdf: false });
  });
});
