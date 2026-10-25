import { findAuthorContacts } from "@labshelf/core";

const EFETCH = `<PubmedArticleSet><PubmedArticle><MedlineCitation><Article><AuthorList>
<Author ValidYN="Y"><LastName>Silva</LastName><ForeName>Ana</ForeName><AffiliationInfo><Affiliation>Dept. of Biology, Univ. X, Brazil.</Affiliation></AffiliationInfo></Author>
<Author ValidYN="Y"><LastName>Costa</LastName><ForeName>Rui</ForeName><AffiliationInfo><Affiliation>Institute Y, Portugal. Electronic address: rui.costa@inst.example.pt.</Affiliation></AffiliationInfo></Author>
</AuthorList></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;

function fakeFetch(routes: Record<string, string>, seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    return key ? new Response(routes[key], { status: 200 }) : new Response("", { status: 404 });
  }) as typeof fetch;
}

describe("findAuthorContacts", () => {
  const page = `<html><head><meta name="citation_author" content="Lee, Kim"><meta name="citation_author_email" content="kim.lee@uni.example.kr"></head></html>`;

  it("reads the article page and does not ask PubMed when the page names an address", async () => {
    const seen: string[] = [];
    const contacts = await findAuthorContacts({ articleUrl: "https://journal.example/a/1", doi: "10.1/x" }, { fetch: fakeFetch({ "journal.example": page }, seen) });
    expect(contacts).toEqual([{ email: "kim.lee@uni.example.kr", name: "Lee, Kim" }]);
    expect(seen.some((u) => u.includes("eutils"))).toBe(false);
  });

  it("falls back to PubMed's Electronic address when the page has none", async () => {
    const fetch = fakeFetch({ "journal.example": "<html></html>", "esearch.fcgi": JSON.stringify({ esearchresult: { idlist: ["123"] } }), "efetch.fcgi": EFETCH });
    expect(await findAuthorContacts({ articleUrl: "https://journal.example/a/1", doi: "10.1/x" }, { fetch })).toEqual([{ email: "rui.costa@inst.example.pt", name: "Rui Costa" }]);
  });

  it("returns nothing when the page is unreachable and there is no DOI", async () => {
    expect(await findAuthorContacts({ articleUrl: "https://journal.example/a/1" }, { fetch: fakeFetch({}) })).toEqual([]);
  });
});
