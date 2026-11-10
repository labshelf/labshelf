/** @jest-environment jsdom */
// Tests the reader's cite popup with a scripted host client and a fake source view (CodeMirror cannot place a caret from a
// click in jsdom): what it asks the host, the selects and options it shows, and what Insert and Only add send.
import { openCiteDialog, type CiteSourceView, type CreateCiteSourceView } from "../../../src/reader/dom/citeDialog";
import type { CiteClient } from "../../../src/reader/dom/citeClient";
import type { CiteProject, CiteReply, CiteRequest } from "../../../src/writing/citations/readerCite";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const latex: CiteProject = { id: "thesis", title: "Thesis", format: "latex", bibliography: "labshelf.bib", inBibliography: false, files: ["main.tex", "intro.tex"] };
const typst: CiteProject = { id: "talk", title: "Talk", format: "typst", bibliography: "refs.bib", inBibliography: true, files: ["talk.typ"] };

interface Harness {
  sent: CiteRequest[];
  view: { shown: Array<{ text: string; format: string }>; citation: string | null; place(offset: number): void };
  notices: string[];
  answers: Array<(request: CiteRequest) => CiteReply | undefined>;
  posted: unknown[];
  client: CiteClient;
  load: () => Promise<CreateCiteSourceView>;
}

function harness(projects: CiteProject[]): Harness {
  const sent: CiteRequest[] = [];
  const answers: Harness["answers"] = [];
  const view: Harness["view"] = { shown: [], citation: null, place: () => undefined };
  let version = 0;
  const client: CiteClient = {
    request: async (request) => {
      sent.push(request);
      for (const answer of answers) {
        const reply = answer(request);
        if (reply) { return reply; }
      }
      if (request.kind === "targets") { return { kind: "targets", projects }; }
      if (request.kind === "read") { version += 1; return { kind: "source", text: `text of ${request.path}`, version: `v${version}` }; }
      if (request.kind === "insert") { return { kind: "inserted", path: request.path, citation: "x" }; }
      return { kind: "listed", bibliography: "labshelf.bib" };
    },
  };
  const create: CreateCiteSourceView = (onPlace) => {
    view.place = onPlace;
    const source: CiteSourceView = {
      element: document.createElement("div"),
      show: (text, format) => { view.shown.push({ text, format }); view.citation = null; },
      setCitation: (text) => { view.citation = text; },
      focus: () => undefined,
      destroy: () => undefined,
    };
    return source;
  };
  return { sent, view, notices: [], answers, posted: [], client, load: async () => create };
}

function open(h: Harness, citation: { page?: number; quote?: string } = {}, memory = {}) {
  return openCiteDialog({ client: h.client, citeKey: "smith2020", ...citation, memory, loadSourceView: h.load, notify: (message) => h.notices.push(message), post: (message) => h.posted.push(message) });
}

