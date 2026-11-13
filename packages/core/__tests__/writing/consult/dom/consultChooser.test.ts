/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests askConsult (reply -> value or error) and the Consult chooser: the modal dialog with its four kinds, the list it asks for and shows, picking and
// dismissing, Browse... for code, and how a failed list or browse is reported.
import type { ConsultEntry, ConsultKind, ConsultReply, ConsultRequest } from "../../../../src/writing/consult/consultRequests";
import { askConsult, type ConsultClient } from "../../../../src/writing/consult/dom/consultClient";
import { openConsultChooser } from "../../../../src/writing/consult/dom/consultChooser";

// jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = (): void => undefined;

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) { await new Promise((resolve) => setTimeout(resolve, 0)); } };

const PAPERS: ConsultEntry[] = [
  { ref: { kind: "paper", paperId: "p1" }, label: "Smith 2020", detail: "Fitting decay curves" },
  { ref: { kind: "paper", paperId: "p2" }, label: "Jones 2021", detail: "Spectral methods" },
];
const MANUSCRIPTS: ConsultEntry[] = [
  { ref: { kind: "manuscript", projectId: "pr1", path: "main.md" }, label: "main.md" },
  { ref: { kind: "manuscript", projectId: "pr1", path: "appendix.md" }, label: "appendix.md" },
];
const CODE: ConsultEntry[] = [
  { ref: { kind: "code", path: "../analysis/fit.py" }, label: "fit.py", detail: "../analysis" },
];
const PICKED: ConsultEntry = { ref: { kind: "pickedFile", id: "f1", name: "other.py" }, label: "other.py" };

const entriesReply = (entries: ConsultEntry[], canBrowse = false): ConsultReply => ({ ok: true, value: { kind: "entries", entries, canBrowse } });
const pickedReply = (entry: ConsultEntry | null): ConsultReply => ({ ok: true, value: { kind: "picked", entry } });

/** A client answering list requests from `lists` and browse requests with `browse`. */
function fakeClient(lists: Partial<Record<ConsultKind, ConsultReply>>, browse?: ConsultReply): jest.Mock<Promise<ConsultReply>, [ConsultRequest]> {
  return jest.fn(async (request: ConsultRequest): Promise<ConsultReply> => {
    if (request.kind === "list") { return lists[request.what] ?? entriesReply([]); }
    if (request.kind === "browse") { return browse ?? pickedReply(null); }
    return { ok: false, error: "unexpected request" };
  });
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Consult"]');
const radios = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"]')];
const radio = (label: string): HTMLElement => radios().find((each) => each.textContent?.trim() === label)!;
const comboInput = (): HTMLInputElement => document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]')!;
const browseButton = (): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((each) => each.textContent?.trim() === "Browse...");
const status = (): HTMLElement => document.querySelector<HTMLElement>('[role="dialog"] [role="status"]')!;

/** Focuses the list so every entry shows, as the user does, and returns the shown option labels. */
function shownLabels(): string[] {
  comboInput().dispatchEvent(new Event("focus"));
  return [...document.querySelectorAll<HTMLElement>(".ls-combobox-option")].map((option) => option.querySelector(".label")?.textContent ?? "");
}

function optionFor(label: string): HTMLElement {
  comboInput().dispatchEvent(new Event("focus"));
  return [...document.querySelectorAll<HTMLElement>(".ls-combobox-option")].find((option) => option.querySelector(".label")?.textContent === label)!;
}

const escape = (): boolean => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

const open: typeof openConsultChooser = (options) => openConsultChooser(options);

afterEach(() => { document.body.replaceChildren(); });

describe("askConsult", () => {
  it("8.3-a returns the value of an ok reply", async () => {
    const value = { kind: "entries" as const, entries: PAPERS, canBrowse: false };
    const client: ConsultClient = async () => ({ ok: true, value });
    await expect(askConsult(client, { kind: "list", what: "paper" })).resolves.toEqual(value);
  });

  it("8.3-a sends the request it is given to the client", async () => {
    const client = fakeClient({ paper: entriesReply(PAPERS) });
    await askConsult(client, { kind: "list", what: "paper" });
    expect(client).toHaveBeenCalledTimes(1);
    expect(client).toHaveBeenCalledWith({ kind: "list", what: "paper" });
  });

  it("8.3-a rejects with an Error carrying the reply's error text on ok:false", async () => {
    const client: ConsultClient = async () => ({ ok: false, error: "No such paper." });
    const failure = askConsult(client, { kind: "paperPdf", paperId: "x" });
    await expect(failure).rejects.toBeInstanceOf(Error);
    await expect(failure).rejects.toThrow("No such paper.");
  });

  it("8.3-a propagates a client that rejects", async () => {
    const boom = new Error("channel closed");
    const client: ConsultClient = async () => { throw boom; };
    await expect(askConsult(client, { kind: "browse" })).rejects.toBe(boom);
  });
});

