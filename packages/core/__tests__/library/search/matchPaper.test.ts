import { isPaperMatch, matchPaper, matchTerms, parseQuery, searchDoc, type PaperRecord, type SearchExtra } from "@labshelf/core";

function rec(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "p1", title: "Untitled", path: "/lib/papers/p1", citeKey: "p1", status: "unread", hasPdf: true, ...overrides };
}

/** Score of one record against one query string. */
function score(record: PaperRecord, query: string, extra: SearchExtra = {}): number {
  return matchPaper(record, searchDoc(record, extra), parseQuery(query));
}

describe("matchPaper: terms and ranking", () => {
  it("returns 0 when the paper does not match, a positive rank when it does", () => {
    const paper = rec({ title: "Attention Is All You Need" });
    expect(score(paper, "convolution")).toBe(0);
    expect(score(paper, "attention")).toBeGreaterThan(0);
  });

  it("matches an empty query with the base rank (callers skip empty queries before calling)", () => {
    expect(score(rec(), "")).toBe(1);
  });

  it("ranks title hits above author hits above everything else", () => {
    const inTitle = rec({ id: "t", title: "BERT: Pre-training of Deep Bidirectional Transformers" });
    const inAuthors = rec({ id: "a", title: "Language models", authors: ["Bert Smith"] });
    const inRest = rec({ id: "r", title: "Language models", note: "reproduce the bert baseline" });
    const nowhere = rec({ id: "n", title: "Language models" });

    expect(score(inTitle, "bert")).toBeGreaterThan(score(inAuthors, "bert"));
    expect(score(inAuthors, "bert")).toBeGreaterThan(score(inRest, "bert"));
    expect(score(inRest, "bert")).toBeGreaterThan(0);
    expect(score(nowhere, "bert")).toBe(0);
  });

  it("ranks a title that starts with the term above one that merely contains it", () => {
    const starts = rec({ title: "Transformers in vision" });
    const contains = rec({ title: "Vision transformers" });
    expect(score(starts, "transformers")).toBeGreaterThan(score(contains, "transformers"));
  });

  it("requires every term, each in any field", () => {
    const paper = rec({ title: "Attention Is All You Need", authors: ["Ashish Vaswani"], note: "revisit multi-head part" });
    expect(score(paper, "attention vaswani")).toBeGreaterThan(0);
    expect(score(paper, "attention multi-head")).toBeGreaterThan(0);
    expect(score(paper, "attention nonsense")).toBe(0);
  });

  it("scores more matching terms higher", () => {
    const paper = rec({ title: "Attention Is All You Need", authors: ["Ashish Vaswani"] });
    expect(score(paper, "attention vaswani")).toBeGreaterThan(score(paper, "attention"));
  });

  it("matches a quoted phrase only as a contiguous phrase", () => {
    const paper = rec({ title: "Attention Is All You Need" });
    expect(score(paper, '"all you need"')).toBeGreaterThan(0);
    expect(score(paper, '"need you all"')).toBe(0);
  });

  it("is case- and accent-insensitive on both sides", () => {
    const paper = rec({ title: "Schrödinger's Cat", authors: ["José Müller"] });
    expect(score(paper, "schrodinger")).toBeGreaterThan(0);
    expect(score(paper, "SCHRÖDINGER")).toBeGreaterThan(0);
    expect(score(paper, "schrödinger")).toBeGreaterThan(0);
    expect(score(paper, "jose muller")).toBeGreaterThan(0);
    expect(score(paper, "au:JOSE")).toBeGreaterThan(0);
  });

  it("searches id, cite key, journal, publisher, doi, url, summary, note, year and keywords", () => {
    const paper = rec({
      id: "vaswani2017attention", citeKey: "vaswani2017attention", title: "T", journal: "NeurIPS Proceedings",
      publisher: "Curran", doi: "10.5555/3295222", url: "https://arxiv.org/abs/1706.03762", summary: "We propose the Transformer",
      note: "my reading note", year: 2017, keywords: ["sequence transduction"], tags: ["nlp"],
    });
    for (const query of [
      "vaswani2017attention", "neurips", "curran", "10.5555/3295222", "1706.03762", "propose", "reading note",
      "2017", "transduction", "nlp",
    ]) {
      expect(score(paper, query)).toBeGreaterThan(0);
    }
  });

  it("finds a paper through its annotation text", () => {
    const paper = rec({ title: "Unrelated title" });
    expect(score(paper, "entanglement")).toBe(0);
    expect(score(paper, "entanglement", { annotations: "a highlighted passage about quantum entanglement" })).toBeGreaterThan(0);
  });
});