const dialog = () => document.querySelector<HTMLElement>(".rd-cite-dialog");
const select = (label: string) => dialog()!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const button = (re: RegExp) => [...dialog()!.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
const checkbox = () => dialog()!.querySelector<HTMLInputElement>("input[type=checkbox]");
const status = () => dialog()!.querySelector(".rd-cite-dialog-status")?.textContent ?? "";
const choose = async (el: HTMLSelectElement, value: string) => { el.value = value; el.dispatchEvent(new Event("change")); await settle(); };

afterEach(() => { document.body.innerHTML = ""; });

describe("openCiteDialog", () => {
  it("asks the targets, reads the first file of the first project and shows the selects and the text (2.1a)", async () => {
    const h = harness([latex, typst]);
    open(h, { page: 4 });
    await settle();
    expect(h.sent.slice(0, 2)).toEqual([{ kind: "targets" }, { kind: "read", projectId: "thesis", path: "main.tex" }]);
    expect([...select("Project").options].map((o) => o.textContent)).toEqual(["Thesis", "Talk"]);
    expect([...select("File").options].map((o) => o.value)).toEqual(["main.tex", "intro.tex"]);
    expect(h.view.shown).toEqual([{ text: "text of main.tex", format: "latex" }]);
    expect(dialog()!.textContent).toContain("Cite smith2020");
    expect(dialog()!.textContent).toContain("p. 4");
  });

  it("reads the file of a changed project or file; Insert waits for a click and sends the place (2.1b)", async () => {
    const h = harness([latex, typst]);
    open(h, { page: 4, quote: "A passage." });
    await settle();
    await choose(select("File"), "intro.tex");
    expect(h.sent.at(-1)).toEqual({ kind: "read", projectId: "thesis", path: "intro.tex" });
    await choose(select("Project"), "talk");
    expect(h.sent.at(-1)).toEqual({ kind: "read", projectId: "talk", path: "talk.typ" });
    expect(h.view.shown.at(-1)).toEqual({ text: "text of talk.typ", format: "typst" });
    expect(button(/^Insert$/)!.disabled).toBe(true);
    expect(status()).toMatch(/click in the text where the citation goes/i);
    h.view.place(7);
    expect(button(/^Insert$/)!.disabled).toBe(false);
    expect(h.view.citation).toContain("@smith2020");
    expect(h.view.citation).toContain("A passage.");
    button(/^Insert$/)!.click();
    await settle();
    expect(h.sent.at(-1)).toEqual({ kind: "insert", projectId: "talk", path: "talk.typ", version: "v3", offset: 7, page: 4, quote: "A passage.", quoted: true });
  });

  it("with a quote shows the checked quotation box and no Only add; unchecking drops the quote from the preview (2.1c, A3)", async () => {
    const h = harness([latex]);
    open(h, { page: 2, quote: "A passage." });
    await settle();
    expect(checkbox()!.checked).toBe(true);
    expect(checkbox()!.closest("label")!.textContent).toMatch(/with the quotation/i);
    expect(button(/only add/i)).toBeUndefined();
    h.view.place(0);
    expect(h.view.citation).toContain("A passage.");
    checkbox()!.click();
    expect(h.view.citation).toBe("\\cite[p.~2]{smith2020}");
    button(/^Insert$/)!.click();
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ kind: "insert", quoted: false, quote: "A passage." });
  });

  it("without a quote offers Only add only when the project lacks the paper, and sends bibliography (2.1c, A3)", async () => {
    const h = harness([latex, typst]);
    open(h);
    await settle();
    expect(checkbox()).toBeNull();
    expect(button(/only add to labshelf\.bib/i)).toBeDefined();
    await choose(select("Project"), "talk");
    expect(button(/only add/i)?.hidden ?? true).toBe(true);
    await choose(select("Project"), "thesis");
    button(/only add/i)!.click();
    await settle();
    expect(h.sent.at(-1)).toEqual({ kind: "bibliography", projectId: "thesis" });
    expect(dialog()).toBeNull();
    expect(h.notices).toEqual(["Added to labshelf.bib"]);
  });

  it("on a stale reply reloads the file and waits for a new click (2.1d, A4)", async () => {
    const h = harness([latex]);
    h.answers.push((request) => (request.kind === "insert" && request.version === "v1" ? { kind: "error", message: "main.tex changed; click again where the citation goes", stale: true } : undefined));
    open(h);
    await settle();
    h.view.place(3);
    button(/^Insert$/)!.click();
    await settle();
    expect(h.sent.at(-1)).toEqual({ kind: "read", projectId: "thesis", path: "main.tex" });
    expect(h.view.shown).toHaveLength(2);
    expect(button(/^Insert$/)!.disabled).toBe(true);
    expect(status()).toContain("main.tex changed");
    h.view.place(5);
    button(/^Insert$/)!.click();
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ kind: "insert", version: "v2", offset: 5 });
    expect(dialog()).toBeNull();
    expect(h.notices).toEqual(["Cited in main.tex"]);
  });

  it("shows an error reply in the popup and keeps it open (2.1d)", async () => {
    const h = harness([latex]);
    h.answers.push((request) => (request.kind === "insert" ? { kind: "error", message: "Disk full" } : undefined));
    open(h);
    await settle();
    h.view.place(1);
    button(/^Insert$/)!.click();
    await settle();
    expect(status()).toContain("Disk full");
    expect(dialog()).not.toBeNull();
    expect(button(/^Insert$/)!.disabled).toBe(false);
  });

  it("remembers the last project and file for the next opening", async () => {
    const h = harness([latex, typst]);
    const memory = {};
    open(h, {}, memory);
    await settle();
    await choose(select("File"), "intro.tex");
    button(/^Cancel$/)!.click();
    open(h, {}, memory);
    await settle();
    expect(h.sent.at(-1)).toEqual({ kind: "read", projectId: "thesis", path: "intro.tex" });
    expect(select("File").value).toBe("intro.tex");
  });

  it("with no project shows a short line instead of the selects and editor, with Copy and Cancel only", async () => {
    const h = harness([]);
    open(h, { page: 4, quote: "A passage." });
    await settle();
    expect(dialog()!.textContent).toContain("No writing project to cite in");
    expect(dialog()!.querySelector<HTMLElement>(".rd-cite-dialog-pickers")!.hidden).toBe(true);
    expect(dialog()!.querySelector<HTMLElement>(".rd-cite-dialog-source")!.hidden).toBe(true);
    const visible = [...dialog()!.querySelectorAll("button")].filter((b) => !b.hidden).map((b) => b.textContent);
    expect(visible).toEqual(["Copy", "Cancel"]);
    button(/^Copy$/)!.click();
    expect(h.posted).toEqual([{ command: "copyWithCitation", text: "A passage.", pageNumber: 4 }]);
    expect(dialog()).toBeNull();
  });

  it("offers Copy when the host has no cite port and answers with an error", async () => {
    const h = harness([latex]);
    h.answers.push((request) => (request.kind === "targets" ? { kind: "error", message: "Citing is not available here" } : undefined));
    open(h, { page: 2, quote: "A passage." });
    await settle();
    expect(dialog()!.textContent).toContain("No writing project to cite in");
    expect(button(/^Insert$/)?.hidden ?? true).toBe(true);
    button(/^Copy$/)!.click();
    expect(h.posted).toEqual([{ command: "copyWithCitation", text: "A passage.", pageNumber: 2 }]);
  });

  it("Copy posts copyWithCitation for a passage and closes, without choosing a project", async () => {
    const h = harness([latex, typst]);
    open(h, { page: 7, quote: "A passage." });
    await settle();
    button(/^Copy$/)!.click();
    expect(h.posted).toEqual([{ command: "copyWithCitation", text: "A passage.", pageNumber: 7 }]);
    expect(h.sent.some((request) => request.kind === "insert" || request.kind === "bibliography")).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("Copy without a passage asks the host for the bare citation in the user's style, with the page when known", async () => {
    const h = harness([latex]);
    open(h, { page: 3 });
    await settle();
    button(/^Copy$/)!.click();
    open(h);
    await settle();
    button(/^Copy$/)!.click();
    expect(h.posted).toEqual([{ command: "copyCitation", pageNumber: 3 }, { command: "copyCitation" }]);
  });

  it("orders the footer Copy, Only add, Cancel, Insert", async () => {
    const h = harness([latex]);
    open(h);
    await settle();
    const order = [...dialog()!.querySelectorAll(".rd-cite-dialog-actions button")].filter((b) => !(b as HTMLElement).hidden).map((b) => b.textContent);
    expect(order).toEqual(["Copy", "Only add to labshelf.bib", "Cancel", "Insert"]);
  });
});

