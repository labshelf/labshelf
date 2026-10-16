/** Contract of the .bib parser: entries with fields and offsets, robust to the shapes real bib files contain. */
import { bibEntries } from "../../../src/writing/bibLint/index";

describe("bibEntries", () => {
  it("reads braced, quoted, bare and concatenated values with lower-case names", () => {
    const text = `@Article{vaswani2017,\n  Title = {Attention {Is} All You Need},\n  journal = "NeurIPS {"}x{"}",\n  year = 2017,\n  month = jan # " 1",\n}`;
    const [entry] = bibEntries(text);
    expect(entry).toMatchObject({ type: "article", key: "vaswani2017", start: 0, end: text.length });
    expect(Object.fromEntries(entry!.fields)).toEqual({
      title: "Attention {Is} All You Need", journal: "NeurIPS {\"}x{\"}", year: "2017", month: "jan 1",
    });
  });

  it("skips @string, @comment, @preamble and commented-out entries", () => {
    const text = `@string{nips = "NeurIPS"}\n@comment{@article{no, title={x}}}\n% @article{off, title={y}}\n@preamble{"\\newcommand{\\x}{}"}\n@misc{kept, note = {n}}`;
    expect(bibEntries(text).map((entry) => entry.key)).toEqual(["kept"]);
  });

  it("accepts parenthesised entries and entries with only a key", () => {
    expect(bibEntries("@book(knuth, title = {TAOCP})\n@misc{bare}").map((entry) => [entry.type, entry.key])).toEqual([["book", "knuth"], ["misc", "bare"]]);
  });

  it("skips a malformed entry and parses the one after it", () => {
    const text = "@article{broken, title = {never closed\n@article{good, title = {Fine}}";
    expect(bibEntries(text).map((entry) => entry.key)).toEqual(["good"]);
  });

  it("gives offsets that cut the entry out of the text", () => {
    const text = "intro\n@misc{a, title={A}}\n\n@misc{b, title={B}}\n";
    const entries = bibEntries(text);
    expect(entries.map((entry) => text.slice(entry.start, entry.end))).toEqual(["@misc{a, title={A}}", "@misc{b, title={B}}"]);
  });
});
