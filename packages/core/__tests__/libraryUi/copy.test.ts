import {
  findMissMessage, createNoPdfDialogCopy, formatPdfSourceLabel, deriveCleanTags, formatKeptFieldNotice, moveNotice, formatPaperCount, removeNotice, formatCitation, joinCitations, derivePaperDetails, derivePaperStats, createSidecarReader, titleResolver,
} from "../../src/libraryUi/copy";
import type { PdfMiss } from "../../src/libraryUi/protocol";
import type { PaperRecord, Annotation } from "../../src/model";
import {
  MAILTO_MAX_LENGTH, createCopyRequestMailto, type CopyRequest, type RequestLanguage, isRequestLanguage, deriveRequestLanguage,
} from "../../src/libraryUi";
import type { ILogger } from "../../src/ports";

const miss = (over: Partial<PdfMiss> = {}): PdfMiss => ({ tried: 0, sources: [], blocked: false, needsLogin: false, ...over });

describe("pdfSourceLabel", () => {
  it("labels known resolvers, passes through unknown ones, falls back to the web", () => {
    expect(formatPdfSourceLabel("unpaywall")).toBe("Unpaywall (open access)");
    expect(formatPdfSourceLabel("publisher")).toBe("the publisher");
    expect(formatPdfSourceLabel("mystery")).toBe("mystery");
    expect(formatPdfSourceLabel(undefined)).toBe("the web");
  });
});

describe("noPdfDialogCopy", () => {
  it("summarises a normal miss with the source list and the paper title", () => {
    const { title, message } = createNoPdfDialogCopy("Deep Learning", miss({ tried: 7, sources: ["page", "publisher", "unpaywall"] }));
    expect(title).toBe("No PDF found");
    expect(message).toContain("Tried 7 links from this page, the publisher and Unpaywall (open access).");
    expect(message).toContain('"Deep Learning"');
    expect(message).toContain("without its PDF");
    expect(message).not.toContain("bot check");
  });

  it("uses the singular 'link' when exactly one was tried", () => {
    expect(createNoPdfDialogCopy("X", miss({ tried: 1, sources: ["page"] })).message).toContain("Tried 1 link from this page.");
  });

  it("says no identifier was found when nothing was tried", () => {
    const { message } = createNoPdfDialogCopy("Ghost", miss({ tried: 0 }));
    expect(message).toContain("No PDF link, DOI or arXiv id was found for \"Ghost\"");
    expect(message).not.toContain("Tried");
  });

  it("tells the user to open the page and sign in or pass the check when the miss has an access page", () => {
    const url = "https://publisher.example/x.pdf";
    expect(createNoPdfDialogCopy("X", miss({ tried: 1, needsLogin: true, access: { kind: "login", url } })).message).toContain("sign in there");
    expect(findMissMessage("X", miss({ tried: 1, blocked: true, access: { kind: "bot", url } }))).toContain("pass the check there");
  });

  it("adds the bot-check hint when some links were blocked", () => {
    expect(createNoPdfDialogCopy("X", miss({ tried: 3, sources: ["publisher"], blocked: true })).message)
      .toContain("behind a bot check");
  });
});


describe("findMissMessage", () => {
  it("counts the links tried, or says nothing was found to try, and adds the bot-check hint", () => {
    expect(findMissMessage("X", miss({ tried: 2 }))).toBe('LabShelf tried 2 links but could not download a PDF for "X". Attach a file you already have, or search again later.');
    expect(findMissMessage("X", miss())).toContain('LabShelf found no PDF link, DOI or arXiv id for "X".');
    expect(findMissMessage("X", miss({ tried: 1 }))).toContain("tried 1 link but");
    expect(findMissMessage("X", miss({ tried: 1, blocked: true }))).toContain("behind a bot check");
  });
});

const titleOf = (id: string): string => `Title ${id}`;

describe("papersLabel and cleanTags", () => {
  it("pluralises and trims", () => {
    expect(formatPaperCount(1)).toBe("1 paper");
    expect(formatPaperCount(3)).toBe("3 papers");
    expect(deriveCleanTags([" ml ", "", "  "])).toEqual(["ml"]);
  });
});

describe("keptFieldNotice", () => {
  it("counts the papers and names the field and the reason", () => {
    expect(formatKeptFieldNotice("tags", 1, "locked")).toBe("1 paper kept their tags — locked");
    expect(formatKeptFieldNotice("status", 2, "not found")).toBe("2 papers kept their status — not found");
  });
});

describe("moveNotice", () => {
  it("counts the moved papers and names the folder, the root as All papers", () => {
    expect(moveNotice(2, [], "Thesis", titleOf)).toEqual({ kind: "ok", text: "2 papers moved to Thesis" });
    expect(moveNotice(1, [], undefined, titleOf)).toEqual({ kind: "ok", text: "1 paper moved to All papers" });
  });

  it("names the first paper that failed", () => {
    expect(moveNotice(1, [{ id: "p2", error: "exists" }], "B", titleOf))
      .toEqual({ kind: "error", text: '1 moved, 1 failed — "Title p2" — exists' });
  });

  it("says nothing when nothing happened", () => {
    expect(moveNotice(0, [], "B", titleOf)).toBeUndefined();
  });
});

