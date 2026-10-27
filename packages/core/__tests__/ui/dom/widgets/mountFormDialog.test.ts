/**
 * @jest-environment jsdom
 */
// Tests that mountFormDialog mounts a form with Cancel then the primary submit button and cleans up on every dismissal.
import { mountFormDialog } from "../../../../src/ui/dom/widgets/dialog";

afterEach(() => { document.body.innerHTML = ""; });

const makeForm = (): HTMLFormElement => {
  const form = document.createElement("form");
  form.className = "ls-dialog";
  return form;
};

describe("mountFormDialog", () => {
  it("appends Cancel first and the labelled primary submit button last, inside ls-dialog-actions", () => {
    const form = makeForm();
    mountFormDialog(form, { submitLabel: "Save" });
    const buttons = [...form.querySelectorAll<HTMLButtonElement>(".ls-dialog-actions > button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Save"]);
    expect(buttons.map((b) => b.type)).toEqual(["button", "submit"]);
    expect(buttons.map((b) => b.className)).toEqual(["ls-btn", "ls-btn ls-btn-primary"]);
    expect(document.body.contains(form)).toBe(true);
  });

  it("Cancel calls unsubscribe once and removes the overlay", () => {
    const form = makeForm();
    const unsubscribe = jest.fn();
    mountFormDialog(form, { submitLabel: "Add", unsubscribe });
    form.querySelector<HTMLButtonElement>(".ls-dialog-actions button")!.click();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(document.body.contains(form)).toBe(false);
    expect(document.querySelector(".ls-scrim")).toBeNull();
  });

  it("the returned close unsubscribes once and removes the overlay", () => {
    const form = makeForm();
    const unsubscribe = jest.fn();
    const close = mountFormDialog(form, { submitLabel: "Save", unsubscribe });
    close();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(document.body.contains(form)).toBe(false);
  });

  it("dismissal by Escape unsubscribes once and removes the overlay", () => {
    const form = makeForm();
    const unsubscribe = jest.fn();
    mountFormDialog(form, { submitLabel: "Save", unsubscribe });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(document.body.contains(form)).toBe(false);
  });

  it("an abort of the signal dismisses the dialog and unsubscribes once", () => {
    const form = makeForm();
    const unsubscribe = jest.fn();
    const controller = new AbortController();
    mountFormDialog(form, { submitLabel: "Save", unsubscribe, signal: controller.signal });
    controller.abort();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(document.body.contains(form)).toBe(false);
  });

  it("works without unsubscribe", () => {
    const form = makeForm();
    const close = mountFormDialog(form, { submitLabel: "Save" });
    expect(() => close()).not.toThrow();
    expect(document.body.contains(form)).toBe(false);
  });
});
