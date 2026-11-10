/** @jest-environment jsdom */
// Checks the card the equation popover shows when nothing could read the equation: its explanation, the buttons for every
// offers combination and the messages the buttons post.
import { createEquationPopover, type EquationPopover } from "../../../src/reader/dom/equationPopover";

type Offers = { pix2tex: "install" | "installHelper" | "none"; aiKey: boolean };

const ANCHOR = { left: 120, top: 80, width: 200, height: 40 };
const unavailable = (pix2tex: Offers["pix2tex"], aiKey: boolean) => ({ kind: "unavailable" as const, offers: { pix2tex, aiKey } });

let popover: EquationPopover | undefined;
let container: HTMLElement;

function setup() {
  document.body.innerHTML = '<div id="host"></div>';
  container = document.getElementById("host")!;
  const post = jest.fn();
  popover = createEquationPopover({ container, post, renderMath: async () => undefined, copyText: async () => undefined });
  return { post, popover };
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const buttonText = (sel: string) => q<HTMLButtonElement>(sel)?.textContent ?? "";

afterEach(() => {
  popover?.close();
  popover = undefined;
  document.body.innerHTML = "";
});

describe("equation popover card", () => {
  it("2.3a unavailable shows the card with the explanation and no field", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("install", true));
    const card = q(".equation-card")!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Could not read this equation");
    expect(card.textContent).toContain("no arXiv source");
    expect(q(".equation-progress")).toBeNull();
    expect(q("textarea.equation-latex")).toBeNull();
    expect(q("button.equation-copy")).toBeNull();
  });

  it("2.3a unavailable with install offer and key shows both buttons, the first reading Download pix2tex", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("install", true));
    expect(buttonText("button.equation-install")).toContain("Download pix2tex");
    expect(q("button.equation-add-key")).not.toBeNull();
  });

  it("2.3a unavailable with install offer and no key shows only the install button", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("install", false));
    expect(buttonText("button.equation-install")).toContain("Download pix2tex");
    expect(q("button.equation-add-key")).toBeNull();
  });

  it("2.3a unavailable with helper offer and key shows Install LabShelf Helper and the key button", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("installHelper", true));
    expect(buttonText("button.equation-install")).toContain("Install LabShelf Helper");
    expect(buttonText("button.equation-install")).not.toContain("Download pix2tex");
    expect(q("button.equation-add-key")).not.toBeNull();
  });

  it("2.3a unavailable with helper offer and no key shows only the helper button", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("installHelper", false));
    expect(buttonText("button.equation-install")).toContain("Install LabShelf Helper");
    expect(q("button.equation-add-key")).toBeNull();
  });

  it("2.3a unavailable with no pix2tex offer and a key hides the install button and shows the key button", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("none", true));
    expect(q("button.equation-install")).toBeNull();
    expect(q("button.equation-add-key")).not.toBeNull();
    expect(q(".equation-card")).not.toBeNull();
  });

  it("2.3a unavailable with nothing to offer shows the card without buttons", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("none", false));
    expect(q(".equation-card")!.textContent).toContain("Could not read this equation");
    expect(q("button.equation-install")).toBeNull();
    expect(q("button.equation-add-key")).toBeNull();
  });

  it("2.3a the install button posts installPix2tex with the request id", () => {
    const { popover: p, post } = setup();
    p.open("req-7", ANCHOR);
    p.result("req-7", unavailable("install", true));
    q<HTMLButtonElement>("button.equation-install")!.click();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "installPix2tex", requestId: "req-7" });
  });

  it("2.3a the helper button also posts installPix2tex with the request id", () => {
    const { popover: p, post } = setup();
    p.open("req-8", ANCHOR);
    p.result("req-8", unavailable("installHelper", false));
    q<HTMLButtonElement>("button.equation-install")!.click();
    expect(post).toHaveBeenCalledWith({ type: "installPix2tex", requestId: "req-8" });
  });

  it("2.3a the key button posts addAiKey with the request id", () => {
    const { popover: p, post } = setup();
    p.open("req-9", ANCHOR);
    p.result("req-9", unavailable("none", true));
    q<HTMLButtonElement>("button.equation-add-key")!.click();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "addAiKey", requestId: "req-9" });
  });

});
