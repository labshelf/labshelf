/** @jest-environment jsdom */
/**
 * Spec 9.1 (9.1d, A9): rich text inside an open text leaf of the HTML deck editor, tested through the public seam of openDeckWorkspace: the frame document's leaf, its selection and keys,
 * the floating bar (toolbar "Selected block") and properties buttons, and the changes handed to onChange. The harness is the one of openDeckEditor.test.ts (jsdom srcdoc shim, no layout).
 */
import { DECK, THEME, deck, settle, open, box, select, frameDoc, pointer, key, MOD, host, editor, lastChange, changes, toolbar } from "./openDeckEditorHarness";

const RICH = deck(
  [
    '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
    '<div data-block="rich" style="left: 240px; top: 400px; width: 800px; height: 160px;"><p>Hello <b>bold</b> world</p></div>',
  ].join("\n"),
);

const leafOf = (id: string, tag: string): HTMLElement => frameDoc().querySelector<HTMLElement>(`[data-block="${id}"] ${tag}`)!;
const titleLeaf = (): HTMLElement => leafOf("title", "h1");

/** Selects the block, double-clicks it and returns its open leaf. */
async function openLeaf(id = "title", tag = "h1", html?: string) {
  const onChange = await open(html);
  await select(id);
  pointer("dblclick", box(id), 200, 150);
  await settle();
  const leaf = leafOf(id, tag);
  expect(leaf.getAttribute("contenteditable")).toBe("true");
  return { onChange, leaf };
}

/** Selects the first occurrence of `needle` inside the leaf, in the frame document (the leaf's text must hold it in one text node). */
function selectText(leaf: HTMLElement, needle: string): void {
  const doc = leaf.ownerDocument;
  const walker = doc.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n.nodeValue ?? "").indexOf(needle);
    if (at < 0) continue;
    const range = doc.createRange();
    range.setStart(n, at);
    range.setEnd(n, at + needle.length);
    const selection = doc.defaultView!.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  throw new Error(`no text node holds ${JSON.stringify(needle)}`);
}

/** Puts a collapsed caret at the end of the leaf's last text node. */
function caretAtEnd(leaf: HTMLElement): void {
  const doc = leaf.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(leaf);
  range.collapse(false);
  const selection = doc.defaultView!.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const bar = (): HTMLElement => toolbar("Selected block")!;
const inBar = (label: string): HTMLButtonElement => {
  const found = bar().querySelector<HTMLButtonElement>(`button[aria-label='${label}'], button[title='${label}']`);
  if (!found) throw new Error(`no floating bar button "${label}"`);
  return found;
};
const linkButton = (): HTMLButtonElement => inBar("Link (Mod+K)");
const linkInput = (): HTMLInputElement | null => bar().querySelector<HTMLInputElement>("input:not([type='number']):not([type='color'])");

async function enterLeaf(leaf: HTMLElement): Promise<void> {
  key(leaf, "Enter");
  await settle();
}

const editTextChanges = (onChange: Parameters<typeof changes>[0]) => changes(onChange).filter((c) => c.label === "Edit text");

// --- 9.1d: editing keeps inline markup ------------------------------------------------------------------------------------------------

describe("leaf editing keeps inline markup", () => {
  it("9.1d editing a leaf that holds <b> keeps the <b> on commit", async () => {
    const { onChange, leaf } = await openLeaf("rich", "p", RICH);
    leaf.appendChild(leaf.ownerDocument.createTextNode(" again"));
    await enterLeaf(leaf);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).label).toBe("Edit text");
    expect(lastChange(onChange).html).toContain("<p>Hello <b>bold</b> world again</p>");
  });

  it("9.1d opening and closing a leaf that holds <b> without a change commits nothing", async () => {
    const { onChange, leaf } = await openLeaf("rich", "p", RICH);
    await enterLeaf(leaf);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.1d a leaf with only text and line breaks still commits as plain text", async () => {
    const { onChange, leaf } = await openLeaf();
    leaf.textContent = "A & B";
    await enterLeaf(leaf);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).label).toBe("Edit text");
    expect(lastChange(onChange).html).toBe(DECK.replace("<h1>Title</h1>", "<h1>A &amp; B</h1>"));
  });

  it("9.1d a plain text commit writes a line break as <br> as before", async () => {
    const { onChange, leaf } = await openLeaf();
    leaf.innerHTML = "one<br>two";
    await enterLeaf(leaf);
    expect(lastChange(onChange).html).toBe(DECK.replace("<h1>Title</h1>", "<h1>one<br>two</h1>"));
  });
});

// --- 9.1d: keys ---------------------------------------------------------------------------------------------------------------------

