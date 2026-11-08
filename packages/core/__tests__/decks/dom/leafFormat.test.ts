/** @jest-environment jsdom */
/**
 * Spec 9.1 (9.1c): toggleLeafMark, setLeafColor and setLeafLink format the frame selection when it lies wholly inside one leaf, and leafInlineHtml serialises the leaf.
 * The tests build a leaf in the jsdom document, select text with a Range on document.getSelection(), call the seam and read the leaf's innerHTML and the selection back.
 */
import { toggleLeafMark, setLeafColor, setLeafLink, leafInlineHtml } from "../../../src/decks/dom/leafFormat";

let block: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  block = document.createElement("div");
  block.setAttribute("data-block", "b");
  document.body.appendChild(block);
});

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

/** Adds a leaf <p> with the given inner HTML to the block. */
function leafOf(inner: string): HTMLElement {
  const p = document.createElement("p");
  p.innerHTML = inner;
  block.appendChild(p);
  return p;
}

/** The text node of `root` that contains `needle`. */
function textNodeWith(root: Node, needle: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.nodeValue ?? "").includes(needle)) return n as Text;
  throw new Error(`no text node contains ${JSON.stringify(needle)}`);
}

/** Selects the first occurrence of `needle` in the leaf's text (it must lie inside one text node). */
function selectText(leaf: HTMLElement, needle: string): void {
  const node = textNodeWith(leaf, needle);
  const start = (node.nodeValue ?? "").indexOf(needle);
  selectRange(node, start, node, start + needle.length);
}

function selectRange(a: Node, ao: number, b: Node, bo: number): void {
  const range = document.createRange();
  range.setStart(a, ao);
  range.setEnd(b, bo);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Selects all of the leaf's contents. */
function selectAll(leaf: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(leaf);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const selected = (): string => document.getSelection()!.toString();

/** Every text node of the leaf has an ancestor matching `selector` below the leaf. */
function allTextIn(leaf: HTMLElement, selector: string): boolean {
  const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
  let any = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n.nodeValue ?? "").trim()) continue;
    any = true;
    const hit = (n.parentElement as Element).closest(selector);
    if (!hit || !leaf.contains(hit) || hit === leaf) return false;
  }
  return any;
}

// --- toggleLeafMark -------------------------------------------------------------------------------------------------------------------

describe("toggleLeafMark wraps", () => {
  it.each([["b"], ["i"], ["u"], ["s"]] as const)("9.1c wraps the selected text in a new <%s>, splitting the text node at the boundaries", (mark) => {
    const leaf = leafOf("hello world again");
    selectText(leaf, "world");
    expect(toggleLeafMark(leaf, mark)).toBe(true);
    expect(leaf.innerHTML).toBe(`hello <${mark}>world</${mark}> again`);
  });

  it("9.1c keeps the selection on the same text after wrapping", () => {
    const leaf = leafOf("hello world");
    selectText(leaf, "world");
    toggleLeafMark(leaf, "b");
    expect(selected()).toBe("world");
  });

  it("9.1c lets a second toggle on the kept selection remove the mark again", () => {
    const leaf = leafOf("hello world");
    selectText(leaf, "world");
    toggleLeafMark(leaf, "b");
    expect(toggleLeafMark(leaf, "b")).toBe(true);
    expect(leaf.innerHTML).toBe("hello world");
  });

  it("9.1c wraps a selection that covers the whole text of the leaf", () => {
    const leaf = leafOf("hello");
    selectAll(leaf);
    expect(toggleLeafMark(leaf, "i")).toBe(true);
    expect(leaf.innerHTML).toBe("<i>hello</i>");
  });

  it("9.1c applies another mark inside an existing one", () => {
    const leaf = leafOf("hello <b>world</b>");
    selectText(leaf, "world");
    expect(toggleLeafMark(leaf, "i")).toBe(true);
    const inItalic = (needle: string): boolean => {
      const hit = textNodeWith(leaf, needle).parentElement!.closest("i");
      return !!hit && leaf.contains(hit) && hit !== leaf;
    };
    expect(inItalic("world")).toBe(true);
    expect(inItalic("hello")).toBe(false);
    expect(leaf.querySelector("b")).not.toBeNull();
    expect(leaf.textContent).toBe("hello world");
  });

  it("9.1c wraps when only some of the selected text already has the mark", () => {
    const leaf = leafOf("<b>hello</b> world");
    selectAll(leaf);
    expect(toggleLeafMark(leaf, "b")).toBe(true);
    expect(allTextIn(leaf, "b")).toBe(true);
    expect(leaf.textContent).toBe("hello world");
    expect(selected()).toBe("hello world");
  });

  it("9.1c wraps a selection that spans text and an inline element inside the leaf", () => {
    const leaf = leafOf("one <i>two</i> three");
    selectAll(leaf);
    expect(toggleLeafMark(leaf, "u")).toBe(true);
    expect(allTextIn(leaf, "u")).toBe(true);
    expect(leaf.textContent).toBe("one two three");
  });
});

