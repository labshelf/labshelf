/** The request email is a mailto: URL that decodes to the intended text in every language and stays under the length cap. */
import { MAILTO_MAX_LENGTH, createCopyRequestMailto, type CopyRequest, type RequestLanguage } from "../../../src/libraryUi";

const paper: CopyRequest["paper"] = {
  title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], year: 2017,
  journal: "NeurIPS", doi: "10.5555/3295222.3295349",
};
const requester = { name: "Ada Lovelace", affiliation: "Analytical Engine Lab" };
const request = (over: Partial<CopyRequest> = {}): CopyRequest => ({ to: ["author@uni.edu"], paper, requester, lang: "en", ...over });

function parse(url: string): { to: string; subject: string; body: string } {
  const [head, query = ""] = url.replace(/^mailto:/, "").split("?");
  const params = new Map(query.split("&").map((pair) => pair.split("=") as [string, string]));
  return { to: head!, subject: decodeURIComponent(params.get("subject") ?? ""), body: decodeURIComponent(params.get("body") ?? "") };
}

describe("requestCopyMailto", () => {
  it("writes the subject, citation, DOI link and signature", () => {
    const { to, subject, body } = parse(createCopyRequestMailto(request()));
    expect(to).toBe("author@uni.edu");
    expect(subject).toBe('Request for a copy of "Attention Is All You Need"');
    expect(body.split("\r\n")).toEqual([
      "Dear author,", "",
      "I came across your paper and would like to read it, but I do not have access to the full text:", "",
      "Vaswani et al. (2017). Attention Is All You Need. NeurIPS.",
      "https://doi.org/10.5555/3295222.3295349", "",
      "Could you please send me a copy? It is for my personal research.", "",
      "Thank you very much,", "Ada Lovelace", "Analytical Engine Lab",
    ]);
  });

  it.each<[RequestLanguage, string, string, string]>([
    ["pt", 'Pedido de cópia de "Attention Is All You Need"', "Prezado(a) autor(a),", "É para a minha pesquisa pessoal."],
    ["es", 'Solicitud de una copia de "Attention Is All You Need"', "Estimado/a autor/a,", "Es para mi investigación personal."],
    ["en", 'Request for a copy of "Attention Is All You Need"', "Dear author,", "for my personal research."],
  ])("writes in %s", (lang, subjectLine, greeting, personal) => {
    const { subject, body } = parse(createCopyRequestMailto(request({ lang })));
    expect(subject).toBe(subjectLine);
    expect(body.startsWith(greeting)).toBe(true);
    expect(body).toContain(personal);
  });

  it("encodes with percent escapes only: %20 for spaces, %0D%0A for line breaks, never +", () => {
    const url = createCopyRequestMailto(request());
    expect(url).not.toContain("+");
    expect(url).not.toContain(" ");
    expect(url).not.toMatch(/[\r\n]/);
    expect(url).toContain("%0D%0A");
    expect(url).toContain("subject=Request%20for%20a%20copy%20of%20%22Attention");
  });

  it("round-trips quotes, ampersands and accents in the title", () => {
    const title = 'Efeito do "estresse" & da ação: análise e reflexão sobre o café?';
    const { subject, body } = parse(createCopyRequestMailto(request({ paper: { ...paper, title }, lang: "pt" })));
    expect(subject).toBe(`Pedido de cópia de "${title}"`);
    expect(body).toContain(title);
  });

  it("round-trips accents in the requester's name and affiliation", () => {
    const { body } = parse(createCopyRequestMailto(request({ lang: "es", requester: { name: "José Muñoz", affiliation: "Universidad de São Paulo" } })));
    expect(body.endsWith("Muchas gracias,\r\nJosé Muñoz\r\nUniversidad de São Paulo")).toBe(true);
  });

  it("leaves the DOI line out when the paper has no DOI", () => {
    const { body } = parse(createCopyRequestMailto(request({ paper: { ...paper, doi: undefined } })));
    expect(body).not.toContain("doi.org");
    expect(body).toContain("NeurIPS.\r\n\r\nCould you");
  });

  it("leaves out an empty name and affiliation", () => {
    const { body } = parse(createCopyRequestMailto(request({ requester: { name: "", affiliation: "  " } })));
    expect(body.endsWith("Thank you very much,")).toBe(true);
    const named = parse(createCopyRequestMailto(request({ requester: { name: "Ada", affiliation: "" } }))).body;
    expect(named.endsWith("Thank you very much,\r\nAda")).toBe(true);
  });

  it("joins several addresses with commas and allows none", () => {
    expect(createCopyRequestMailto(request({ to: ["a@x.org", "b@y.org"] })).startsWith("mailto:a@x.org,b@y.org?subject=")).toBe(true);
    expect(createCopyRequestMailto(request({ to: [] })).startsWith("mailto:?subject=")).toBe(true);
  });

  it("copes with a paper that has only a title", () => {
    const { body } = parse(createCopyRequestMailto(request({ paper: { title: "Untitled notes" } })));
    expect(body).toContain("\r\nUntitled notes.\r\n");
  });

  describe("length cap", () => {
    const longTitle = "A very long title about the behaviour of ünïcödé systems ".repeat(60).trim();

    it("stays at or under the cap for a long title and decodes cleanly", () => {
      const url = createCopyRequestMailto(request({ paper: { ...paper, title: longTitle }, lang: "pt" }));
      expect(url.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH);
      expect(() => decodeURIComponent(url.split("body=")[1]!)).not.toThrow();
      const { subject, body } = parse(url);
      expect(subject.startsWith('Pedido de cópia de "A very long title')).toBe(true);
      expect(body).toContain("A very long title");
      expect(body).toContain("Ada Lovelace");
      expect(body).toContain("https://doi.org/10.5555/3295222.3295349");
    });

    it("shortens the authors before the title", () => {
      const author = `Alexandrovich-${"Verylongfamilyname".repeat(100)}`;
      const url = createCopyRequestMailto(request({ paper: { ...paper, authors: [author], title: "Short title" } }));
      expect(url.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH);
      const { subject, body } = parse(url);
      expect(body).toContain("…");
      expect(body).toContain("Short title");
      expect(subject).toBe('Request for a copy of "Short title"');
    });

    it("shortens the body title before the subject title", () => {
      const title = "Word ".repeat(120).trim();
      const { subject, body } = parse(createCopyRequestMailto(request({ paper: { ...paper, title } })));
      const inBody = body.split("\r\n").find((line) => line.includes("Word "))!;
      expect(inBody).toContain("…");
      expect(subject).toBe(`Request for a copy of "${title}"`);
    });

    it("never splits an astral character or an escape when it cuts", () => {
      const title = "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 ".repeat(300);
      for (const lang of ["en", "pt", "es"] as const) {
        const url = createCopyRequestMailto(request({ paper: { ...paper, title }, lang }));
        expect(url.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH);
        expect(url).not.toMatch(/%(?![0-9A-F]{2})/);
        expect(() => parse(url)).not.toThrow();
      }
    });

    it("drops the subject title when nothing else brings the URL under the cap", () => {
      const url = createCopyRequestMailto(request({ paper: { ...paper, title: "T".repeat(5000) }, requester: { name: "N".repeat(500), affiliation: "A".repeat(500) } }));
      expect(parse(url).subject).toMatch(/^Request for a copy of ".*"$/);
      expect(url.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH);
    });
  });
});
