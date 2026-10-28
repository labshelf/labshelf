/** @jest-environment jsdom */
import {
  renderCheckboxField, renderInlineCode, renderNumberField, renderPickField, setRowDisabled, renderSettingRow, renderSettingsPage, renderSettingsSection, renderTextField,
} from "../../../../src/ui/dom/settings.js";

describe("settings layout", () => {
  it("frames the sections under the brand, the title and the aside", () => {
    const aside = document.createElement("span");
    const page = renderSettingsPage({ title: "LabShelf Settings", aside }, renderSettingsSection({ title: "Library" }));
    expect(page.querySelector(".settings-head .ls-brand svg")).not.toBeNull();
    expect(page.querySelector("h1")?.textContent).toBe("LabShelf Settings");
    expect(page.querySelector(".settings-head")?.contains(aside)).toBe(true);
    expect(page.querySelector("section h2")?.textContent).toBe("Library");
  });

  it("renders descriptions as text, never as markup, and nodes as given", () => {
    const section = renderSettingsSection({ title: "T", description: ["Use ", renderInlineCode("<b>x</b>"), " <i>here</i>"] });
    const desc = section.querySelector(".settings-desc")!;
    expect(desc.querySelector("code")?.textContent).toBe("<b>x</b>");
    expect(desc.querySelector("b")).toBeNull();
    expect(desc.querySelector("i")).toBeNull();
    expect(desc.textContent).toBe("Use <b>x</b> <i>here</i>");
  });

  it("omits the description paragraph when there is none", () => {
    expect(renderSettingsSection({ title: "T" }).querySelector(".settings-desc")).toBeNull();
  });

  it("puts a labelled row's label before its control and ties the label to the control id", () => {
    const field = renderNumberField({ id: "n", min: 0, max: 5, step: 1, width: "sm" });
    const row = renderSettingRow({ label: "Interval", labelFor: "n", description: "Minutes." }, field.element);
    expect([...row.children].map((c) => c.className)).toEqual(["setting-label", "setting-desc", "ls-input setting-input-sm"]);
    expect(row.querySelector("label")?.getAttribute("for")).toBe("n");
  });

  it("puts a checkbox before its description", () => {
    const box = renderCheckboxField({ id: "c", label: "Enable it", checked: true });
    const row = renderSettingRow({ description: "Extra." }, box.element);
    expect(row.firstElementChild).toBe(box.element);
    expect(box.control.checked).toBe(true);
    expect(box.element.textContent).toBe("Enable it");
  });

  it("dims and restores a row", () => {
    const row = renderSettingRow({ label: "L" }, renderTextField({ id: "t", type: "email", placeholder: "you@example.com" }).element);
    setRowDisabled(row, true);
    expect(row.classList.contains("disabled")).toBe(true);
    setRowDisabled(row, false);
    expect(row.classList.contains("disabled")).toBe(false);
  });

  it("builds a select with the given options and lets the code set its value", () => {
    const field = renderPickField({ id: "s", options: [{ value: "a", label: "Alpha <x>" }, { value: "b", label: "Beta" }], width: "md" });
    field.control.value = "b";
    expect(field.control.value).toBe("b");
    expect([...field.control.options].map((o) => o.textContent)).toEqual(["Alpha <x>", "Beta"]);
    expect(field.control.classList.contains("setting-input-md")).toBe(true);
  });

  it("builds number and text inputs with their attributes", () => {
    const n = renderNumberField({ id: "n", min: 0, max: 240, step: 1 });
    expect(n.control).toMatchObject({ type: "number", min: "0", max: "240", step: "1" });
    const t = renderTextField({ id: "u", type: "url", placeholder: "https://host.example" });
    expect(t.control).toMatchObject({ type: "url", placeholder: "https://host.example" });
  });
});
