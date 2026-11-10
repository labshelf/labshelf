/** @jest-environment jsdom */
// Checks the equation popover: progress, latex, unavailable card (every offers combination) and failed states, live re-render on edit with
// stale renders ignored, Copy LaTeX copying the field's current text, one popover at a time, replies for other requests ignored, and
// closing on Escape or an outside click.
import { createEquationPopover, type EquationPopover } from "../../../src/reader/dom/equationPopover";

type Outcome =
  | { kind: "latex"; latex: string; source: "arxiv" | "pix2tex" | "ai"; provider?: string; number?: string; label?: string }
  | { kind: "unavailable"; offers: { pix2tex: "install" | "installHelper" | "none"; aiKey: boolean } }
  | { kind: "failed"; reason: string };

const ANCHOR = { left: 120, top: 80, width: 200, height: 40 };
const latex = (l: string, extra: Partial<Extract<Outcome, { kind: "latex" }>> = {}): Outcome => ({ kind: "latex", latex: l, source: "arxiv", ...extra });
const unavailable = (pix2tex: "install" | "installHelper" | "none", aiKey: boolean): Outcome => ({ kind: "unavailable", offers: { pix2tex, aiKey } });

interface RenderCall { target: HTMLElement; latex: string; resolve: () => void; reject: (e: Error) => void }

let popover: EquationPopover | undefined;
let container: HTMLElement;

/** renderMath fake: writes the latex into its target as text, immediately (auto) or when the test resolves the call (manual). */
function setup(mode: "auto" | "manual" = "auto") {
  document.body.innerHTML = '<div id="host"></div>';
  container = document.getElementById("host")!;
  const post = jest.fn();
  const copyText = jest.fn(async (_text: string) => undefined);
  const calls: RenderCall[] = [];
  const renderMath = jest.fn((target: HTMLElement, l: string) => {
    if (mode === "auto") {
      target.textContent = l;
      return Promise.resolve();
    }
    return new Promise<void>((res, rej) => {
      calls.push({ target, latex: l, resolve: () => { target.textContent = l; res(); }, reject: rej });
    });
  });
  popover = createEquationPopover({ container, post, renderMath, copyText });
  return { post, copyText, renderMath, calls, popover };
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const root = () => q(".equation-popover");
const field = () => q<HTMLTextAreaElement>("textarea.equation-latex")!;
const rendered = () => q(".equation-render")!;
const buttonText = (sel: string) => q<HTMLButtonElement>(sel)?.textContent ?? "";

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function typeInto(value: string): void {
  const input = field();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  popover?.close();
  popover = undefined;
  document.body.innerHTML = "";
});

describe("2.3a states", () => {
  it("2.3a open shows the popover with a progress state inside the container", () => {
    const { popover: p } = setup();
    expect(p.isOpen).toBe(false);
    p.open("r1", ANCHOR);
    expect(p.isOpen).toBe(true);
    expect(container.contains(root())).toBe(true);
    expect(q(".equation-progress")).not.toBeNull();
    expect(q("textarea.equation-latex")).toBeNull();
    expect(q(".equation-card")).toBeNull();
    expect(q(".equation-error")).toBeNull();
  });

  it("2.3a progress shows the latest message for the open request", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.progress("r1", "Reading the arXiv source", 0.25);
    expect(q(".equation-progress")!.textContent).toContain("Reading the arXiv source");
    p.progress("r1", "Running pix2tex");
    expect(q(".equation-progress")!.textContent).toContain("Running pix2tex");
    expect(q(".equation-progress")!.textContent).not.toContain("Reading the arXiv source");
  });

  it("2.3a latex result shows an editable field holding the LaTeX and the render target", async () => {
    const { popover: p, renderMath } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("\\frac{a}{b}"));
    expect(field().value).toBe("\\frac{a}{b}");
    expect(field().readOnly).toBe(false);
    expect(field().disabled).toBe(false);
    await waitFor(() => renderMath.mock.calls.length > 0);
    const target = renderMath.mock.calls[0][0];
    expect(rendered().contains(target) || rendered() === target).toBe(true);
    expect(renderMath.mock.calls[0][1]).toBe("\\frac{a}{b}");
    await waitFor(() => (rendered().textContent ?? "").includes("\\frac{a}{b}"));
  });

  it("2.3a latex result replaces the progress state and shows the Copy button", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("x^2"));
    expect(q(".equation-progress")).toBeNull();
    expect(q(".equation-card")).toBeNull();
    expect(q(".equation-error")).toBeNull();
    expect(q("button.equation-copy")).not.toBeNull();
    expect(buttonText("button.equation-copy")).toMatch(/copy/i);
  });

  it("2.3a arXiv source line names the source, number and label", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("L", { source: "arxiv", number: "3", label: "eq:loss" }));
    expect(q(".equation-source")!.textContent).toContain("From the arXiv source · Eq. (3) · eq:loss");
  });

  it("2.3a arXiv source line without number or label still names the source", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("L", { source: "arxiv" }));
    const text = q(".equation-source")!.textContent!;
    expect(text).toContain("From the arXiv source");
    expect(text).not.toContain("Eq.");
    expect(text).not.toContain("undefined");
  });

  it("2.3a pix2tex source line asks the reader to check it", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("L", { source: "pix2tex" }));
    expect(q(".equation-source")!.textContent).toContain("Read by pix2tex — check it");
  });

  it("2.3a AI source line names Claude for the Anthropic provider", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("L", { source: "ai", provider: "anthropic" }));
    expect(q(".equation-source")!.textContent).toContain("Read by Claude — check it");
  });

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

  it("2.3a progress after a card action replaces the card body", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("install", true));
    q<HTMLButtonElement>("button.equation-install")!.click();
    p.progress("r1", "Downloading pix2tex", 0.4);
    expect(q(".equation-progress")!.textContent).toContain("Downloading pix2tex");
    expect(q("button.equation-install")).toBeNull();
    expect(q("button.equation-add-key")).toBeNull();
  });

  it("2.3a a latex result after the install progress shows the field", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("install", true));
    p.progress("r1", "Downloading pix2tex");
    p.result("r1", latex("E=mc^2", { source: "pix2tex" }));
    expect(q(".equation-progress")).toBeNull();
    expect(field().value).toBe("E=mc^2");
  });

  it("2.3a failed shows the reason and no field or card", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", { kind: "failed", reason: "pix2tex timed out after 60 s" });
    expect(q(".equation-error")!.textContent).toContain("pix2tex timed out after 60 s");
    expect(q(".equation-progress")).toBeNull();
    expect(q("textarea.equation-latex")).toBeNull();
    expect(q(".equation-card")).toBeNull();
  });

  it("2.3a keeps the reason as text, not markup", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", { kind: "failed", reason: "<img src=x onerror=alert(1)>" });
    expect(q(".equation-error")!.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(q(".equation-error img")).toBeNull();
  });

  it("2.3a the controls are real buttons and the field a textarea, so the keyboard reaches them", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("x"));
    expect(q("button.equation-copy")!.tagName).toBe("BUTTON");
    expect(field().tagName).toBe("TEXTAREA");
    expect(field().tabIndex).toBeGreaterThanOrEqual(0);
    expect(q<HTMLButtonElement>("button.equation-copy")!.tabIndex).toBeGreaterThanOrEqual(0);
  });
});

