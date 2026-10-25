import { formatFitted, splitGraphemes, deriveGraphemeWidth, normalizeForTerminal, deriveStringWidth, formatTruncated, splitWrapped } from "../../src/screen/text";

describe("text width helpers", () => {
  it("counts ASCII, accents, CJK and emoji by terminal cells", () => {
    expect(deriveStringWidth("abc")).toBe(3);
    expect(deriveStringWidth("Schrödinger")).toBe(11);
    expect(deriveStringWidth("日本")).toBe(4);
  });

  it("truncates by cells with an ellipsis", () => {
    expect(formatTruncated("Attention Is All You Need", 10)).toBe("Attention…");
    expect(deriveStringWidth(formatTruncated("日本語のタイトル", 5))).toBeLessThanOrEqual(5);
  });

  it("pads to an exact width", () => {
    expect(formatFitted("ab", 4)).toBe("ab  ");
  });

  it("wraps words and hard-breaks long ones", () => {
    expect(splitWrapped("one two three", 7)).toEqual(["one two", "three"]);
    expect(splitWrapped("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("deriveGraphemeWidth", () => {
  it("is 1 for printable ASCII and accented letters", () => {
    expect(deriveGraphemeWidth("a")).toBe(1);
    expect(deriveGraphemeWidth(" ")).toBe(1);
    expect(deriveGraphemeWidth("~")).toBe(1);
    expect(deriveGraphemeWidth("é")).toBe(1);
  });

  it("is 2 for CJK, Hangul, fullwidth forms and emoji", () => {
    expect(deriveGraphemeWidth("日")).toBe(2);
    expect(deriveGraphemeWidth("한")).toBe(2);
    expect(deriveGraphemeWidth("Ａ")).toBe(2);
    expect(deriveGraphemeWidth("😀")).toBe(2);
  });

  it("is 2 for a narrow symbol followed by the emoji presentation selector", () => {
    expect(deriveGraphemeWidth("❤️")).toBe(2);
  });

  it("is 0 for control characters, combining marks and zero-width format characters", () => {
    expect(deriveGraphemeWidth("\x1b")).toBe(0);
    expect(deriveGraphemeWidth("\x7f")).toBe(0);
    expect(deriveGraphemeWidth("́")).toBe(0);
    expect(deriveGraphemeWidth("​")).toBe(0);
  });
});

describe("splitGraphemes", () => {
  it("returns one entry per user-perceived character with its width", () => {
    expect(splitGraphemes("a日")).toEqual([{ g: "a", w: 1 }, { g: "日", w: 2 }]);
  });

  it("keeps a base letter and its combining accent together", () => {
    expect(splitGraphemes("é")).toEqual([{ g: "é", w: 1 }]);
  });

  it("keeps an emoji outside the BMP as a single two-cell cluster", () => {
    expect(splitGraphemes("a😀b")).toEqual([{ g: "a", w: 1 }, { g: "😀", w: 2 }, { g: "b", w: 1 }]);
  });

  it("returns nothing for an empty string", () => {
    expect(splitGraphemes("")).toEqual([]);
  });

  it("replaces control characters with a visible placeholder so escape sequences cannot reach the terminal", () => {
    const text = splitGraphemes("a\x1b[2Jb").map((entry) => entry.g).join("");
    expect(text).toBe("a�[2Jb");
    expect(text).not.toContain("\x1b");
  });

  it("replaces C0, DEL and C1 controls alike, each taking one cell", () => {
    for (const control of ["\x00", "\x07", "\x1b", "\x7f", "\x9b"]) {
      expect(splitGraphemes(control)).toEqual([{ g: "�", w: 1 }]);
    }
  });

  it("turns a tab into a single space", () => {
    expect(splitGraphemes("a\tb")).toEqual([{ g: "a", w: 1 }, { g: " ", w: 1 }, { g: "b", w: 1 }]);
  });

  it("treats CRLF as one placeholder cell", () => {
    expect(splitGraphemes("a\r\nb").map((entry) => entry.g)).toEqual(["a", "�", "b"]);
  });

  it("keeps zero-width characters with width 0", () => {
    expect(splitGraphemes("a​b")).toEqual([{ g: "a", w: 1 }, { g: "​", w: 0 }, { g: "b", w: 1 }]);
  });
});

describe("deriveStringWidth", () => {
  it("is 0 for the empty string", () => {
    expect(deriveStringWidth("")).toBe(0);
  });

  it("counts an escape sequence as visible placeholder cells, never as zero-width", () => {
    expect(deriveStringWidth("\x1b[2J")).toBe(4);
  });

  it("counts wide characters as two cells each and ignores combining marks", () => {
    expect(deriveStringWidth("日本語")).toBe(6);
    expect(deriveStringWidth("é")).toBe(1);
    expect(deriveStringWidth("a😀")).toBe(3);
  });
});

describe("truncate edge cases", () => {
  it("returns an empty string for a width of 0 or less", () => {
    expect(formatTruncated("abc", 0)).toBe("");
    expect(formatTruncated("abc", -3)).toBe("");
  });

  it("returns just the ellipsis for a width of 1 when the text is longer", () => {
    expect(formatTruncated("abc", 1)).toBe("…");
    expect(formatTruncated("ab", 1)).toBe("…");
  });

  it("keeps text that already fits in a width of 1", () => {
    expect(formatTruncated("a", 1)).toBe("a");
    expect(formatTruncated("", 1)).toBe("");
  });

  it("leaves text that fits exactly untouched", () => {
    expect(formatTruncated("abcd", 4)).toBe("abcd");
    expect(formatTruncated("日本", 4)).toBe("日本");
  });

  it("never cuts a wide character in half", () => {
    const cut = formatTruncated("日本語", 4);
    expect(cut).toBe("日…");
    expect(deriveStringWidth(cut)).toBeLessThanOrEqual(4);
  });

  it("uses a custom ellipsis and shortens it when the width is smaller than the ellipsis", () => {
    expect(formatTruncated("abcdefgh", 6, "...")).toBe("abc...");
    expect(formatTruncated("abcdefgh", 2, "...")).toBe("..");
  });

  it("accepts an empty ellipsis", () => {
    expect(formatTruncated("abcdef", 3, "")).toBe("abc");
  });

  it("always fits the requested width", () => {
    for (const text of ["Attention Is All You Need", "日本語のタイトル", "a😀b😀c😀d", "éééé"]) {
      for (let width = 0; width <= 12; width++) {
        expect(deriveStringWidth(formatTruncated(text, width))).toBeLessThanOrEqual(width);
      }
    }
  });

  it("replaces control characters in the kept part", () => {
    expect(formatTruncated("a\x1b[2Jbcdef", 5)).toBe("a�[2…");
  });
});

describe("formatFitted", () => {
  it("pads wide text by cells, not by characters", () => {
    expect(formatFitted("日", 4)).toBe("日  ");
  });

  it("truncates text wider than the width", () => {
    expect(formatFitted("Attention Is All", 9)).toBe("Attentio…");
  });

  it("returns an empty string for a width of 0", () => {
    expect(formatFitted("abc", 0)).toBe("");
  });

  it("always produces exactly the requested number of cells", () => {
    for (const text of ["", "ab", "Attention Is All You Need", "日本語", "a😀b"]) {
      for (const width of [1, 2, 5, 9, 20]) {
        expect(deriveStringWidth(formatFitted(text, width))).toBe(width);
      }
    }
  });
});

describe("splitWrapped", () => {
  it("keeps explicit newlines as line breaks", () => {
    expect(splitWrapped("first\nsecond", 20)).toEqual(["first", "second"]);
  });

  it("keeps blank lines between paragraphs, including a trailing one", () => {
    expect(splitWrapped("a\n\nb", 10)).toEqual(["a", "", "b"]);
    expect(splitWrapped("a\n", 10)).toEqual(["a", ""]);
  });

  it("treats CRLF and lone CR as newlines", () => {
    expect(splitWrapped("a\r\nb\rc", 10)).toEqual(["a", "b", "c"]);
  });

  it("wraps each paragraph independently", () => {
    expect(splitWrapped("one two three\nfour five", 7)).toEqual(["one two", "three", "four", "five"]);
  });

  it("returns a single empty line for empty text", () => {
    expect(splitWrapped("", 10)).toEqual([""]);
  });

  it("returns nothing for a width of 0 or less", () => {
    expect(splitWrapped("abc", 0)).toEqual([]);
    expect(splitWrapped("abc", -1)).toEqual([]);
  });

  it("collapses runs of spaces and tabs between words", () => {
    expect(splitWrapped("a   b\tc", 20)).toEqual(["a b c"]);
  });

  it("puts a word on its own line before hard-breaking one that is too long", () => {
    expect(splitWrapped("hi abcdefghij", 4)).toEqual(["hi", "abcd", "efgh", "ij"]);
  });

  it("continues the next word on the last piece of a hard-broken word", () => {
    expect(splitWrapped("abcdefghij k", 4)).toEqual(["abcd", "efgh", "ij k"]);
  });

  it("breaks wide characters by cells", () => {
    expect(splitWrapped("日本語日本語", 4)).toEqual(["日本", "語日", "本語"]);
  });

  it("never produces a line wider than the width", () => {
    const text = "Attention is all you need 日本語のタイトル supercalifragilisticexpialidocious\n\nend";
    for (const width of [4, 7, 12, 30]) {
      for (const line of splitWrapped(text, width)) {
        expect(deriveStringWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("does not lose any word", () => {
    const words = "the quick brown fox jumps over the lazy dog".split(" ");
    expect(splitWrapped(words.join(" "), 11).join(" ").split(" ")).toEqual(words);
  });
});

describe("wrap regressions", () => {
  it("never starts with an empty line when a wide character is wider than the line", () => {
    expect(splitWrapped("日", 1)).toEqual(["日"]);
  });
});

describe("normalizeForTerminal", () => {
  it("neutralises escape sequences from untrusted metadata but keeps newlines and tabs", () => {
    const evil = "Deep nets\x1b]52;c;ZXZpbA==\x07 and\tmore\nline\x9b2J";
    const safe = normalizeForTerminal(evil);
    expect(safe).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    expect(safe).toContain("\t");
    expect(safe).toContain("\n");
    expect(safe.startsWith("Deep nets�]52;c;")).toBe(true);
  });
});