describe("openConsultChooser", () => {
  it("8.3-b (A9) shows a dialog titled Consult with four radio buttons Paper, Notes, Manuscript, Code in a radiogroup", async () => {
    const handle = open({ client: fakeClient({ paper: entriesReply(PAPERS) }), onPick: jest.fn() });
    await flush();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("Consult");
    expect(radios().map((each) => each.textContent?.trim())).toEqual(["Paper", "Notes", "Manuscript", "Code"]);
    expect(radios().every((each) => each.closest('[role="radiogroup"]') !== null)).toBe(true);
    handle.close();
  });

  it("8.3-b (A9) starts on paper without a memory and asks for that list", async () => {
    const client = fakeClient({ paper: entriesReply(PAPERS) });
    open({ client, onPick: jest.fn() });
    await flush();
    expect(client).toHaveBeenCalledWith({ kind: "list", what: "paper" });
    expect(radio("Paper").getAttribute("aria-checked")).toBe("true");
    for (const other of ["Notes", "Manuscript", "Code"]) { expect(radio(other).getAttribute("aria-checked")).toBe("false"); }
    expect(shownLabels()).toEqual(["Smith 2020", "Jones 2021"]);
  });

  it("8.3-b (A9) starts on memory.kind and asks for that list only", async () => {
    const client = fakeClient({ code: entriesReply(CODE), paper: entriesReply(PAPERS) });
    open({ client, memory: { kind: "code" }, onPick: jest.fn() });
    await flush();
    expect(radio("Code").getAttribute("aria-checked")).toBe("true");
    expect(radio("Paper").getAttribute("aria-checked")).toBe("false");
    expect(client).toHaveBeenCalledTimes(1);
    expect(client).toHaveBeenCalledWith({ kind: "list", what: "code" });
    expect(shownLabels()).toEqual(["fit.py"]);
  });

  it("8.3-b (A9) clicking Manuscript sends what:'manuscript', writes memory.kind and lists those entries", async () => {
    const client = fakeClient({ paper: entriesReply(PAPERS), manuscript: entriesReply(MANUSCRIPTS) });
    const memory: { kind?: ConsultKind } = {};
    open({ client, memory, onPick: jest.fn() });
    await flush();
    radio("Manuscript").click();
    await flush();
    expect(client).toHaveBeenLastCalledWith({ kind: "list", what: "manuscript" });
    expect(memory.kind).toBe("manuscript");
    expect(radio("Manuscript").getAttribute("aria-checked")).toBe("true");
    expect(radio("Paper").getAttribute("aria-checked")).toBe("false");
    expect(shownLabels()).toEqual(["main.md", "appendix.md"]);
  });

  it("8.3-b (A9) shows each entry's detail after its label", async () => {
    open({ client: fakeClient({ paper: entriesReply(PAPERS) }), onPick: jest.fn() });
    await flush();
    comboInput().dispatchEvent(new Event("focus"));
    const first = document.querySelector<HTMLElement>(".ls-combobox-option")!;
    expect(first.textContent).toBe("Smith 2020Fitting decay curves");
  });

  it("8.3-b (A9) shows the group of an entry that has one", async () => {
    const grouped: ConsultEntry[] = [
      { ref: { kind: "projectNote", projectId: "pr1", path: "a.qmd" }, label: "a.qmd", group: "This project" },
      { ref: { kind: "projectNote", projectId: "pr2", path: "b.qmd" }, label: "b.qmd", group: "Other project" },
    ];
    open({ client: fakeClient({ paper: entriesReply(grouped) }), onPick: jest.fn() });
    await flush();
    comboInput().dispatchEvent(new Event("focus"));
    const text = dialog()!.textContent ?? "";
    expect(text).toContain("This project");
    expect(text).toContain("Other project");
    expect(text.indexOf("a.qmd")).toBeLessThan(text.indexOf("b.qmd"));
  });

  it("8.3-b (A9) ignores the stale reply of an earlier switch", async () => {
    let releasePaper: (reply: ConsultReply) => void = () => undefined;
    const client: jest.Mock<Promise<ConsultReply>, [ConsultRequest]> = jest.fn((request: ConsultRequest) => {
      if (request.kind === "list" && request.what === "paper") { return new Promise<ConsultReply>((resolve) => { releasePaper = resolve; }); }
      return Promise.resolve(entriesReply(MANUSCRIPTS));
    });
    open({ client, onPick: jest.fn() });
    await flush();
    radio("Manuscript").click();
    await flush();
    releasePaper(entriesReply(PAPERS));
    await flush();
    expect(shownLabels()).toEqual(["main.md", "appendix.md"]);
  });

  it("8.3-c picking a listed entry calls onPick with that entry once and removes the dialog", async () => {
    const onPick = jest.fn();
    open({ client: fakeClient({ paper: entriesReply(PAPERS) }), onPick });
    await flush();
    optionFor("Jones 2021").click();
    await flush();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(PAPERS[1]);
    expect(dialog()).toBeNull();
    expect(document.querySelector(".ls-scrim")).toBeNull();
  });

  it("8.3-c picking with Enter on the active entry calls onPick once and removes the dialog", async () => {
    const onPick = jest.fn();
    open({ client: fakeClient({ paper: entriesReply(PAPERS) }), onPick });
    await flush();
    shownLabels();
    comboInput().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    comboInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(PAPERS[0]);
    expect(dialog()).toBeNull();
  });

  it("8.3-c Escape removes the dialog without onPick", async () => {
    const onPick = jest.fn();
    open({ client: fakeClient({ paper: entriesReply(PAPERS) }), onPick });
    await flush();
    escape();
    await flush();
    expect(dialog()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("8.3-c a mousedown on the scrim removes the dialog without onPick", async () => {
    const onPick = jest.fn();
    open({ client: fakeClient({ paper: entriesReply(PAPERS) }), onPick });
    await flush();
    document.querySelector(".ls-scrim")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dialog()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("8.3-c close() removes the dialog without onPick", async () => {
    const onPick = jest.fn();
    const handle = open({ client: fakeClient({ paper: entriesReply(PAPERS) }), onPick });
    await flush();
    handle.close();
    expect(dialog()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("8.3-d Code with canBrowse true shows Browse..., which sends {kind:'browse'} and hands the picked entry to onPick", async () => {
    const client = fakeClient({ code: entriesReply(CODE, true) }, pickedReply(PICKED));
    const onPick = jest.fn();
    open({ client, memory: { kind: "code" }, onPick });
    await flush();
    const browse = browseButton();
    expect(browse).toBeDefined();
    browse!.click();
    await flush();
    expect(client).toHaveBeenCalledWith({ kind: "browse" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(PICKED);
    expect(dialog()).toBeNull();
  });

  it("8.3-d Code with canBrowse false shows no Browse...", async () => {
    open({ client: fakeClient({ code: entriesReply(CODE, false) }), memory: { kind: "code" }, onPick: jest.fn() });
    await flush();
    expect(browseButton()).toBeUndefined();
  });

  it("8.3-d a browse reply with entry null leaves the dialog open and does not call onPick", async () => {
    const client = fakeClient({ code: entriesReply(CODE, true) }, pickedReply(null));
    const onPick = jest.fn();
    open({ client, memory: { kind: "code" }, onPick });
    await flush();
    browseButton()!.click();
    await flush();
    expect(client).toHaveBeenCalledWith({ kind: "browse" });
    expect(onPick).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("8.3-e a list reply {ok:false, error} shows the error in the status line in the error colour and calls onError", async () => {
    const client = fakeClient({ paper: { ok: false, error: "The library is not open." } });
    const onError = jest.fn();
    expect(() => open({ client, onPick: jest.fn(), onError })).not.toThrow();
    await flush();
    expect(status().textContent).toContain("The library is not open.");
    expect(status().classList.contains("rd-cite-dialog-error")).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
  });

  it("8.3-e a failed list without onError still shows the error and does not throw", async () => {
    const client = fakeClient({ paper: { ok: false, error: "The library is not open." } });
    expect(() => open({ client, onPick: jest.fn() })).not.toThrow();
    await flush();
    expect(status().textContent).toContain("The library is not open.");
  });

  it("8.3-e a client that rejects on list shows an error and calls onError instead of throwing", async () => {
    const client: ConsultClient = async () => { throw new Error("channel closed"); };
    const onError = jest.fn();
    expect(() => open({ client, onPick: jest.fn(), onError })).not.toThrow();
    await flush();
    expect(status().classList.contains("rd-cite-dialog-error")).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("8.3-e a failed browse shows the error in the status line, calls onError and keeps the dialog open", async () => {
    const client = fakeClient({ code: entriesReply(CODE, true) }, { ok: false, error: "The picker failed." });
    const onError = jest.fn();
    const onPick = jest.fn();
    open({ client, memory: { kind: "code" }, onPick, onError });
    await flush();
    browseButton()!.click();
    await flush();
    expect(status().textContent).toContain("The picker failed.");
    expect(status().classList.contains("rd-cite-dialog-error")).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });
});
