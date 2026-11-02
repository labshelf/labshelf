/** @jest-environment jsdom */
/**
 * Tests the shared chart editor inputs (plan charts, spec 4.3, D9): numberField and colourField.
 * A number field has a visible label tied to its input, commits on change (blur or Enter) and never on each keystroke, and an empty optional field reports null.
 * A colour field offers the palette as named swatches and a hex field. Controls are found by accessible name.
 */
import { numberField, colourField } from "../../../../src/qmd/dom/chartEditor/fields";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { controls, nameOf, press } from "./chartEditorHarness";

const PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2"];

let attached: HTMLElement[] = [];

function attach(el: HTMLElement): HTMLElement {
  document.body.append(el);
  attached.push(el);
  return el;
}

afterEach(() => {
  for (const el of attached) el.remove();
  attached = [];
  closeMenu();
});

function numberInput(field: HTMLElement, label: RegExp): HTMLInputElement {
  const input = controls(field, label).find((el): el is HTMLInputElement => el instanceof HTMLInputElement);
  if (input === undefined) throw new Error(`no input named ${String(label)} in ${field.outerHTML}`);
  return input;
}

function change(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("4.3a numberField", () => {
  test("4.3a numberField shows its label as visible text", () => {
    const field = attach(numberField("Line width", 2, () => {}));
    expect(field.textContent).toContain("Line width");
  });

  test("4.3a numberField ties its visible label to the input", () => {
    const field = attach(numberField("Line width", 2, () => {}));
    const input = numberInput(field, /line width/i);
    const labelFor = [...document.querySelectorAll("label")].some((l) => l.htmlFor === input.id && input.id !== "" && /line width/i.test(l.textContent ?? ""));
    const labelledby = (input.getAttribute("aria-labelledby") ?? "").split(/\s+/).some((id) => /line width/i.test(document.getElementById(id)?.textContent ?? ""));
    const wrapped = /line width/i.test(input.closest("label")?.textContent ?? "");
    expect(labelFor || labelledby || wrapped).toBe(true);
  });

  test("4.3a numberField shows the current value in its input", () => {
    const field = attach(numberField("Opacity", 0.4, () => {}));
    expect(Number(numberInput(field, /opacity/i).value)).toBe(0.4);
  });

  test("4.3a numberField shows an empty input for a null value", () => {
    const field = attach(numberField("Opacity", null, () => {}, { allowEmpty: true }));
    expect(numberInput(field, /opacity/i).value).toBe("");
  });

  test("4.3a numberField carries step, min and max on its input", () => {
    const field = attach(numberField("Opacity", 0.5, () => {}, { step: 0.1, min: 0, max: 1 }));
    const input = numberInput(field, /opacity/i);
    expect(input.getAttribute("step")).toBe("0.1");
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("1");
  });

  test("4.3a numberField reports a changed value once, as a number", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Font size", 12, onChange));
    change(numberInput(field, /font size/i), "14.5");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(14.5);
  });

  test("4.3a numberField does not report while typing (an input event without a change)", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Font size", 12, onChange));
    const input = numberInput(field, /font size/i);
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "14";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("4.3a numberField commits on Enter", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Font size", 12, onChange));
    const input = numberInput(field, /font size/i);
    input.value = "16";
    press(input, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(16);
  });

  test("4.3a numberField with allowEmpty reports null when cleared", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Opacity", 0.5, onChange, { allowEmpty: true }));
    change(numberInput(field, /opacity/i), "");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("4.3a colourField", () => {
  const swatches = (field: HTMLElement): HTMLElement[] => {
    const all = new Set<HTMLElement>([
      ...field.querySelectorAll<HTMLElement>("[title][aria-label]"),
      ...document.querySelectorAll<HTMLElement>('[role="menu"] [title][aria-label], [role="menuitem"][title][aria-label]'),
    ]);
    return [...all].filter((el) => !(el instanceof HTMLInputElement));
  };

  const hexInput = (field: HTMLElement): HTMLInputElement | undefined => {
    const find = (root: ParentNode): HTMLInputElement | undefined => controls(root, /hex|colou?r/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "text");
    const direct = find(field);
    if (direct !== undefined) return direct;
    controls(field, /./).find((el) => el.tagName === "BUTTON")?.click();
    return find(document);
  };

  test("4.3a colourField shows its label as visible text", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    expect(field.textContent).toContain("Colour");
  });

  test("4.3a colourField offers at least one named control carrying its label", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    expect(controls(field, /colou?r/i).length).toBeGreaterThan(0);
  });

  test("4.3a colourField offers every palette colour as a swatch with a title and an aria-label", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    controls(field, /./).find((el) => el.tagName === "BUTTON")?.click();
    const found = swatches(field);
    expect(found.length).toBeGreaterThanOrEqual(PALETTE.length);
    for (const el of found) {
      expect((el.getAttribute("title") ?? "").trim()).not.toBe("");
      expect((el.getAttribute("aria-label") ?? "").trim()).not.toBe("");
    }
  });

  test("4.3a colourField reports a palette colour when a swatch is chosen", () => {
    const onChange = jest.fn();
    const field = attach(colourField("Colour", "#000000", PALETTE, onChange));
    const seen = new Set<Element>();
    for (let i = 0; i < 30 && onChange.mock.calls.length === 0; i++) {
      const next = swatches(field).find((el) => !seen.has(el));
      if (next === undefined) break;
      seen.add(next);
      next.click();
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(PALETTE).toContain((onChange.mock.calls[0] as string[])[0]!.toLowerCase());
  });

  test("4.3a colourField reports a hex value typed in its hex field", () => {
    const onChange = jest.fn();
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, onChange));
    const hex = hexInput(field);
    expect(hex).toBeDefined();
    change(hex!, "#336699");
    expect(onChange).toHaveBeenLastCalledWith("#336699");
  });

  test("4.3a colourField shows the current value in its hex field", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    expect(hexInput(field)!.value.toLowerCase()).toBe("#4e79a7");
  });

  test("4.3a every control of a colour field has an accessible name", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    controls(field, /./).find((el) => el.tagName === "BUTTON")?.click();
    const unnamed = [...field.querySelectorAll<HTMLElement>("button, input, select")].filter((el) => nameOf(el) === "");
    expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
  });
});
