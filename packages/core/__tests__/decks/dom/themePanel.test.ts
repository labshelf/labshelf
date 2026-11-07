/** @jest-environment jsdom */
/**
 * Spec 6.2: the theme panel — mountThemePanel on its own (theme in, onChange out, the inputs it builds) and the Theme popover of
 * the deck shell around openDeckEditor (openDeckWorkspace: one Change theme change). jsdom does not load srcdoc frames, so a MutationObserver loads each srcdoc into its frame.
 * Editor helpers throw `not implemented: …` when the Theme control is absent, so a red run shows the behaviour is missing.
 */
import { setThemeProperty } from "../../../src/decks/themeCss";
import { openDeckWorkspace, type DeckEditorChange, type DeckEditorController } from "../../../src/decks/dom/openDeckEditor";
import { mountThemePanel } from "../../../src/decks/dom/themePanel";

const THEME = [":root {", "  --deck-bg: #ffffff;", "  --deck-accent: #f00;", '  --deck-font: "Inter", sans-serif;', "  --deck-gap: 24px;", "}", "h1 { color: var(--deck-accent); }", ""].join("\n");

const DECK = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  '<head>\n<meta charset="utf-8">\n<title>Talk</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
  "<body>",
  "<section data-slide>",
  '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
  "</section>",
  "<section data-slide>",
  '<div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Second.</p></div>',
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

// --- jsdom shims -------------------------------------------------------------------------------------------------------------------

const written = new WeakMap<HTMLIFrameElement, string>();
let observer: MutationObserver | undefined;

function loadSrcdocFrames(): void {
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    const srcdoc = frame.getAttribute("srcdoc");
    const doc = frame.contentDocument;
    if (srcdoc == null || !doc || written.get(frame) === srcdoc) continue;
    written.set(frame, srcdoc);
    doc.open();
    doc.write(srcdoc);
    doc.close();
    frame.dispatchEvent(new Event("load"));
  }
}

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
  el.hasPointerCapture ??= () => false;
  observer = new MutationObserver(loadSrcdocFrames);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["srcdoc"] });
});

afterAll(() => observer?.disconnect());

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    loadSrcdocFrames();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let panel: { readonly element: HTMLElement; update(theme: string): void; destroy(): void } | undefined;
let editor: DeckEditorController | undefined;

afterEach(() => {
  panel?.destroy();
  panel = undefined;
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = "";
});

function mountPanel(theme: string = THEME) {
  const host = document.createElement("div");
  document.body.append(host);
  const onChange = jest.fn<void, [string, string]>();
  panel = mountThemePanel(host, { theme, onChange });
  return { host, onChange };
}

function inputFor(root: ParentNode, name: string): HTMLInputElement {
  const found = Array.from(root.querySelectorAll<HTMLInputElement>("input")).find((i) => i.getAttribute("aria-label") === name);
  if (!found) throw new Error(`no input named "${name}"`);
  return found;
}
const inputs = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLInputElement>("input"));

function fire(input: HTMLInputElement, type: "input" | "change", value: string): void {
  input.value = value;
  input.dispatchEvent(new Event(type, { bubbles: true }));
}

// --- 6.2a panel ---------------------------------------------------------------------------------------------------------------------

describe("mountThemePanel", () => {
  it("6.2a has one input per :root custom property, named by the property", () => {
    const { host } = mountPanel();
    expect(inputs(host).map((i) => i.getAttribute("aria-label"))).toEqual(["--deck-bg", "--deck-accent", "--deck-font", "--deck-gap"]);
  });

  it("6.2a labels each row with the name without the leading --", () => {
    const { host } = mountPanel();
    const text = host.textContent ?? "";
    for (const label of ["deck-bg", "deck-accent", "deck-font", "deck-gap"]) expect(text).toContain(label);
    expect(text).not.toContain("--deck-");
  });

  it("6.2a hex values get colour inputs, 3-digit ones expanded, and other values text inputs", () => {
    const { host } = mountPanel();
    expect(inputFor(host, "--deck-bg").type).toBe("color");
    expect(inputFor(host, "--deck-bg").value).toBe("#ffffff");
    expect(inputFor(host, "--deck-accent").type).toBe("color");
    expect(inputFor(host, "--deck-accent").value).toBe("#ff0000");
    expect(inputFor(host, "--deck-font").type).toBe("text");
    expect(inputFor(host, "--deck-font").value).toBe('"Inter", sans-serif');
    expect(inputFor(host, "--deck-gap").type).toBe("text");
    expect(inputFor(host, "--deck-gap").value).toBe("24px");
  });

  it("6.2a a duplicated property gets one row with its last value", () => {
    const { host } = mountPanel(":root { --a: 1px; --b: 2px; --a: 3px; }\n");
    expect(inputs(host).map((i) => i.getAttribute("aria-label"))).toEqual(["--a", "--b"]);
    expect(inputFor(host, "--a").value).toBe("3px");
  });

  it("6.2a the change event calls onChange once with the name and the trimmed value; input does not", () => {
    const { host, onChange } = mountPanel();
    fire(inputFor(host, "--deck-gap"), "input", "32px");
    expect(onChange).not.toHaveBeenCalled();
    fire(inputFor(host, "--deck-gap"), "change", "  32px ");
    expect(onChange.mock.calls).toEqual([["--deck-gap", "32px"]]);
  });

  it("6.2a a colour change calls onChange with the colour", () => {
    const { host, onChange } = mountPanel();
    fire(inputFor(host, "--deck-bg"), "change", "#123456");
    expect(onChange.mock.calls).toEqual([["--deck-bg", "#123456"]]);
  });

  it("6.2a an empty value does not call onChange", () => {
    const { host, onChange } = mountPanel();
    fire(inputFor(host, "--deck-font"), "change", "   ");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("6.2a without custom properties it says so", () => {
    const { host } = mountPanel("body { color: red; }\n");
    expect(inputs(host)).toHaveLength(0);
    expect(host.textContent).toContain("theme.css has no custom properties in its :root rule.");
  });

  it("6.2a update re-renders the rows for the new theme", () => {
    const { host } = mountPanel();
    panel!.update(":root { --only: 4px; }\n");
    expect(inputs(host).map((i) => i.getAttribute("aria-label"))).toEqual(["--only"]);
  });
});

// --- 6.2a editor --------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor Theme popover", () => {
  async function open() {
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = jest.fn<void, [DeckEditorChange]>();
    editor = openDeckWorkspace(host, { title: "Talk", html: DECK, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, onChange });
    await settle();
    return { host, onChange };
  }
  function toolButton(host: HTMLElement, label: string): HTMLButtonElement {
    const bar = host.querySelector<HTMLElement>("[role='toolbar'][aria-label='Insert']");
    const found = Array.from(bar?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.getAttribute("aria-label") === label);
    if (!found) throw new Error(`not implemented: the Insert toolbar has no button named "${label}"`);
    return found;
  }

  it("6.2a a theme change gives one Change theme change with only that value changed in theme.css", async () => {
    const { host, onChange } = await open();
    toolButton(host, "Theme").click();
    await settle();
    fire(inputFor(document, "--deck-gap"), "change", "40px");
    await settle();
    expect(onChange.mock.calls.map(([c]) => c)).toEqual([{ html: DECK, theme: setThemeProperty(THEME, "--deck-gap", "40px"), label: "Change theme" }]);
  });
});
