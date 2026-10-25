/** Contract of matching a downloaded or opened PDF to the library paper it belongs to. */

import { matchPdfToPaper, type MatchablePaper } from "@labshelf/core";

const science: MatchablePaper = { title: "Rapid evolution of coastal marine heatwave tolerance", doi: "10.1126/science.abc1234" };
const attention: MatchablePaper = { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" };
const unrelated: MatchablePaper = { title: "A survey of graph neural network architectures", doi: "10.1000/other" };
const papers = [science, attention, unrelated];

const PAGE = [
  "Science",
  "RESEARCH ARTICLE",
  "Received 3 March 2020; accepted 10 June 2020",
  "Rapid evolution of coastal marine",
  "heatwave tolerance",
  "Jane Doe, John Smith, Maria Souza",
  "Department of Oceanography, University of Somewhere",
  "Abstract. Marine heatwaves are increasingly frequent.",
].join("\n");

describe("matchPdfToPaper by id", () => {
  it("matches a DOI in a publisher PDF URL", () => {
    expect(matchPdfToPaper({ url: "https://www.science.org/doi/pdf/10.1126/science.abc1234" }, papers)).toBe(science);
  });

  it("matches a URL-encoded DOI", () => {
    expect(matchPdfToPaper({ url: "https://host.example/doi/pdf/10.1126%2Fscience.abc1234?download=true" }, papers)).toBe(science);
  });

  it("matches a DOI in the referrer when the PDF URL names nothing", () => {
    const pdf = { url: "https://cdn.example.com/files/8842.pdf", referrer: "https://www.science.org/doi/10.1126/science.ABC1234" };
    expect(matchPdfToPaper(pdf, papers)).toBe(science);
  });

  it("matches an arXiv PDF URL with a version suffix", () => {
    expect(matchPdfToPaper({ url: "https://arxiv.org/pdf/1706.03762v7" }, papers)).toBe(attention);
  });

  it("matches an old-style arXiv id", () => {
    const old = { title: "The large N limit of superconformal field theories", url: "https://arxiv.org/abs/hep-th/9711200" };
    expect(matchPdfToPaper({ url: "https://arxiv.org/pdf/hep-th/9711200v3.pdf" }, [unrelated, old])).toBe(old);
  });

  it("matches an arXiv DOI on the paper to an arxiv.org PDF", () => {
    const paper = { title: "Some preprint title here", doi: "10.48550/arXiv.2101.00001" };
    expect(matchPdfToPaper({ url: "https://arxiv.org/pdf/2101.00001v2" }, [paper])).toBe(paper);
  });

  it("matches a PMC id", () => {
    const pmc = { title: "A trial of something in patients", pmcid: "PMC7654321" };
    expect(matchPdfToPaper({ url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7654321/pdf/main.pdf" }, [unrelated, pmc])).toBe(pmc);
  });

  it("returns undefined when two papers carry the ids in play", () => {
    const pdf = { url: "https://www.science.org/doi/pdf/10.1126/science.abc1234", referrer: "https://doi.org/10.1000/other" };
    expect(matchPdfToPaper(pdf, papers)).toBeUndefined();
  });

  it("returns undefined when two papers share the matched DOI", () => {
    const twin = { ...science };
    expect(matchPdfToPaper({ url: "https://www.science.org/doi/pdf/10.1126/science.abc1234" }, [science, twin])).toBeUndefined();
  });
});

describe("matchPdfToPaper by title", () => {
  it("finds a title wrapped over two lines among header and author lines", () => {
    expect(matchPdfToPaper({ url: "https://cdn.example.com/x.pdf", firstPageText: PAGE }, papers)).toBe(science);
  });

  it("finds a single-line title", () => {
    const text = "Advances in Neural Information Processing Systems\nAttention Is All You Need\nAshish Vaswani\n";
    expect(matchPdfToPaper({ url: "file:///dl/paper.pdf", firstPageText: text }, papers)).toBe(attention);
  });

  it("prefers the paper whose title matches the longer line", () => {
    const short = { title: "Graph neural networks in practice" };
    const long = { title: "Graph neural networks in practice for molecular property prediction" };
    const text = "Graph neural networks in practice for\nmolecular property prediction\n";
    expect(matchPdfToPaper({ url: "https://x.example/a.pdf", firstPageText: text }, [short, long])).toBe(long);
  });

  it("returns undefined for an unrelated PDF", () => {
    const text = "Quarterly report\nRevenue grew in every region\nPrepared by the finance team\n";
    expect(matchPdfToPaper({ url: "https://x.example/report.pdf", firstPageText: text }, papers)).toBeUndefined();
  });

  it("returns undefined without page text or ids", () => {
    expect(matchPdfToPaper({ url: "https://x.example/report.pdf" }, papers)).toBeUndefined();
  });

  it("returns undefined when two papers have the same title", () => {
    const twin = { ...science, doi: "10.1000/twin" };
    expect(matchPdfToPaper({ url: "https://x.example/a.pdf", firstPageText: PAGE }, [science, twin])).toBeUndefined();
  });

  it("ignores titles too short to identify a paper", () => {
    const intro = { title: "Introduction" };
    expect(matchPdfToPaper({ url: "https://x.example/a.pdf", firstPageText: "Introduction\nWe study things.\n" }, [intro])).toBeUndefined();
  });
});

describe("matchPdfToPaper precedence", () => {
  it("lets an id match beat a title match", () => {
    const pdf = { url: "https://arxiv.org/pdf/1706.03762", firstPageText: PAGE };
    expect(matchPdfToPaper(pdf, papers)).toBe(attention);
  });
});
