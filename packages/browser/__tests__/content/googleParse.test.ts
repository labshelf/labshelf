/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Google results parsing over saved result pages: which results get a button, and what each hit reads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { googleResults, isGoogleSearchUrl, isPaperHit, parseByline, readGoogleResult } from "../../src/content/googleParse";
import type { SearchHit } from "../../src/platform";

function page(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function fixture(name: string): Document {
  return page(readFileSync(join(__dirname, "fixtures", name), "utf8"));
}

function paperHits(doc: Document): SearchHit[] {
  return googleResults(doc).map(readGoogleResult).filter((h): h is SearchHit => !!h && isPaperHit(h));
}

const hostsOf = (hits: SearchHit[]): string[] => hits.map((h) => new URL(h.url!).hostname);

describe("isGoogleSearchUrl", () => {
  it("accepts web searches on Google and its country domains", () => {
    expect(isGoogleSearchUrl("https://www.google.com/search?q=x")).toBe(true);
    expect(isGoogleSearchUrl("https://www.google.com.br/search?q=x&hl=pt-BR")).toBe(true);
    expect(isGoogleSearchUrl("https://www.google.co.uk/search?q=x&udm=14")).toBe(true);
  });

  it("rejects other tabs, other hosts and other paths", () => {
    expect(isGoogleSearchUrl("https://www.google.com/search?q=x&tbm=nws")).toBe(false);
    expect(isGoogleSearchUrl("https://www.google.com/search?q=x&udm=2")).toBe(false);
    expect(isGoogleSearchUrl("https://www.google.evil.com/search?q=x")).toBe(false);
    expect(isGoogleSearchUrl("https://www.google.com/maps?q=x")).toBe(false);
    expect(isGoogleSearchUrl("http://www.google.com/search?q=x")).toBe(false);
    expect(isGoogleSearchUrl(undefined)).toBe(false);
  });
});

describe("parseByline", () => {
  it("reads the first author and year in any locale", () => {
    expect(parseByline("by TF Smith · 1981 · Cited by 15512 — ")).toEqual({ authors: ["TF Smith"], year: 1981 });
    expect(parseByline("de A Vaswani · 2017 · Citado por 276634 — ")).toEqual({ authors: ["A Vaswani"], year: 2017 });
  });

  it("ignores date lines and a year without an author", () => {
    expect(parseByline("12 de jun. de 2017 — ")).toBeUndefined();
    expect(parseByline("Jun 19, 2026 — ")).toBeUndefined();
    expect(parseByline("1981 · Cited by 15345 — ")).toBeUndefined();
  });
});

describe("Google results", () => {
  it("DOI search: buttons on the PubMed, ScienceDirect and Semantic Scholar results, none on the SCIRP reference page", () => {
    const hits = paperHits(fixture("doiSearch.html"));
    expect(hostsOf(hits)).toEqual([
      "pubmed.ncbi.nlm.nih.gov", "www.sciencedirect.com", "www.sciencedirect.com", "www.semanticscholar.org", "www.osti.gov",
    ]);
    expect(hits[1]).toEqual({
      key: "https://www.sciencedirect.com/science/article/pii/0022283681900875",
      url: "https://www.sciencedirect.com/science/article/pii/0022283681900875",
      title: "Identification of common molecular subsequences",
      authors: ["TF Smith"],
      year: 1981,
    });
    expect(hits[3]!.title).toBe("Identification of common molecular subsequences.");
  });

  it("title search: the publisher, repository and index results, not a course copy or a code repository", () => {
    const hits = paperHits(fixture("titleSearch.html"));
    expect(hostsOf(hits)).toEqual([
      "pubmed.ncbi.nlm.nih.gov", "www.sciencedirect.com", "www.semanticscholar.org", "www.sciencedirect.com", "www.osti.gov",
    ]);
    expect(hits.find((h) => h.url!.includes("osti.gov"))).toMatchObject({ authors: ["TF Smith"], year: 1981 });
  });

  it("Portuguese page: arXiv, NeurIPS and ACM results, not Wikipedia, Medium or People also ask", () => {
    const doc = fixture("ptBrSearch.html");
    const hits = paperHits(doc);
    expect(hostsOf(hits)).toEqual([
      "arxiv.org", "papers.neurips.cc", "proceedings.neurips.cc", "dl.acm.org", "papers.nips.cc",
    ]);
    expect(hits[1]).toMatchObject({ authors: ["A Vaswani"], year: 2017 });
    expect(hits[0]!.title).toBe("[1706.03762] Attention Is All You Need");
    const askedBlock = [...doc.querySelectorAll("#rso [data-rpos]")].find((b) => b.textContent?.includes("As pessoas também perguntam"));
    expect(askedBlock).toBeDefined();
    expect(readGoogleResult(askedBlock!)).toBeUndefined();
  });

  it("gives no button to ads or the AI overview", () => {
    const doc = page(`
      <div id="tads"><div data-text-ad="1" data-rpos="0"><a href="https://www.sciencedirect.com/x"><h3>Sponsored journal</h3></a></div></div>
      <div id="search"><div id="rso">
        <div data-rpos="0"><div><h1>AI Overview</h1><span>Smith–Waterman finds local alignments.</span>
          <a href="https://pubmed.ncbi.nlm.nih.gov/7265238/"><div>Identification of common molecular subsequences</div></a></div></div>
        <div data-rpos="1"><div data-text-ad="1"><a href="https://www.sciencedirect.com/y"><h3>Ad inside results</h3></a></div></div>
        <div data-rpos="2"><a href="https://pubmed.ncbi.nlm.nih.gov/7265238/"><h3>Identification of common molecular subsequences</h3></a></div>
      </div></div>`);
    expect(googleResults(doc).map(readGoogleResult).filter(Boolean).map((h) => h!.title)).toEqual([
      "Identification of common molecular subsequences",
    ]);
  });

  it("gives no button on a search without scholarly results", () => {
    const doc = page(`<div id="search"><div id="rso">
      <div data-rpos="0"><a href="https://en.wikipedia.org/wiki/Bread"><h3>Bread - Wikipedia</h3></a><span>Mar 3, 2024 — Bread is a staple food.</span></div>
      <div data-rpos="1"><a href="https://www.google.com/search?q=bread&tbm=isch"><h3>Images for bread</h3></a></div>
    </div></div>`);
    expect(paperHits(doc)).toEqual([]);
  });
});
