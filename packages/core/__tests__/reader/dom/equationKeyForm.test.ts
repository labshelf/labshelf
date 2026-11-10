/** @jest-environment jsdom */
// Checks the inline API key form of the equation card: opened in the card, saves the key then posts addAiKey, ignores an
// empty key and shows an error when the save fails.
import { createEquationPopover, type EquationPopover } from "../../../src/reader/dom/equationPopover";

const ANCHOR = { left: 120, top: 80, width: 200, height: 40 };

let popover: EquationPopover | undefined;
let container: HTMLElement;

const q = <T extends HTMLElement = HTMLElement>(sel: string) => container.querySelector<T>(sel);

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  popover?.close();
  popover = undefined;
  document.body.innerHTML = "";
});

describe("equation popover inline key form", () => {
  function setupWithForm(saveAiKey: (provider: "anthropic" | "openai", key: string) => Promise<void>) {
    document.body.innerHTML = '<div id="host"></div>';
    container = document.getElementById("host")!;
    const post = jest.fn();
    popover = createEquationPopover({ container, post, renderMath: async () => undefined, copyText: async () => undefined, saveAiKey });
    popover.open("req-k", ANCHOR);
    popover.result("req-k", { kind: "unavailable", offers: { pix2tex: "none", aiKey: true } });
    return { post, popover };
  }
  const submit = () => q<HTMLFormElement>("form.equation-key-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  it("6.3 with saveAiKey the key button opens a form in the card instead of posting", () => {
    const { post } = setupWithForm(jest.fn(async () => undefined));
    q<HTMLButtonElement>("button.equation-add-key")!.click();
    expect(post).not.toHaveBeenCalled();
    const form = q("form.equation-key-form")!;
    expect(q(".equation-card")!.contains(form)).toBe(true);
    const options = [...form.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Claude", "OpenAI"]);
    expect(form.querySelector<HTMLInputElement>("input.equation-key-input")!.type).toBe("password");
    expect(form.textContent).toContain("stays in this browser");
    expect(form.textContent).toContain("sent to the provider");
  });

  it("6.3 submitting saves the key, then posts addAiKey with the request id", async () => {
    const saveAiKey = jest.fn(async () => undefined);
    const { post } = setupWithForm(saveAiKey);
    q<HTMLButtonElement>("button.equation-add-key")!.click();
    q<HTMLSelectElement>("select.equation-key-provider")!.value = "openai";
    q<HTMLInputElement>("input.equation-key-input")!.value = "  sk-test  ";
    submit();
    await waitFor(() => post.mock.calls.length > 0);
    expect(saveAiKey).toHaveBeenCalledWith("openai", "sk-test");
    expect(post).toHaveBeenCalledWith({ type: "addAiKey", requestId: "req-k" });
  });

  it("6.3 an empty key saves nothing", async () => {
    const saveAiKey = jest.fn(async () => undefined);
    const { post } = setupWithForm(saveAiKey);
    q<HTMLButtonElement>("button.equation-add-key")!.click();
    submit();
    await settle();
    expect(saveAiKey).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("6.3 a failed save shows an error and posts nothing", async () => {
    const { post } = setupWithForm(jest.fn(async () => { throw new Error("quota"); }));
    q<HTMLButtonElement>("button.equation-add-key")!.click();
    q<HTMLInputElement>("input.equation-key-input")!.value = "sk-x";
    submit();
    await waitFor(() => (q(".equation-key-error")?.textContent ?? "") !== "");
    expect(post).not.toHaveBeenCalled();
    expect(q<HTMLButtonElement>("button.equation-key-save")!.disabled).toBe(false);
  });
});