describe("toggleLeafMark toggles off", () => {
  it("9.1c unwraps the element when the selection is the whole marked text", () => {
    const leaf = leafOf("hello <b>world</b>");
    selectText(leaf, "world");
    expect(toggleLeafMark(leaf, "b")).toBe(true);
    expect(leaf.innerHTML).toBe("hello world");
    expect(selected()).toBe("world");
  });

  it("9.1c unwraps the whole element, not only the selected part of it", () => {
    const leaf = leafOf("<b>hello world</b>");
    selectText(leaf, "world");
    expect(toggleLeafMark(leaf, "b")).toBe(true);
    expect(leaf.innerHTML).toBe("hello world");
    expect(selected()).toBe("world");
  });

  it.each([
    ["b", "strong"],
    ["i", "em"],
    ["s", "strike"],
    ["s", "del"],
    ["u", "u"],
  ] as const)("9.1c unwraps the %s mark written as <%s>", (mark, tag) => {
    const leaf = leafOf(`a <${tag}>b</${tag}> c`);
    selectText(leaf, "b");
    expect(toggleLeafMark(leaf, mark)).toBe(true);
    expect(leaf.innerHTML).toBe("a b c");
  });

  it("9.1c unwraps every marked element that intersects the selection", () => {
    const leaf = leafOf("<b>ab</b><b>cd</b>");
    selectAll(leaf);
    expect(toggleLeafMark(leaf, "b")).toBe(true);
    expect(leaf.innerHTML).toBe("abcd");
  });

  it("9.1c leaves other marks in place when it unwraps one", () => {
    const leaf = leafOf("<i><b>x</b></i>");
    selectText(leaf, "x");
    expect(toggleLeafMark(leaf, "b")).toBe(true);
    expect(leaf.innerHTML).toBe("<i>x</i>");
  });

  it("9.1c does not unwrap a mark of another kind", () => {
    const leaf = leafOf("<i>x</i>");
    selectText(leaf, "x");
    expect(toggleLeafMark(leaf, "b")).toBe(true);
    expect(leaf.querySelector("i")).not.toBeNull();
    expect(leaf.querySelector("b")).not.toBeNull();
  });
});

describe("toggleLeafMark refuses", () => {
  it("9.1c returns false and changes nothing for a collapsed selection", () => {
    const leaf = leafOf("hello world");
    const node = textNodeWith(leaf, "hello");
    selectRange(node, 2, node, 2);
    expect(toggleLeafMark(leaf, "b")).toBe(false);
    expect(leaf.innerHTML).toBe("hello world");
  });

  it("9.1c returns false and changes nothing when there is no selection", () => {
    const leaf = leafOf("hello world");
    document.getSelection()!.removeAllRanges();
    expect(toggleLeafMark(leaf, "b")).toBe(false);
    expect(leaf.innerHTML).toBe("hello world");
  });

  it("9.1c returns false and changes nothing when the selection is in another element", () => {
    const leaf = leafOf("hello world");
    const other = leafOf("elsewhere");
    selectText(other, "elsewhere");
    expect(toggleLeafMark(leaf, "b")).toBe(false);
    expect(leaf.innerHTML).toBe("hello world");
    expect(other.innerHTML).toBe("elsewhere");
  });

  it("9.1c returns false and changes nothing for a selection across two leaves", () => {
    const first = leafOf("first leaf");
    const second = leafOf("second leaf");
    selectRange(textNodeWith(first, "first"), 2, textNodeWith(second, "second"), 3);
    expect(toggleLeafMark(first, "b")).toBe(false);
    expect(toggleLeafMark(second, "b")).toBe(false);
    expect(first.innerHTML).toBe("first leaf");
    expect(second.innerHTML).toBe("second leaf");
  });

  it("9.1c returns false and changes nothing for a selection that starts inside the leaf and ends outside it", () => {
    const leaf = leafOf("inside text");
    const after = document.createElement("span");
    after.textContent = "outside";
    block.appendChild(after);
    selectRange(textNodeWith(leaf, "inside"), 3, after.firstChild!, 3);
    expect(toggleLeafMark(leaf, "i")).toBe(false);
    expect(leaf.innerHTML).toBe("inside text");
    expect(after.innerHTML).toBe("outside");
  });
});

