/**
 * @jest-environment jsdom
 */
import { ALL_CAPABILITIES, menuLabels, mountForTest, paper } from "../mountHarness";

const library = [
  paper("a", "papers/Deep", { title: "Attention", authors: ["Ashish Vaswani"], year: 2017, journal: "NeurIPS", tags: ["nlp"], hasPdf: true, doi: "10.1/x" }),
  paper("r", "papers", { title: "Root paper", year: 2020, journal: "Nature", status: "reading" }),
];
const folders = [{ name: "Deep", path: "papers/Deep", children: [] as [] }];

function show(id: string) {
  const t = mountForTest({}, ALL_CAPABILITIES);
  t.snapshot(library, [], folders);
  t.host.post({ type: "select", id });
  return t;
}

const head = (t: ReturnType<typeof show>): HTMLElement => t.detail().querySelector<HTMLElement>(".detail-head")!;
const byLabel = (root: ParentNode, label: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const menuItem = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role^="menuitem"]')].find((b) => b.textContent?.includes(label));
const menuButtons = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')];

describe("detail head venue line (A12)", () => {
  it("ends the venue line with the folder name", () => {
    const meta = head(show("a")).querySelector(".detail-meta")!.textContent!;
    expect(meta).toContain("NeurIPS");
    expect(meta.trim().endsWith("Deep")).toBe(true);
    expect(head(show("a")).querySelector('[data-action="goFolder"] svg')).not.toBeNull();
  });

  it("shows no folder suffix for a paper at the library root", () => {
    const meta = head(show("r")).querySelector(".detail-meta")!.textContent!;
    expect(meta).toContain("Nature");
    expect(head(show("r")).querySelector('[data-action="goFolder"]')).toBeNull();
  });
});

describe("detail head Open PDF and Cite (A12)", () => {
  it("styles Open PDF as the soft-tinted primary button", () => {
    const open = head(show("a")).querySelector(".open-btn")!;
    expect(open.classList.contains("ls-button-soft")).toBe(true);
    expect(open.classList.contains("ls-btn-primary")).toBe(false);
  });

  it("opens a menu of citation formats from Cite and copies in the chosen one", () => {
    const t = show("a");
    const cite = byLabel(head(t), "Cite")!;
    expect(cite.getAttribute("aria-haspopup")).toBe("menu");
    cite.click();
    expect(cite.getAttribute("aria-expanded")).toBe("true");
    expect(menuLabels()).toEqual(expect.arrayContaining(["BibTeX", "APA", "MLA", "Chicago", "In-text"]));
    menuItem("APA")!.click();
    expect(t.sent.at(-1)).toMatchObject({ type: "clipboard.write", label: "APA reference" });
    expect((t.sent.at(-1) as { text: string }).text).toContain("Vaswani");
  });
});