describe("leaf editing formatting keys", () => {
  it("9.1d Mod+B on a selection then Enter commits one Edit text change with <b> around the selected text", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    key(leaf, "b", MOD);
    expect(onChange).not.toHaveBeenCalled();
    await enterLeaf(titleLeaf());
    expect(editTextChanges(onChange)).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).html).toBe(DECK.replace("<h1>Title</h1>", "<h1>T<b>itl</b>e</h1>"));
  });

  it("9.1d the formatting commit is one undo step that restores the original deck", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    key(leaf, "b", MOD);
    await enterLeaf(titleLeaf());
    editor!.undo();
    await settle();
    expect(lastChange(onChange)).toEqual({ html: DECK, theme: THEME, label: "Undo" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("9.1d Mod+B stays inside the leaf: the key does not bold the whole block", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    key(leaf, "b", MOD);
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).not.toContain("font-weight");
  });

  it("9.1d Mod+I wraps the selection in <i>", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    key(leaf, "i", MOD);
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain("<h1>T<i>itl</i>e</h1>");
  });

  it("9.1d Mod+U wraps the selection in <u>", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    key(leaf, "u", MOD);
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain("<h1>T<u>itl</u>e</h1>");
  });

  it("9.1d Mod+B on an already bold selection removes the <b>, a formatting-only change that commits", async () => {
    const { onChange, leaf } = await openLeaf("rich", "p", RICH);
    selectText(leaf, "bold");
    key(leaf, "b", MOD);
    await enterLeaf(leafOf("rich", "p"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).html).toContain("<p>Hello bold world</p>");
  });

  it("9.1d Mod+B with a collapsed caret changes nothing and commits nothing", async () => {
    const { onChange, leaf } = await openLeaf();
    caretAtEnd(leaf);
    key(leaf, "b", MOD);
    await enterLeaf(titleLeaf());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.1d Mod+K opens the link input in the floating bar", async () => {
    const { leaf } = await openLeaf();
    selectText(leaf, "itl");
    expect(linkInput()).toBeNull();
    key(leaf, "k", MOD);
    await settle();
    expect(linkInput()).not.toBeNull();
  });
});

// --- 9.1d: paste --------------------------------------------------------------------------------------------------------------------

describe("leaf editing paste", () => {
  function pasteInto(leaf: HTMLElement, plain: string, html: string): Event {
    const view = leaf.ownerDocument.defaultView!;
    const event = new view.Event("paste", { bubbles: true, cancelable: true });
    const data: Record<string, string> = { "text/plain": plain, "text/html": html, Text: plain };
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => data[type] ?? "", types: Object.keys(data) } });
    leaf.dispatchEvent(event);
    return event;
  }

  it("9.1d paste inside an open leaf inserts the plain text only", async () => {
    const { leaf } = await openLeaf();
    caretAtEnd(leaf);
    const event = pasteInto(leaf, "pasted", "<b>rich</b> <script>alert(1)</script>");
    expect(event.defaultPrevented).toBe(true);
    expect(titleLeaf().textContent).toBe("Titlepasted");
    expect(titleLeaf().querySelector("b, script")).toBeNull();
  });

  it("9.1d pasted text that looks like markup stays text and commits escaped", async () => {
    const { onChange, leaf } = await openLeaf();
    caretAtEnd(leaf);
    pasteInto(leaf, "<b>x</b>", "<b>x</b>");
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain("<h1>Title&lt;b&gt;x&lt;/b&gt;</h1>");
  });
});

// --- 9.1d: floating bar and properties ----------------------------------------------------------------------------------------------

describe("selection formatting from the bar", () => {
  it("9.1d the floating bar stays visible while a leaf is open", async () => {
    await openLeaf();
    expect(bar().hidden).toBe(false);
  });

  it("9.1d the Bold button formats the selection and the leaf stays open with nothing committed", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    inBar("Bold").click();
    await settle();
    expect(titleLeaf().getAttribute("contenteditable")).toBe("true");
    expect(titleLeaf().innerHTML).toBe("T<b>itl</b>e");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.1d the formatted selection commits as one Edit text change when the leaf closes", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    inBar("Bold").click();
    await settle();
    await enterLeaf(titleLeaf());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).label).toBe("Edit text");
    expect(lastChange(onChange).html).toContain("<h1>T<b>itl</b>e</h1>");
  });

  it("9.1d the bar buttons keep the selection: mousedown on Bold is default-prevented", async () => {
    const { leaf } = await openLeaf();
    selectText(leaf, "itl");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    inBar("Bold").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it.each([["Italic", "i"], ["Underline", "u"], ["Strikethrough", "s"]] as const)("9.1d the %s button wraps the selection in <%s>", async (label, tag) => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    inBar(label).click();
    await settle();
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain(`<h1>T<${tag}>itl</${tag}>e</h1>`);
  });

  it("9.1d the Text colour control colours the selection in a span", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    const colour = bar().querySelector<HTMLInputElement>("input[type='color']")!;
    colour.value = "#ff0000";
    colour.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain('<h1>T<span style="color: #ff0000">itl</span>e</h1>');
  });

  it("9.1d the properties Bold button formats the selection too and the leaf stays open", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    const panelBold = Array.from(host.querySelectorAll<HTMLButtonElement>("button[aria-label='Bold']")).find((b) => !bar().contains(b));
    if (!panelBold) throw new Error("no Bold button outside the floating bar (properties panel)");
    panelBold.click();
    await settle();
    expect(titleLeaf().getAttribute("contenteditable")).toBe("true");
    expect(titleLeaf().innerHTML).toBe("T<b>itl</b>e");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.1d without an open leaf the Bold button still acts on the whole block", async () => {
    const onChange = await open();
    await select("title");
    inBar("Bold").click();
    await settle();
    expect(lastChange(onChange).label).toBe("Bold");
    expect(lastChange(onChange).html).toMatch(/data-block="title"[^>]*font-weight: 700/);
    expect(lastChange(onChange).html).toContain("<h1>Title</h1>");
  });
});