describe("2.3b interaction", () => {
  it("2.3b editing the field re-renders the new LaTeX", async () => {
    const { popover: p, renderMath } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("a+b"));
    await waitFor(() => renderMath.mock.calls.length >= 1);
    typeInto("a+b+c");
    await waitFor(() => renderMath.mock.calls.some((c) => c[1] === "a+b+c"));
    await waitFor(() => (rendered().textContent ?? "").includes("a+b+c"));
  });

  it("2.3b a render that finishes late for older text is ignored", async () => {
    const { popover: p, calls } = setup("manual");
    p.open("r1", ANCHOR);
    p.result("r1", latex("old"));
    await waitFor(() => calls.length >= 1);
    typeInto("new");
    await waitFor(() => calls.some((c) => c.latex === "new"));
    const newest = calls.find((c) => c.latex === "new")!;
    const oldest = calls.find((c) => c.latex === "old")!;
    newest.resolve();
    oldest.resolve();
    await settle();
    expect(rendered().textContent).toContain("new");
    expect(rendered().textContent).not.toContain("old");
  });

  it("2.3b a render that finishes after the popover moved to another request is ignored", async () => {
    const { popover: p, calls } = setup("manual");
    p.open("r1", ANCHOR);
    p.result("r1", latex("first"));
    await waitFor(() => calls.length >= 1);
    const stale = calls[0];
    p.open("r2", ANCHOR);
    p.result("r2", latex("second"));
    await waitFor(() => calls.some((c) => c.latex === "second"));
    calls.find((c) => c.latex === "second")!.resolve();
    stale.resolve();
    await settle();
    expect(field().value).toBe("second");
    expect(rendered().textContent).toContain("second");
    expect(rendered().textContent).not.toContain("first");
  });

  it("2.3b a render that fails leaves the popover open and the field editable", async () => {
    const { popover: p, calls } = setup("manual");
    p.open("r1", ANCHOR);
    p.result("r1", latex("\\bad{"));
    await waitFor(() => calls.length >= 1);
    calls[0].reject(new Error("MathJax: bad LaTeX"));
    await settle();
    expect(p.isOpen).toBe(true);
    expect(field().value).toBe("\\bad{");
    typeInto("\\good");
    await waitFor(() => calls.some((c) => c.latex === "\\good"));
  });

  it("2.3b Copy LaTeX copies the original text when the field is untouched", async () => {
    const { popover: p, copyText } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("\\alpha+\\beta"));
    q<HTMLButtonElement>("button.equation-copy")!.click();
    await waitFor(() => copyText.mock.calls.length > 0);
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith("\\alpha+\\beta");
  });

  it("2.3b Copy LaTeX copies the edited text", async () => {
    const { popover: p, copyText } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("\\alpha+\\beta"));
    typeInto("\\alpha+\\gamma");
    q<HTMLButtonElement>("button.equation-copy")!.click();
    await waitFor(() => copyText.mock.calls.length > 0);
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith("\\alpha+\\gamma");
  });

  it("2.3b Copy right after an edit copies the new text even before the re-render finishes", async () => {
    const { popover: p, copyText, calls } = setup("manual");
    p.open("r1", ANCHOR);
    p.result("r1", latex("one"));
    await waitFor(() => calls.length >= 1);
    typeInto("two");
    q<HTMLButtonElement>("button.equation-copy")!.click();
    await waitFor(() => copyText.mock.calls.length > 0);
    expect(copyText).toHaveBeenCalledWith("two");
  });

  it("2.3b a failing clipboard write does not break the popover", async () => {
    const { popover: p, copyText } = setup();
    copyText.mockRejectedValueOnce(new Error("clipboard denied"));
    p.open("r1", ANCHOR);
    p.result("r1", latex("x"));
    q<HTMLButtonElement>("button.equation-copy")!.click();
    await waitFor(() => copyText.mock.calls.length > 0);
    await settle();
    expect(p.isOpen).toBe(true);
    expect(field().value).toBe("x");
  });

  it("2.3b Escape on the document closes the popover and removes it", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("x"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(p.isOpen).toBe(false);
    expect(root()).toBeNull();
  });

  it("2.3b Escape pressed in the field closes the popover", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("x"));
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(p.isOpen).toBe(false);
  });

  it("2.3b Escape closes the popover while it is still showing progress", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(p.isOpen).toBe(false);
    expect(root()).toBeNull();
  });

  it("2.3b other keys leave the popover open", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("x"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(p.isOpen).toBe(true);
    expect(root()).not.toBeNull();
  });

  it("2.3b close removes the popover and later replies do not bring it back", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.close();
    expect(p.isOpen).toBe(false);
    expect(root()).toBeNull();
    p.progress("r1", "late");
    p.result("r1", latex("late"));
    expect(p.isOpen).toBe(false);
    expect(root()).toBeNull();
  });

  it("2.3b close without an open popover does nothing", () => {
    const { popover: p } = setup();
    expect(() => p.close()).not.toThrow();
    expect(p.isOpen).toBe(false);
  });

  it("2.3b a click outside closes the popover", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("x"));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      outside.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    expect(p.isOpen).toBe(false);
    expect(root()).toBeNull();
  });

  it("2.3b a click inside the popover keeps it open", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("x"));
    const inside = field();
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      inside.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    expect(p.isOpen).toBe(true);
    expect(root()).not.toBeNull();
  });

  it("2.3b opening a new box replaces the popover: only one at a time", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", latex("first"));
    p.open("r2", { left: 10, top: 10, width: 50, height: 20 });
    expect(container.querySelectorAll(".equation-popover")).toHaveLength(1);
    expect(p.isOpen).toBe(true);
    expect(q(".equation-progress")).not.toBeNull();
    expect(q("textarea.equation-latex")).toBeNull();
  });

  it("2.3b a reply for the earlier request is ignored after a new box opened", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.open("r2", ANCHOR);
    p.result("r1", latex("from the first box"));
    expect(q("textarea.equation-latex")).toBeNull();
    expect(q(".equation-progress")).not.toBeNull();
    p.result("r2", latex("from the second box"));
    expect(field().value).toBe("from the second box");
  });

  it("2.3b progress for another request id is ignored", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.progress("r1", "mine");
    p.progress("other", "someone else's");
    expect(q(".equation-progress")!.textContent).toContain("mine");
    expect(q(".equation-progress")!.textContent).not.toContain("someone else's");
  });

  it("2.3b a result for an unknown request id changes nothing", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.result("nope", { kind: "failed", reason: "not for this popover" });
    expect(q(".equation-error")).toBeNull();
    expect(q(".equation-progress")).not.toBeNull();
  });

  it("2.3b a card action after a newer box opened does not post for the old request", () => {
    const { popover: p, post } = setup();
    p.open("r1", ANCHOR);
    p.result("r1", unavailable("install", true));
    const staleButton = q<HTMLButtonElement>("button.equation-install")!;
    p.open("r2", ANCHOR);
    p.result("r2", unavailable("install", true));
    q<HTMLButtonElement>("button.equation-install")!.click();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "installPix2tex", requestId: "r2" });
    staleButton.click();
    expect(post).not.toHaveBeenCalledWith({ type: "installPix2tex", requestId: "r1" });
  });

  it("2.3b the popover can be reopened after closing", () => {
    const { popover: p } = setup();
    p.open("r1", ANCHOR);
    p.close();
    p.open("r2", ANCHOR);
    p.result("r2", latex("again"));
    expect(p.isOpen).toBe(true);
    expect(field().value).toBe("again");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(p.isOpen).toBe(false);
  });
});
