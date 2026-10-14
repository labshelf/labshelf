/** @jest-environment jsdom */
import {
  checkboxField, inlineCode, numberField, selectField, setRowDisabled, settingRow, settingsPage, settingsSection, textField,
} from "../../../../src/ui/dom/settings/index.js";

describe("settings layout", () => {
  it("frames the sections under the brand, the title and the aside", () => {
    const aside = document.createElement("span");
    const page = settingsPage({ title: "LabShelf Settings", aside }, settingsSection({ title: "Library" }));
    expect(page.querySelector(".settings-head .ls-brand svg")).not.toBeNull();
    expect(page.querySelector("h1")?.textContent).toBe("LabShelf Settings");
    expect(page.querySelector(".settings-head")?.contains(aside)).toBe(true);
    expect(page.querySelector("section h2")?.textContent).toBe("Library");
  });

  it("renders descriptions as text, never as markup, and nodes as given", () => {
    const section = settingsSection({ title: "T", description: ["Use ", inlineCode("<b>x</b>"), " <i>here</i>"] });
    const desc = section.querySelector(".settings-desc")!;
    expect(desc.querySelector("code")?.textContent).toBe("<b>x</b>");
    expect(desc.querySelector("b")).toBeNull();
    expect(desc.querySelector("i")).toBeNull();
    expect(desc.textContent).toBe("Use <b>x</b> <i>here</i>");
  });

  it("omits the description paragraph when there is none", () => {
    expect(settingsSection({ title: "T" }).querySelector(".settings-desc")).toBeNull();
  });

  it("puts a labelled row's label before its control and ties the label to the control id", () => {
    const field = numberField({ id: "n", min: 0, max: 5, step: 1, width: "sm" });
    const row = settingRow({ label: "Interval", labelFor: "n", description: "Minutes." }, field.element);
    expect([...row.children].map((c) => c.className)).toEqual(["setting-label", "setting-desc", "ls-input setting-input-sm"]);
    expect(row.querySelector("label")?.getAttribute("for")).toBe("n");
  });

  it("puts a checkbox before its description", () => {
    const box = checkboxField({ id: "c", label: "Enable it", checked: true });
    const row = settingRow({ description: "Extra." }, box.element);
    expect(row.firstElementChild).toBe(box.element);
    expect(box.control.checked).toBe(true);
    expect(box.element.textContent).toBe("Enable it");
  });

  it("dims and restores a row", () => {
    const row = settingRow({ label: "L" }, textField({ id: "t", type: "email", placeholder: "you@example.com" }).element);
    setRowDisabled(row, true);
    expect(row.classList.contains("disabled")).toBe(true);
    setRowDisabled(row, false);
    expect(row.classList.contains("disabled")).toBe(false);
  });

  it("builds a select with the given options and lets the code set its value", () => {
    const field = selectField({ id: "s", options: [{ value: "a", label: "Alpha <x>" }, { value: "b", label: "Beta" }], width: "md" });
    field.control.value = "b";
    expect(field.control.value).toBe("b");
    expect([...field.control.options].map((o) => o.textContent)).toEqual(["Alpha <x>", "Beta"]);
    expect(field.control.classList.contains("setting-input-md")).toBe(true);
  });

  it("builds number and text inputs with their attributes", () => {
    const n = numberField({ id: "n", min: 0, max: 240, step: 1 });
    expect(n.control).toMatchObject({ type: "number", min: "0", max: "240", step: "1" });
    const t = textField({ id: "u", type: "url", placeholder: "https://sci-hub.se" });
    expect(t.control).toMatchObject({ type: "url", placeholder: "https://sci-hub.se" });
  });
});