describe("detail head More actions (A12)", () => {
  it("replaces the separate toolbar buttons with one corner menu", () => {
    const h = head(show("a"));
    expect(h.querySelector('[data-action="copyKey"], [data-action="move"], [data-action="copyCite"]')).toBeNull();
    const more = byLabel(h, "More actions")!;
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("holds copy key, move and the paper menu items", () => {
    const t = show("a");
    const more = byLabel(head(t), "More actions")!;
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(menuLabels()).toEqual(expect.arrayContaining(["Copy Cite Key", "Move to…", "Remove from Library…"]));
    menuItem("Copy Cite Key")!.click();
    expect(t.sent.at(-1)).toMatchObject({ type: "clipboard.write", text: "key-a", label: "cite key" });
  });
});

describe("detail head status (A13)", () => {
  it("replaces the status segment with a button showing the current status", () => {
    const t = show("r");
    expect(t.detail().querySelector(".status-seg, [role=radiogroup]")).toBeNull();
    const status = menuButtons(head(t)).find((b) => b.textContent?.includes("Reading"));
    expect(status).toBeDefined();
  });

  it("sets the status from its menu with the same message as before", () => {
    const t = show("r");
    menuButtons(head(t)).find((b) => b.textContent?.includes("Reading"))!.click();
    expect(menuLabels()).toEqual(expect.arrayContaining(["Unread", "Reading", "Done"]));
    menuItem("Done")!.click();
    expect(t.sent).toContainEqual({ type: "paper.setStatus", ids: ["r"], status: "done" });
  });
});

describe("detail head tags (A13)", () => {
  it("shows tags as #tag with a labelled remove button", () => {
    const t = show("a");
    const chip = head(t).querySelector<HTMLElement>(".tag-chip")!;
    expect(chip.textContent).toContain("#nlp");
    byLabel(chip, "Remove tag nlp")!.click();
    expect(t.sent).toContainEqual({ type: "paper.setTags", ids: ["a"], add: [], remove: ["nlp"] });
  });

  it("shows the input only after Add tag, and Enter adds the tag", () => {
    const t = show("a");
    expect(head(t).querySelector('input[aria-label="Add tag"]')).toBeNull();
    byLabel(head(t), "Add tag")!.click();
    const input = head(t).querySelector<HTMLInputElement>('input[aria-label="Add tag"]')!;
    expect(document.activeElement).toBe(input);
    input.value = "transformers";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(t.sent).toContainEqual({ type: "paper.setTags", ids: ["a"], add: ["transformers"], remove: [] });
  });

  it("lists the library's other tags in a menu and adds the chosen one", () => {
    const t = show("r");
    byLabel(head(t), "Add tag")!.click();
    expect(head(t).querySelector("datalist")).toBeNull();
    byLabel(head(t), "Choose an existing tag")!.click();
    menuItem("#nlp")!.click();
    expect(t.sent).toContainEqual({ type: "paper.setTags", ids: ["r"], add: ["nlp"], remove: [] });
    expect(head(t).querySelector(".tag-input")).not.toBeNull();
  });

  it("disables the existing-tag button when the paper already carries every library tag", () => {
    const t = show("a");
    byLabel(head(t), "Add tag")!.click();
    expect(byLabel(head(t), "Choose an existing tag")!.disabled).toBe(true);
  });

  it("closes the field on Escape and when the selection changes", () => {
    const t = show("a");
    byLabel(head(t), "Add tag")!.click();
    head(t).querySelector<HTMLInputElement>(".tag-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(head(t).querySelector(".tag-input")).toBeNull();
    byLabel(head(t), "Add tag")!.click();
    t.host.post({ type: "select", id: "r" });
    expect(head(t).querySelector(".tag-input")).toBeNull();
  });

  it("goes back to the Add tag button, adding nothing, when the field loses focus", async () => {
    const t = show("a");
    byLabel(head(t), "Add tag")!.click();
    const input = head(t).querySelector<HTMLInputElement>(".tag-input")!;
    input.value = "half-typed";
    input.blur();
    await new Promise((r) => setTimeout(r, 5));
    expect(head(t).querySelector(".tag-input")).toBeNull();
    expect(head(t).querySelector(".tag-add")).not.toBeNull();
    expect(t.sent.some((m) => m.type === "paper.setTags")).toBe(false);
  });
});

describe("detail tabs keep their content (A13)", () => {
  it.each(["details", "annotations", "notes", "related"] as const)("renders the %s tab", (tab) => {
    const t = mountForTest({ detailTab: tab }, ALL_CAPABILITIES);
    t.snapshot(library, [], folders);
    t.host.post({ type: "select", id: "a" });
    const tabs = [...t.detail().querySelectorAll('[data-action="tab"]')].map((e) => e.textContent?.trim());
    expect(tabs).toEqual(expect.arrayContaining(["Details", "Annotations", "Notes", "Related"]));
    expect(t.detail().querySelector(`[data-action="tab"][data-tab="${tab}"]`)).not.toBeNull();
    if (tab === "details") expect(t.detail().textContent).toContain("10.1/x");
    if (tab === "notes") expect(t.detail().querySelector(".note-input")).not.toBeNull();
  });
});