describe("openCiteDialog with code", () => {
  it("shows the listing the host built on lines of its own, without the citation options, and inserts or copies it", async () => {
    const h = harness([latex]);
    h.answers.push((request) => (request.kind === "read" ? { kind: "source", text: "See here.", version: "v1", insert: "LISTING" } : undefined));
    const copied: string[] = [];
    let closed = 0;
    openCiteDialog({ client: h.client, memory: {}, loadSourceView: h.load, notify: (m) => h.notices.push(m), onClose: () => { closed += 1; }, code: { label: "fit_model in fit.py", copy: (text) => copied.push(text) } });
    await settle();
    expect(dialog()!.textContent).toContain("Insert code into a manuscript");
    expect(dialog()!.textContent).toContain("fit_model in fit.py");
    expect(checkbox()).toBeNull();
    expect(button(/Only add/)?.hidden ?? true).toBe(true);
    h.view.place(3);
    expect(h.view.citation).toBe("\nLISTING\n");
    button(/^Insert$/)!.click();
    await settle();
    expect(h.sent.at(-1)).toEqual({ kind: "insert", projectId: "thesis", path: "main.tex", version: "v1", offset: 3, quoted: false });
    expect(h.notices).toEqual(["Inserted into main.tex"]);
    expect(closed).toBe(1);
    openCiteDialog({ client: h.client, memory: {}, loadSourceView: h.load, code: { label: "x", copy: (text) => copied.push(text) } });
    await settle();
    button(/Copy/)!.click();
    expect(copied).toEqual(["LISTING"]);
  });
});