describe("removeNotice", () => {
  it("names a single paper and counts several", () => {
    expect(removeNotice(["p1"], [], titleOf)).toEqual({ kind: "ok", text: 'Removed "Title p1"' });
    expect(removeNotice(["p1", "p2"], [], titleOf)).toEqual({ kind: "ok", text: "Removed 2 papers" });
  });

  it("names the first paper that failed", () => {
    expect(removeNotice([], [{ id: "p3", error: "busy" }], titleOf))
      .toEqual({ kind: "error", text: '0 removed, 1 failed — "Title p3" — busy' });
  });

  it("says nothing when nothing happened", () => {
    expect(removeNotice([], [], titleOf)).toBeUndefined();
  });
});

const paperRecord = (citeKey: string, title: string): PaperRecord =>
  ({ id: citeKey, citeKey, title, authors: ["Ada Lovelace"], year: 1843, status: "unread", path: "/p" }) as unknown as PaperRecord;

const papers = [paperRecord("lovelace1843", "Notes"), paperRecord("babbage1837", "Engine")];

describe("joinCitations", () => {
  it("joins cite keys with commas, ready for a citation command", () => {
    expect(joinCitations(papers, "key")).toBe("lovelace1843,babbage1837");
  });

  it("separates BibTeX entries with a blank line and formatted references with a newline", () => {
    const bibtex = joinCitations(papers, "bibtex");
    expect(bibtex).toBe(`${formatCitation(papers[0]!, "bibtex")}\n\n${formatCitation(papers[1]!, "bibtex")}`);
    expect(bibtex).toContain("@");
    expect(joinCitations(papers, "apa").split("\n")).toHaveLength(2);
  });
});

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

describe("requestLanguageFrom", () => {
  it.each([["pt-BR", "pt"], ["pt", "pt"], ["es-MX", "es"], ["ES", "es"], ["en-GB", "en"], ["fr-FR", "en"], ["", "en"], [undefined, "en"]])("maps %p to %s", (tag, lang) => {
    expect(deriveRequestLanguage(tag)).toBe(lang);
  });
});

describe("isRequestLanguage", () => {
  it("accepts the three languages and nothing else", () => {
    for (const v of ["en", "pt", "es"]) expect(isRequestLanguage(v)).toBe(true);
    for (const v of ["fr", "EN", "", null, undefined, 1]) expect(isRequestLanguage(v)).toBe(false);
  });
});

const annotation = { id: "a1" } as Annotation;

describe("sidecar summary", () => {
  it("counts annotations and carries the reading position into the stats", () => {
    const reading = { page: 7, updatedAt: "2026-01-02T03:04:05.000Z" };
    expect(derivePaperStats({ annotations: [annotation, annotation], reading })).toEqual({
      annotations: 2, lastPage: 7, lastRead: reading.updatedAt,
    });
  });

  it("leaves the reading fields out of the stats of a paper never opened", () => {
    expect(derivePaperStats({ annotations: [] })).toEqual({ annotations: 0 });
  });

  it("shows no reading position in the details of a paper never opened", () => {
    const pdf = { size: 10, relPath: "a/paper.pdf" };
    expect(derivePaperDetails({ annotations: [annotation] }, pdf)).toEqual({ annotations: [annotation], reading: null, pdf });
  });

  it("copies the reading position and the PDF into the details", () => {
    const reading = { page: 3, updatedAt: "2026-02-01T00:00:00.000Z" };
    expect(derivePaperDetails({ annotations: [], reading }, null)).toEqual({ annotations: [], reading, pdf: null });
  });
});

function logger(): ILogger & { log: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) };
}

const sidecars: Record<string, { annotations: unknown[]; reading?: { page: number; updatedAt: string } }> = {
  a: { annotations: [{}, {}], reading: { page: 4, updatedAt: "2026-01-01T00:00:00.000Z" } },
  b: { annotations: [] },
};
const load = async (id: string): Promise<never> => {
  const found = sidecars[id];
  if (!found) throw new Error("no sidecar");
  return found as never;
};

describe("createSidecarReader", () => {
  it("reads stats for the readable papers and logs the others with their id", async () => {
    const log = logger();
    const stats = await createSidecarReader(load, log, "ui/test").statsOf([{ id: "a" }, { id: "b" }, { id: "gone" }]);
    expect(stats).toEqual({ a: { annotations: 2, lastPage: 4, lastRead: "2026-01-01T00:00:00.000Z" }, b: { annotations: 0 } });
    expect(log.log).toHaveBeenCalledWith("WARN", "ui/test", "Sidecar could not be read for the list", { paperId: "gone", message: "Error: no sidecar" });
  });

  it("returns undefined stats for one unreadable paper", async () => {
    expect(await createSidecarReader(load, logger(), "ui/test").statsFor("gone")).toBeUndefined();
  });

  it("reads an unreadable sidecar as having no annotations, and logs it", async () => {
    const log = logger();
    const reader = createSidecarReader(load, log, "ui/test");
    expect((await reader.summaryOf("a")).annotations).toHaveLength(2);
    expect(await reader.summaryOf("gone")).toEqual({ annotations: [] });
    expect(log.log).toHaveBeenCalledWith("WARN", "ui/test", "Sidecar could not be read; showing no annotations", expect.objectContaining({ paperId: "gone" }));
  });
});

describe("titleResolver", () => {
  const resolve = titleResolver([{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }]);

  it("returns the title of a known paper", () => {
    expect(resolve("b")).toBe("Beta");
  });

  it("falls back to the id when the paper is unknown", () => {
    expect(resolve("zzz")).toBe("zzz");
  });
});
