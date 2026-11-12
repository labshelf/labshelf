// Tests bindDeckReplicas (spec 3.3, A: 3.3a and 3.3b): the deck tab's edit view bound to the live files of deck.html and theme.css.
// Live files are fakes over real Y.Docs: a replica exposing doc, text() and replace(); flush and release are jest mocks.
// Assumption: a replica's text lives in doc.getText("content"), the layout core's text replicas use.
import * as Y from "yjs";
import { bindDeckReplicas, type DeckReplicas } from "../../src/localSync/deckBinding";

type FakeLive = DeckReplicas["deck"] & { flush: jest.Mock; release: jest.Mock };

function fakeLive(initial: string): FakeLive {
  const doc = new Y.Doc();
  const content = doc.getText("content");
  if (initial) { content.insert(0, initial); }
  const replica = {
    key: "fake",
    kind: "text" as const,
    doc,
    ready: Promise.resolve("disk" as const),
    text: () => content.toString(),
    replace: (text: string, origin?: unknown) => {
      doc.transact(() => {
        content.delete(0, content.length);
        content.insert(0, text);
      }, origin ?? null);
    },
    release: () => undefined,
  };
  return { replica, flush: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
}

/** A change that comes from somewhere else (the disk writer, another tab). */
function outsideEdit(live: FakeLive, text: string): void {
  live.replica.replace(text, "disk");
}

function setup(options: { theme?: string; fallback?: string } = {}) {
  const deck = fakeLive("<p>old</p>");
  const theme = options.theme === undefined ? undefined : fakeLive(options.theme);
  const editor = { setDocument: jest.fn() };
  const fallbackTheme = { text: options.fallback ?? "", write: jest.fn(async (_text: string) => undefined) };
  const binding = bindDeckReplicas(theme ? { deck, theme } : { deck }, editor, fallbackTheme);
  return { deck, theme, editor, fallbackTheme, binding };
}

describe("bindDeckReplicas with a theme replica", () => {
  it("3.3a change puts the html into the deck replica and the theme into the theme replica", () => {
    const { deck, theme, binding } = setup({ theme: "a { color: red }" });
    binding.change({ html: "<p>new</p>", theme: "a { color: blue }" });
    expect(deck.replica.text()).toBe("<p>new</p>");
    expect(theme?.replica.text()).toBe("a { color: blue }");
  });

  it("3.3a its own change does not call setDocument", () => {
    const { editor, binding } = setup({ theme: "t1" });
    binding.change({ html: "<p>new</p>", theme: "t2" });
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it("3.3a its own change of the html alone does not call setDocument", () => {
    const { editor, binding } = setup({ theme: "t1" });
    binding.change({ html: "<p>other</p>", theme: "t1" });
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it("3.3a a deck replica change from another origin calls setDocument once with the new html and the current theme", () => {
    const { deck, editor } = setup({ theme: "t1" });
    outsideEdit(deck, "<p>from disk</p>");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
    expect(editor.setDocument).toHaveBeenCalledWith("<p>from disk</p>", "t1");
  });

  it("3.3a the current theme is the theme replica's text after its own change", () => {
    const { deck, editor, binding } = setup({ theme: "t1" });
    binding.change({ html: "<p>mine</p>", theme: "t2" });
    outsideEdit(deck, "<p>from disk</p>");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
    expect(editor.setDocument).toHaveBeenCalledWith("<p>from disk</p>", "t2");
  });

  it("3.3a a theme replica change from another origin calls setDocument once with the deck html and the new theme", () => {
    const { theme, editor } = setup({ theme: "t1" });
    if (!theme) { throw new Error("setup built no theme replica"); }
    outsideEdit(theme, "t-disk");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
    expect(editor.setDocument).toHaveBeenCalledWith("<p>old</p>", "t-disk");
  });

  it("3.3a one transaction of the deck replica from another origin calls setDocument once", () => {
    const { deck, editor } = setup({ theme: "t1" });
    const content = deck.replica.doc.getText("content");
    deck.replica.doc.transact(() => {
      content.insert(0, "<b>");
      content.insert(content.length, "</b>");
    }, "disk");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
    expect(editor.setDocument).toHaveBeenCalledWith("<b><p>old</p></b>", "t1");
  });

  it("3.3a an outside change after its own change still calls setDocument", () => {
    const { deck, editor, binding } = setup({ theme: "t1" });
    binding.change({ html: "<p>mine</p>", theme: "t1" });
    expect(editor.setDocument).not.toHaveBeenCalled();
    outsideEdit(deck, "<p>theirs</p>");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
  });
});

describe("bindDeckReplicas without a theme replica", () => {
  it("3.3b a changed theme is written through fallbackTheme.write", () => {
    const { fallbackTheme, deck, binding } = setup({ fallback: "t1" });
    binding.change({ html: "<p>new</p>", theme: "t2" });
    expect(fallbackTheme.write).toHaveBeenCalledTimes(1);
    expect(fallbackTheme.write).toHaveBeenCalledWith("t2");
    expect(deck.replica.text()).toBe("<p>new</p>");
  });

  it("3.3b an unchanged theme is not written", () => {
    const { fallbackTheme, deck, binding } = setup({ fallback: "t1" });
    binding.change({ html: "<p>new</p>", theme: "t1" });
    expect(fallbackTheme.write).not.toHaveBeenCalled();
    expect(deck.replica.text()).toBe("<p>new</p>");
  });

  it("3.3b a deck replica change from another origin calls setDocument with the new html and the fallback theme", () => {
    const { deck, editor } = setup({ fallback: "t1" });
    outsideEdit(deck, "<p>from disk</p>");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
    expect(editor.setDocument).toHaveBeenCalledWith("<p>from disk</p>", "t1");
  });

  it("3.3b its own change does not call setDocument", () => {
    const { editor, binding } = setup({ fallback: "t1" });
    binding.change({ html: "<p>new</p>", theme: "t2" });
    expect(editor.setDocument).not.toHaveBeenCalled();
  });
});

describe("bindDeckReplicas flush and dispose", () => {
  it("3.3b flush flushes both live files and resolves true", async () => {
    const { deck, theme, binding } = setup({ theme: "t1" });
    await expect(binding.flush()).resolves.toBe(true);
    expect(deck.flush).toHaveBeenCalledTimes(1);
    expect(theme?.flush).toHaveBeenCalledTimes(1);
  });

  it("3.3b flush without a theme replica flushes the deck file and resolves true", async () => {
    const { deck, binding } = setup();
    await expect(binding.flush()).resolves.toBe(true);
    expect(deck.flush).toHaveBeenCalledTimes(1);
  });

  it("3.3b after dispose a deck replica change no longer calls setDocument", () => {
    const { deck, editor, binding } = setup({ theme: "t1" });
    outsideEdit(deck, "<p>before</p>");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
    binding.dispose();
    outsideEdit(deck, "<p>after</p>");
    expect(editor.setDocument).toHaveBeenCalledTimes(1);
  });

  it("3.3b after dispose a theme replica change no longer calls setDocument", () => {
    const { theme, editor, binding } = setup({ theme: "t1" });
    if (!theme) { throw new Error("setup built no theme replica"); }
    binding.dispose();
    outsideEdit(theme, "t-after");
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it("3.3b after dispose without a theme replica a deck change no longer calls setDocument", () => {
    const { deck, editor, binding } = setup({ fallback: "t1" });
    binding.dispose();
    outsideEdit(deck, "<p>after</p>");
    expect(editor.setDocument).not.toHaveBeenCalled();
  });
});