describe("matchPaper: host text", () => {
  it("searches the folder the host passes in", () => {
    const paper = rec({ title: "Unrelated title" });
    expect(score(paper, "robotics")).toBe(0);
    expect(score(paper, "robotics", { folder: "Robotics / Control" })).toBeGreaterThan(0);
  });
});

describe("matchPaper: field aliases", () => {
  const paper = rec({
    title: "Attention Is All You Need", citeKey: "vaswani2017", journal: "NeurIPS", publisher: "Curran Associates",
    keywords: ["sequence transduction", "Self-Attention"], note: "Revisit the multi-head part", summary: "We propose the Transformer",
    authors: ["Ashish Vaswani"],
  });

  it.each([
    ["kw:transduction", "kw:graphs"], ["keyword:self-attention", "keyword:vision"],
    ["venue:neurips", "venue:nature"], ["venue:curran", "journal:nature"], ["journal:neur", "journal:vision"],
    ["note:multi-head", "note:vaswani"], ["key:vaswani2017", "key:smith"], ["abstract:propose", "abstract:revisit"],
  ])("%s matches and %s does not", (hit, miss) => {
    expect(score(paper, hit)).toBeGreaterThan(0);
    expect(score(paper, miss)).toBe(0);
  });

  it("restricts the match to the named field", () => {
    expect(score(paper, "note:attention")).toBe(0);
    expect(score(paper, "kw:attention")).toBeGreaterThan(0);
  });

  it("folds accents on both sides", () => {
    expect(score(rec({ keywords: ["Schrödinger"] }), "kw:schrodinger")).toBeGreaterThan(0);
  });

  it("ignores an operator with an empty value", () => {
    expect(score(paper, "author:")).toBeGreaterThan(0);
    expect(score(paper, "attention author:")).toBe(score(paper, "attention"));
  });
});

describe("matchesTerms", () => {
  it("requires every free-text term in the text, ignoring case and accents", () => {
    expect(matchTerms(parseQuery("deep learning"), "Deep Learning")).toBe(true);
    expect(matchTerms(parseQuery("cafe"), "Café Society")).toBe(true);
    expect(matchTerms(parseQuery("deep vision"), "Deep Learning")).toBe(false);
    expect(matchTerms(parseQuery(""), "anything")).toBe(true);
  });
});

describe("paperMatches", () => {
  it("is true exactly when the score is positive", () => {
    const paper = rec({ title: "Attention" });
    const doc = searchDoc(paper);
    expect(isPaperMatch(paper, doc, parseQuery("attention"))).toBe(true);
    expect(isPaperMatch(paper, doc, parseQuery("convolution"))).toBe(false);
  });
});

