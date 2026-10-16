/**
 * @jest-environment jsdom
 */
// The "Ask the author" choice in the capture and Find PDF dialogs.
import { askNoPdf } from "../../../../src/library-ui/dom/flows/pdfDialogs";
import type { PdfMiss } from "../../../../src/library-ui/protocol";
import { mountForTest, paper } from "../mountHarness";

const miss: PdfMiss = { tried: 2, sources: ["publisher"], blocked: false, needsLogin: false };
const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")];
const press = (label: string): void => buttons().find((b) => b.textContent === label)!.click();
const labels = (): Array<string | null> => buttons().map((b) => b.textContent);

describe("askNoPdf", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("resolves author when the user asks the author", async () => {
    const answer = askNoPdf("X", miss);
    press("Ask the author");
    expect(await answer).toBe("author");
  });
});

describe("Find PDF miss dialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  async function findMiss(caps: Parameters<typeof mountForTest>[1]) {
    const t = mountForTest({}, caps);
    t.snapshot([paper("a", "papers")]);
    t.host.post({ type: "pdf.findResult", id: "a", miss });
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
    t.host.post({ type: "add.noPdf", folder: "papers", sourceId: "t1", title: "X", miss });
    await Promise.resolve();
    press("Ask the author");
    await Promise.resolve();
    expect(t.sent.at(-1)).toEqual({ type: "paper.addFrom", folder: "papers", sourceId: "t1", ifNoPdf: "author", retryPdf: false });
  });
});