// --- setLeafColor ---------------------------------------------------------------------------------------------------------------------

describe("setLeafColor", () => {
  it("9.1c wraps the selection in a span whose style is the colour", () => {
    const leaf = leafOf("hello world again");
    selectText(leaf, "world");
    expect(setLeafColor(leaf, "#ff0000")).toBe(true);
    const spans = leaf.querySelectorAll("span");
    expect(spans).toHaveLength(1);
    expect(spans[0]!.textContent).toBe("world");
    expect(spans[0]!.getAttribute("style")).toMatch(/^\s*color:\s*#ff0000;?\s*$/);
    expect(leaf.textContent).toBe("hello world again");
  });

  it("9.1c keeps the selection on the same text", () => {
    const leaf = leafOf("hello world");
    selectText(leaf, "world");
    setLeafColor(leaf, "#00ff00");
    expect(selected()).toBe("world");
  });

  it.each(["rgb(1, 2, 3)", "hsl(120, 50%, 50%)", "var(--accent)", "red"])("9.1c accepts the colour %s", (color) => {
    const leaf = leafOf("hello world");
    selectText(leaf, "world");
    expect(setLeafColor(leaf, color)).toBe(true);
    expect(leaf.querySelectorAll("span")).toHaveLength(1);
  });

  it.each(["not a color!", "red; background: url(x)", "url(javascript:x)", "", "#12"])("9.1c returns false and changes nothing for the invalid colour %j", (color) => {
    const leaf = leafOf("hello world");
    selectText(leaf, "world");
    expect(setLeafColor(leaf, color)).toBe(false);
    expect(leaf.innerHTML).toBe("hello world");
  });

  it("9.1c null unwraps the colour span that intersects the selection, whole", () => {
    const leaf = leafOf('<span style="color: #f00">hello</span> world');
    selectText(leaf, "ell");
    expect(setLeafColor(leaf, null)).toBe(true);
    expect(leaf.innerHTML).toBe("hello world");
  });

  it("9.1c null unwraps every colour span that intersects the selection and leaves the others", () => {
    const leaf = leafOf('<span style="color: #f00">a</span><span style="color: #0f0">b</span> <span style="color: #00f">c</span>');
    const first = textNodeWith(leaf, "a");
    const second = textNodeWith(leaf, "b");
    selectRange(first, 0, second, 1);
    expect(setLeafColor(leaf, null)).toBe(true);
    expect(leaf.querySelectorAll("span")).toHaveLength(1);
    expect(leaf.textContent).toBe("ab c");
  });

  it("9.1c returns false and changes nothing for a collapsed selection", () => {
    const leaf = leafOf("hello world");
    const node = textNodeWith(leaf, "hello");
    selectRange(node, 1, node, 1);
    expect(setLeafColor(leaf, "#ff0000")).toBe(false);
    expect(leaf.innerHTML).toBe("hello world");
  });

  it("9.1c returns false and changes nothing for a selection across two leaves", () => {
    const first = leafOf("first leaf");
    const second = leafOf("second leaf");
    selectRange(textNodeWith(first, "first"), 1, textNodeWith(second, "second"), 2);
    expect(setLeafColor(first, "#ff0000")).toBe(false);
    expect(first.innerHTML).toBe("first leaf");
    expect(second.innerHTML).toBe("second leaf");
  });

  it("9.1c returns false and changes nothing for a selection in another element", () => {
    const leaf = leafOf("hello world");
    const other = leafOf("elsewhere");
    selectText(other, "elsewhere");
    expect(setLeafColor(leaf, "#ff0000")).toBe(false);
    expect(other.innerHTML).toBe("elsewhere");
  });
});

// --- setLeafLink ----------------------------------------------------------------------------------------------------------------------

describe("setLeafLink", () => {
  it("9.1c wraps the selection in an <a href>", () => {
    const leaf = leafOf("see the docs now");
    selectText(leaf, "docs");
    expect(setLeafLink(leaf, "https://example.com/docs")).toBe(true);
    expect(leaf.innerHTML).toBe('see the <a href="https://example.com/docs">docs</a> now');
  });

  it("9.1c keeps the selection on the same text", () => {
    const leaf = leafOf("see the docs now");
    selectText(leaf, "docs");
    setLeafLink(leaf, "https://example.com");
    expect(selected()).toBe("docs");
  });

  it("9.1c writes the trimmed href that safeDeckHref returns", () => {
    const leaf = leafOf("docs");
    selectAll(leaf);
    expect(setLeafLink(leaf, "  https://example.com  ")).toBe(true);
    expect(leaf.querySelector("a")!.getAttribute("href")).toBe("https://example.com");
  });

  it.each(["mailto:a@b.co", "#section", "docs/page.html"])("9.1c accepts the href %s", (href) => {
    const leaf = leafOf("docs");
    selectAll(leaf);
    expect(setLeafLink(leaf, href)).toBe(true);
    expect(leaf.querySelector("a")!.getAttribute("href")).toBe(href);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://example.org", ""])("9.1c returns false and changes nothing for the unsafe href %j", (href) => {
    const leaf = leafOf("see the docs now");
    selectText(leaf, "docs");
    expect(setLeafLink(leaf, href)).toBe(false);
    expect(leaf.innerHTML).toBe("see the docs now");
  });

  it("9.1c null unwraps the <a> that intersects the selection, whole", () => {
    const leaf = leafOf('see <a href="https://example.com">the docs</a> now');
    selectText(leaf, "docs");
    expect(setLeafLink(leaf, null)).toBe(true);
    expect(leaf.innerHTML).toBe("see the docs now");
    expect(selected()).toBe("docs");
  });

  it("9.1c returns false and changes nothing for a collapsed selection", () => {
    const leaf = leafOf("see the docs now");
    const node = textNodeWith(leaf, "docs");
    selectRange(node, 2, node, 2);
    expect(setLeafLink(leaf, "https://example.com")).toBe(false);
    expect(leaf.innerHTML).toBe("see the docs now");
  });

  it("9.1c returns false and changes nothing for a selection across two leaves", () => {
    const first = leafOf("first leaf");
    const second = leafOf("second leaf");
    selectRange(textNodeWith(first, "first"), 1, textNodeWith(second, "second"), 2);
    expect(setLeafLink(first, "https://example.com")).toBe(false);
    expect(first.innerHTML).toBe("first leaf");
    expect(second.innerHTML).toBe("second leaf");
  });

  it("9.1c returns false and changes nothing for a selection in another block", () => {
    const leaf = leafOf("hello world");
    const otherBlock = document.createElement("div");
    otherBlock.setAttribute("data-block", "c");
    const otherLeaf = document.createElement("p");
    otherLeaf.textContent = "elsewhere";
    otherBlock.appendChild(otherLeaf);
    document.body.appendChild(otherBlock);
    selectText(otherLeaf, "elsewhere");
    expect(setLeafLink(leaf, "https://example.com")).toBe(false);
    expect(otherLeaf.innerHTML).toBe("elsewhere");
  });
});

// --- leafInlineHtml -------------------------------------------------------------------------------------------------------------------

describe("leafInlineHtml", () => {
  it("9.1c returns the text of a plain leaf", () => {
    expect(leafInlineHtml(leafOf("hello world"))).toBe("hello world");
  });

  it("9.1c escapes & < > in text", () => {
    const leaf = document.createElement("p");
    leaf.textContent = "a < b & c > d";
    block.appendChild(leaf);
    expect(leafInlineHtml(leaf)).toBe("a &lt; b &amp; c &gt; d");
  });

  it("9.1c keeps <br> and allowed inline elements", () => {
    expect(leafInlineHtml(leafOf("a<br>b <b>bold</b> <i>it</i>"))).toBe("a<br>b <b>bold</b> <i>it</i>");
  });

  it("9.1c keeps a colour span and a link", () => {
    const html = '<span style="color: #f00">r</span> <a href="https://example.com">l</a>';
    expect(leafInlineHtml(leafOf(html))).toBe(html);
  });

  it("9.1c sanitises disallowed markup in the leaf", () => {
    expect(leafInlineHtml(leafOf('x <font color="red">y</font> <b onclick="boom()">z</b><script>alert(1)</script>'))).toBe("x y <b>z</b>");
  });

  it("9.1c leaves data-math elements out", () => {
    expect(leafInlineHtml(leafOf('a<span data-math="inline">x^2</span>b'))).toBe("ab");
  });

  it("9.1c equals the serialisation after a formatting change", () => {
    const leaf = leafOf("hello world");
    selectText(leaf, "world");
    toggleLeafMark(leaf, "b");
    expect(leafInlineHtml(leaf)).toBe("hello <b>world</b>");
  });

  it("9.1c returns an empty string for an empty leaf", () => {
    expect(leafInlineHtml(leafOf(""))).toBe("");
  });
});
