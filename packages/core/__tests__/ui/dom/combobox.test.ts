/**
 * @jest-environment jsdom
 */
// Tests the combobox widget: ARIA attributes, filtering that keeps free text, arrow keys, Enter and Escape, click, blur and dispose.
import { mountCombobox, type Combobox, type ComboboxSuggestion } from "../../../src/ui/dom/combobox";

const contacts: ComboboxSuggestion[] = [
  { label: "Ada Lovelace", detail: "ada@example.com", value: "ada@example.com" },
  { label: "Alan Turing", detail: "alan@example.com", value: "alan@example.com" },
  { label: "Grace Hopper", detail: "grace@example.com", value: "grace@example.com" },
];

// jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = (): void => undefined;

afterEach(() => { document.body.innerHTML = ""; });

function mount(onPick?: (s: ComboboxSuggestion) => void): { box: Combobox; form: HTMLFormElement } {
  const form = document.createElement("form");
  const box = mountCombobox({ label: "Email", suggestions: contacts, type: "email", name: "email", ...(onPick ? { onPick } : {}) });
  form.append(box.root);
  document.body.append(form);
  return { box, form };
}
const type = (box: Combobox, text: string): void => {
  box.input.value = text;
  box.input.dispatchEvent(new Event("input", { bubbles: true }));
};
const key = (box: Combobox, name: string): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  box.input.dispatchEvent(e);
  return e;
};
const list = (box: Combobox): HTMLElement => box.root.querySelector<HTMLElement>('[role="listbox"]')!;
const options = (box: Combobox): HTMLElement[] => [...box.root.querySelectorAll<HTMLElement>('[role="option"]')];
const labels = (box: Combobox): string[] => options(box).map((o) => o.querySelector(".label")?.textContent ?? "");

