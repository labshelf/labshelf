/**
 * @jest-environment jsdom
 */
// A miss that a sign-in or a bot check caused offers to open that page; one without access offers what it did before.
import { askNoPdf } from "../../../../src/library-ui/dom/flows/pdfDialogs";
import type { PdfMiss } from "../../../../src/library-ui/protocol";
import { mountForTest, paper } from "../mountHarness";

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