describe("matchPaper: operators", () => {
  it("excludes a paper containing a -word anywhere in title, authors or the rest", () => {
    const survey = rec({ title: "A Survey of Transformers" });
    const byAuthor = rec({ title: "Transformers", authors: ["Survey Author"] });
    const byNote = rec({ title: "Transformers", note: "survey-like overview" });
    const clean = rec({ title: "Transformers" });
    for (const paper of [survey, byAuthor, byNote]) { expect(score(paper, "transformers -survey")).toBe(0); }
    expect(score(clean, "transformers -survey")).toBeGreaterThan(0);
  });

  it("tag: matches a whole tag, case- and accent-insensitively, and requires every tag", () => {
    const paper = rec({ tags: ["NLP", "Vision", "Café"] });
    expect(score(paper, "tag:nlp")).toBeGreaterThan(0);
    expect(score(paper, "#NLP")).toBeGreaterThan(0);
    expect(score(paper, "tag:cafe")).toBeGreaterThan(0);
    expect(score(paper, "tag:vis")).toBe(0);
    expect(score(paper, "tag:nlp tag:vision")).toBeGreaterThan(0);
    expect(score(paper, "tag:nlp tag:rl")).toBe(0);
    expect(score(rec(), "tag:nlp")).toBe(0);
  });

  it("tag:ai matches AI but not air; a quoted multi-word tag matches as one tag", () => {
    expect(score(rec({ tags: ["AI"] }), "tag:ai")).toBeGreaterThan(0);
    expect(score(rec({ tags: ["air"] }), "tag:ai")).toBe(0);
    const paper = rec({ tags: ["Deep Learning"] });
    expect(score(paper, 'tag:"deep learning"')).toBeGreaterThan(0);
    expect(score(paper, 'tag:"deep"')).toBe(0);
    expect(score(paper, "tag:deep")).toBe(0);
  });

  it("status: matches any of the listed statuses", () => {
    const reading = rec({ status: "reading" });
    const done = rec({ status: "done" });
    const unread = rec({ status: "unread" });
    expect(score(reading, "status:reading")).toBeGreaterThan(0);
    expect(score(done, "status:reading")).toBe(0);
    expect(score(done, "is:r is:d")).toBeGreaterThan(0);
    expect(score(unread, "is:r is:d")).toBe(0);
    expect(score(unread, "is:u")).toBeGreaterThan(0);
  });

  it("year: filters by exact value, range and comparison; papers without a year never match", () => {
    const y2017 = rec({ year: 2017 });
    const noYear = rec();
    expect(score(y2017, "year:2017")).toBeGreaterThan(0);
    expect(score(y2017, "year:2018")).toBe(0);
    expect(score(y2017, "year:2015..2020")).toBeGreaterThan(0);
    expect(score(y2017, "year:2018..2020")).toBe(0);
    expect(score(y2017, "year:2015..")).toBeGreaterThan(0);
    expect(score(y2017, "year:..2016")).toBe(0);
    expect(score(y2017, "year:>2016")).toBeGreaterThan(0);
    expect(score(y2017, "year:>2017")).toBe(0);
    expect(score(y2017, "year:>=2017")).toBeGreaterThan(0);
    expect(score(y2017, "year:<2017")).toBe(0);
    expect(score(y2017, "year:<=2017")).toBeGreaterThan(0);
    expect(score(noYear, "year:2015..2020")).toBe(0);
    expect(score(noYear, "year:<2030")).toBe(0);
    expect(score(noYear, "")).toBeGreaterThan(0);
  });

  it("author: matches a substring of the folded author list and needs every author filter", () => {
    const paper = rec({ authors: ["Ashish Vaswani", "Noam Shazeer"] });
    expect(score(paper, "author:vaswani")).toBeGreaterThan(0);
    expect(score(paper, "au:shaz")).toBeGreaterThan(0);
    expect(score(paper, "au:vaswani au:shazeer")).toBeGreaterThan(0);
    expect(score(paper, "au:vaswani au:hinton")).toBe(0);
    expect(score(rec(), "au:vaswani")).toBe(0);
  });

  it("has:pdf / no:pdf follow hasPdf; an unknown hasPdf counts as present", () => {
    expect(score(rec({ hasPdf: true }), "has:pdf")).toBeGreaterThan(0);
    expect(score(rec({ hasPdf: false }), "has:pdf")).toBe(0);
    expect(score(rec({ hasPdf: false }), "no:pdf")).toBeGreaterThan(0);
    expect(score(rec({ hasPdf: true }), "no:pdf")).toBe(0);
    const { hasPdf: _omit, ...unknown } = rec();
    expect(score(unknown, "has:pdf")).toBeGreaterThan(0);
  });

  it("has:note ignores whitespace-only notes; has:doi, has:tags and has:abstract look at their fields", () => {
    expect(score(rec({ note: "a note" }), "has:note")).toBeGreaterThan(0);
    expect(score(rec({ note: "   " }), "has:note")).toBe(0);
    expect(score(rec(), "no:note")).toBeGreaterThan(0);
    expect(score(rec({ doi: "10.1/x" }), "has:doi")).toBeGreaterThan(0);
    expect(score(rec(), "has:doi")).toBe(0);
    expect(score(rec({ tags: ["x"] }), "has:tags")).toBeGreaterThan(0);
    expect(score(rec({ tags: [] }), "has:tags")).toBe(0);
    expect(score(rec({ summary: "An abstract." }), "has:abstract")).toBeGreaterThan(0);
    expect(score(rec(), "has:abstract")).toBe(0);
  });

  it("combines operators with terms (all must hold)", () => {
    const paper = rec({ title: "Attention Is All You Need", year: 2017, status: "reading", tags: ["nlp"], authors: ["Ashish Vaswani"] });
    expect(score(paper, "attention tag:nlp is:r year:2015..2020 au:vaswani has:pdf")).toBeGreaterThan(0);
    expect(score(paper, "attention tag:nlp is:d year:2015..2020")).toBe(0);
  });
});