// --- 9.1d: link input ---------------------------------------------------------------------------------------------------------------

describe("the Link button and input", () => {
  it("9.1d the floating bar has a Link button titled 'Link (Mod+K)' while a leaf is open", async () => {
    await openLeaf();
    expect(linkButton().getAttribute("title")).toBe("Link (Mod+K)");
  });

  it("9.1d the Link button opens an in-page input and never calls window.prompt", async () => {
    const prompt = jest.spyOn(window, "prompt").mockImplementation(() => null);
    const { leaf } = await openLeaf();
    selectText(leaf, "itl");
    linkButton().click();
    await settle();
    expect(linkInput()).not.toBeNull();
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("9.1d Enter in the input applies a safe href around the selection", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    linkButton().click();
    await settle();
    const input = linkInput()!;
    input.value = "https://example.com";
    key(input, "Enter");
    await settle();
    expect(titleLeaf().innerHTML).toBe('T<a href="https://example.com">itl</a>e');
    expect(titleLeaf().getAttribute("contenteditable")).toBe("true");
    await enterLeaf(titleLeaf());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).html).toContain('<h1>T<a href="https://example.com">itl</a>e</h1>');
  });

  it("9.1d an invalid URL shows 'Use an http, https or mailto link' and applies nothing", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    linkButton().click();
    await settle();
    const input = linkInput()!;
    input.value = "javascript:alert(1)";
    key(input, "Enter");
    await settle();
    expect(bar().textContent).toContain("Use an http, https or mailto link");
    expect(titleLeaf().innerHTML).toBe("Title");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.1d an empty value removes the link around the selection", async () => {
    const { leaf } = await openLeaf("rich", "p", deck(['<div data-block="rich" style="left: 240px; top: 400px; width: 800px; height: 160px;"><p>See <a href="https://example.com">the docs</a> now</p></div>'].join("\n")));
    selectText(leaf, "docs");
    key(leaf, "k", MOD);
    await settle();
    const input = linkInput()!;
    expect(input.value).toBe("https://example.com");
    input.value = "";
    key(input, "Enter");
    await settle();
    expect(leafOf("rich", "p").innerHTML).toBe("See the docs now");
  });

  it("9.1d Escape closes the input and returns to the leaf without applying", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    linkButton().click();
    await settle();
    const input = linkInput()!;
    input.value = "https://example.com";
    key(input, "Escape");
    await settle();
    expect(linkInput()).toBeNull();
    expect(titleLeaf().getAttribute("contenteditable")).toBe("true");
    expect(titleLeaf().innerHTML).toBe("Title");
    expect(onChange).not.toHaveBeenCalled();
  });
});

// --- A9: bold, italic, colour and links apply to a selection inside a text block ---------------------------------------------------------

describe("A9 rich text in a text block", () => {
  it("A9 bold applies to a selection inside a text block", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "itl");
    key(leaf, "b", MOD);
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain("<h1>T<b>itl</b>e</h1>");
  });

  it("A9 italic applies to a selection inside a text block", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "Tit");
    inBar("Italic").click();
    await settle();
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain("<h1><i>Tit</i>le</h1>");
  });

  it("A9 colour applies to a selection inside a text block", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "tle");
    const colour = bar().querySelector<HTMLInputElement>("input[type='color']")!;
    colour.value = "#0000ff";
    colour.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain('<h1>Ti<span style="color: #0000ff">tle</span></h1>');
  });

  it("A9 a link applies to a selection inside a text block", async () => {
    const { onChange, leaf } = await openLeaf();
    selectText(leaf, "Title");
    linkButton().click();
    await settle();
    const input = linkInput()!;
    input.value = "mailto:a@b.co";
    key(input, "Enter");
    await settle();
    await enterLeaf(titleLeaf());
    expect(lastChange(onChange).html).toContain('<h1><a href="mailto:a@b.co">Title</a></h1>');
  });

  it("A9 the committed deck stays free of unsafe markup", async () => {
    const { onChange, leaf } = await openLeaf();
    leaf.innerHTML = 'Hi <b onclick="boom()">there</b><script>alert(1)</script><a href="javascript:alert(1)">x</a>';
    await enterLeaf(leaf);
    const html = lastChange(onChange).html;
    expect(html).toContain("<h1>Hi <b>there</b>x</h1>");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });
});