describe("combobox attributes", () => {
  it("sets the combobox role, name, autocomplete and the listbox link", () => {
    const { box } = mount();
    const input = box.input;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-label")).toBe("Email");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.type).toBe("email");
    expect(input.name).toBe("email");
    const controls = input.getAttribute("aria-controls")!;
    expect(document.getElementById(controls)).toBe(list(box));
    expect(list(box).hidden).toBe(true);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("points aria-activedescendant at the active option and marks it selected", () => {
    const { box } = mount();
    type(box, "a");
    expect(box.input.getAttribute("aria-expanded")).toBe("true");
    key(box, "ArrowDown");
    const [first, ...rest] = options(box);
    expect(box.input.getAttribute("aria-activedescendant")).toBe(first!.id);
    expect(first!.getAttribute("aria-selected")).toBe("true");
    expect(rest.every((o) => o.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("gives each combobox distinct ids", () => {
    const a = mount().box;
    const b = mount().box;
    expect(a.input.getAttribute("aria-controls")).not.toBe(b.input.getAttribute("aria-controls"));
  });
});

describe("combobox filtering", () => {
  it("filters by label and detail as the user types", () => {
    const { box } = mount();
    type(box, "al");
    expect(labels(box)).toEqual(["Alan Turing"]);
    type(box, "grace@");
    expect(labels(box)).toEqual(["Grace Hopper"]);
    type(box, "a");
    expect(labels(box)).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
  });

  it("keeps free text with no match and hides the list", () => {
    const { box } = mount();
    type(box, "nobody@example.org");
    expect(box.input.value).toBe("nobody@example.org");
    expect(options(box)).toHaveLength(0);
    expect(list(box).hidden).toBe(true);
    expect(box.input.getAttribute("aria-expanded")).toBe("false");
  });

  it("setSuggestions refreshes the open list", () => {
    const { box } = mount();
    type(box, "lin");
    expect(labels(box)).toEqual([]);
    box.setSuggestions([...contacts, { label: "Linus", value: "linus@example.com" }]);
    expect(labels(box)).toEqual(["Linus"]);
  });
});

describe("combobox keyboard", () => {
  it("moves the active option with the arrows, clamped at both ends", () => {
    const { box } = mount();
    type(box, "a");
    const ids = options(box).map((o) => o.id);
    const active = (): string | null => box.input.getAttribute("aria-activedescendant");
    expect(key(box, "ArrowDown").defaultPrevented).toBe(true);
    expect(active()).toBe(ids[0]);
    key(box, "ArrowDown");
    key(box, "ArrowDown");
    key(box, "ArrowDown");
    expect(active()).toBe(ids[2]);
    key(box, "ArrowUp");
    expect(active()).toBe(ids[1]);
    key(box, "ArrowUp");
    key(box, "ArrowUp");
    expect(active()).toBe(ids[0]);
  });

  it("ArrowDown opens a closed list", () => {
    const { box } = mount();
    key(box, "ArrowDown");
    expect(box.input.getAttribute("aria-expanded")).toBe("true");
    expect(options(box)).toHaveLength(3);
  });

  it("Enter on an active option picks it without submitting the form", () => {
    const picked: ComboboxSuggestion[] = [];
    const { box, form } = mount((s) => picked.push(s));
    const outerKeys = jest.fn();
    form.addEventListener("keydown", outerKeys);
    const inputs = jest.fn();
    form.addEventListener("input", inputs);
    type(box, "gr");
    inputs.mockClear();
    key(box, "ArrowDown");
    outerKeys.mockClear();
    const e = key(box, "Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(outerKeys).not.toHaveBeenCalled();
    expect(box.input.value).toBe("grace@example.com");
    expect(picked).toEqual([contacts[2]]);
    expect(inputs).toHaveBeenCalledTimes(1);
    expect(list(box).hidden).toBe(true);
    expect(box.input.getAttribute("aria-expanded")).toBe("false");
    expect(box.input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("Enter with no active option is left to the form", () => {
    const onPick = jest.fn();
    const { box, form } = mount(onPick);
    const outerKeys = jest.fn();
    form.addEventListener("keydown", outerKeys);
    type(box, "a");
    const e = key(box, "Enter");
    expect(e.defaultPrevented).toBe(false);
    expect(outerKeys).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    expect(box.input.value).toBe("a");
  });

  it("Escape closes an open list without reaching outer handlers", () => {
    const { box } = mount();
    const outer = jest.fn();
    document.addEventListener("keydown", outer);
    try {
      type(box, "a");
      key(box, "ArrowDown");
      outer.mockClear();
      const e = key(box, "Escape");
      expect(e.defaultPrevented).toBe(true);
      expect(outer).not.toHaveBeenCalled();
      expect(list(box).hidden).toBe(true);
      expect(box.input.getAttribute("aria-expanded")).toBe("false");
      expect(box.input.hasAttribute("aria-activedescendant")).toBe(false);
      expect(box.input.value).toBe("a");
      // A closed list lets Escape through, so the dialog around it can close.
      key(box, "Escape");
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", outer);
    }
  });
});

describe("combobox pointer, blur and dispose", () => {
  it("click picks an option, and mousedown on the list keeps focus", () => {
    const onPick = jest.fn();
    const { box } = mount(onPick);
    type(box, "a");
    const row = options(box)[1]!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(box.input.value).toBe("alan@example.com");
    expect(onPick).toHaveBeenCalledWith(contacts[1]);
    expect(list(box).hidden).toBe(true);
  });

  it("blur closes the list and keeps the typed text", () => {
    const { box } = mount();
    type(box, "a");
    box.input.dispatchEvent(new FocusEvent("blur"));
    expect(list(box).hidden).toBe(true);
    expect(box.input.getAttribute("aria-expanded")).toBe("false");
    expect(box.input.value).toBe("a");
  });

  it("dispose removes the root and stops listening", () => {
    const { box, form } = mount();
    box.dispose();
    expect(form.contains(box.root)).toBe(false);
    type(box, "a");
    expect(options(box)).toHaveLength(0);
    expect(box.input.getAttribute("aria-expanded")).toBe("false");
  });
});
