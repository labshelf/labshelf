import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorContacts, parseHtmlPage, type RawPage } from "@labshelf/core";

const page = (name: string): RawPage =>
  parseHtmlPage(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "contacts", name), "utf8"), "https://publisher.example/article/1");

describe("authorContacts on saved publisher pages", () => {
  it("PLOS: pairs citation_author_email with the author tag before it and ignores the footer mailboxes", () => {
    expect(authorContacts(page("plos.html"))).toEqual([{ email: "mark.oneil@genetics.example.ie", name: "Mark O'Neil" }]);
  });

  it("Springer: takes the mailto after 'Correspondence to', strips the query, and drops the permissions mailbox", () => {
    expect(authorContacts(page("springer.html"))).toEqual([{ email: "maria.rossi@unimi.example.it" }]);
  });

  it("Elsevier: takes the mailto in the 'Corresponding author' footnote and drops permissions@", () => {
    expect(authorContacts(page("elsevier.html"))).toEqual([{ email: "j.brown@chem.example.edu" }]);
  });

  it("MDPI: takes the icon-only mailto beside the '*' correspondence note and drops the journal office", () => {
    expect(authorContacts(page("mdpi.html"))).toEqual([{ email: "c.mendes@fe.up.example.pt" }]);
  });

  it("Frontiers: decodes percent-encoding and keeps both addresses of the correspondence line, not share or support links", () => {
    expect(authorContacts(page("frontiers.html")).map((c) => c.email)).toEqual(["Helena.Park@neuro.example.org", "omar.haddad@neuro.example.org"]);
  });
});

describe("authorContacts filtering and merging", () => {
  it("returns nothing when the only mailto links are publisher mailboxes", () => {
    expect(authorContacts(page("permissionsOnly.html"))).toEqual([]);
  });

  it("returns nothing for a mailto with no correspondence wording near it", () => {
    expect(authorContacts(page("noCorrespondence.html"))).toEqual([]);
  });

  it("lists an address once when a meta tag and a mailto link both give it, keeping the meta name", () => {
    const raw: RawPage = {
      pageUrl: "https://x.example/a",
      meta: {},
      pdfLinks: [],
      doiLinks: [],
      authorEmails: [{ email: "Ada@lab.example.org", name: "Ada Lovelace" }],
      mailtoLinks: [{ href: "mailto:ada@lab.example.org", text: "Ada", context: "Correspondence to Ada" }],
    };
    expect(authorContacts(raw)).toEqual([{ email: "Ada@lab.example.org", name: "Ada Lovelace" }]);
  });

  it("skips a malformed meta address", () => {
    const raw: RawPage = { pageUrl: "https://x.example/a", meta: {}, pdfLinks: [], doiLinks: [], mailtoLinks: [], authorEmails: [{ email: "not an email" }] };
    expect(authorContacts(raw)).toEqual([]);
  });
});

describe("parseHtmlPage author evidence", () => {
  it("fills mailtoLinks with href, text and surrounding wording, and authorEmails in page order", () => {
    const raw = page("springer.html");
    expect(raw.mailtoLinks).toHaveLength(2);
    expect(raw.mailtoLinks[0]).toMatchObject({ href: "mailto:maria.rossi@unimi.example.it?subject=Your%20paper", text: "Maria Rossi" });
    expect(raw.mailtoLinks[0]!.context).toMatch(/Correspondence to Maria Rossi/);
    expect(page("plos.html").authorEmails).toEqual([{ email: "mark.oneil@genetics.example.ie", name: "Mark O'Neil" }]);
  });

  it("caps mailtoLinks at 20", () => {
    const html = Array.from({ length: 30 }, (_, i) => `<a href="mailto:a${i}@x.example.org">a</a>`).join("");
    expect(parseHtmlPage(html, "https://x.example/").mailtoLinks).toHaveLength(20);
  });
});
